import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";
import { requirePortalAuth, requireMutationHeader, allowAttempt, digest } from "./portal-auth.js";
import { byonAuthorized, byonRequest, connectionKey, connectionTypeAllowed, isConnectionId } from "./byon-shared.js";
import { getTenantLimits, planActive } from "./quotas.js";
import { commercialLimits } from "./plans.js";
import { sharedConnectionAllowance } from "./feature-allowances.js";
import { loadEnabledLanguages, defaultGroupLanguages } from "./languages.js";
import { isWebGroupId } from "./gateways.js";

const registration = z.object({
  kind: z.enum(["PERSONAL","BUSINESS"]),
  label: z.string().trim().min(2).max(100), consentConfirmed: z.literal(true)
}).strict();
const pairing = z.object({ phoneNumber: z.string().regex(/^[1-9][0-9]{7,14}$/).optional() }).strict();
const activationRequest = z.object({ connectionId: z.string(), consentConfirmed: z.literal(true) }).strict();
const groupProof = z.object({
  connectionId: z.string(), groupId: z.string().refine(isWebGroupId),
  groupName: z.string().trim().min(1).max(191), code: z.string().regex(/^[A-F0-9]{16}$/i),
  adminVerified: z.literal(true)
}).strict();

async function policy(prisma: PrismaClient) {
  return await prisma.whatsAppConnectionPolicy.findUnique({ where: { id: "global" } }) ??
    { customerNumbersEnabled: false, personalEnabled: true, businessEnabled: true, maxConnectionsPerTenant: 0 };
}
export function registerByonPortalRoutes(app: FastifyInstance, prisma: PrismaClient, cfg: Config): void {
  if (!cfg.saasEnabled) return;
  app.get("/portal/api/connections", async (req, reply) => {
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    const [rules, connections, plan, alerts] = await Promise.all([
      policy(prisma),
      prisma.customerWhatsAppConnection.findMany({
        where: { tenantId: user.tenantId },
        select: { id: true, label: true, kind: true, status: true, active: true, phoneLast4: true,
          createdAt: true, lastSeenAt: true, _count: { select: { groups: true } } },
        orderBy: { createdAt: "desc" }
      }),
      prisma.tenantSubscription.findUnique({
        where: { tenantId: user.tenantId },
        select: { planCode: true, whatsappConnectionLimit: true, groupLimit: true,
          status: true, periodEnd: true }
      }),
      prisma.alertSubscription.findUnique({ where: { tenantId: user.tenantId },
        select: { status: true, periodEnd: true, maxConnections: true } })
    ]);
    const allowance = commercialLimits(plan?.planCode ?? "PILOT", {
      groupLimit: plan?.groupLimit ?? cfg.SAAS_MAX_GROUPS,
      whatsappConnectionLimit: plan?.whatsappConnectionLimit ?? 0
    });
    const shared = sharedConnectionAllowance(plan, alerts);
    const planLimit = shared.limit;
    const effectiveLimit = [rules.maxConnectionsPerTenant, planLimit]
      .filter(limit => limit > 0);
    const maxConnections = effectiveLimit.length ? Math.min(...effectiveLimit) : 0;
    const activeGroups = await prisma.group.count({ where: { tenantId: user.tenantId } });
    return { policy: {
      enabled: cfg.BYON_GATEWAY_ENABLED === "true" && rules.customerNumbersEnabled && shared.eligible,
      personalEnabled: rules.personalEnabled, businessEnabled: rules.businessEnabled,
      maxConnections, planConnections: planLimit,
      groupLimit: allowance.groups,
      groupCount: activeGroups
    }, connections };
  });

  app.post("/portal/api/connections", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    if (user.role === "VIEWER") return reply.code(403).send({ error: "Workspace admin required" });
    const input = registration.parse(req.body);
    if (cfg.BYON_GATEWAY_ENABLED !== "true") return reply.code(503).send({ error: "Customer connections not enabled" });
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM Tenant WHERE id = ${user.tenantId} FOR UPDATE`;
      const rules = await tx.whatsAppConnectionPolicy.findUnique({ where: { id: "global" } });
      if (!rules || !connectionTypeAllowed(rules, input.kind)) return "DISABLED" as const;
      const plan = await tx.tenantSubscription.findUnique({ where: { tenantId: user.tenantId } });
      const alerts = await tx.alertSubscription.findUnique({ where: { tenantId: user.tenantId } });
      const shared = sharedConnectionAllowance(plan, alerts);
      if (!shared.eligible) return "INACTIVE" as const;
      const count = await tx.customerWhatsAppConnection.count({
        where: { tenantId: user.tenantId, active: true }
      });
      const globalLimit = rules.maxConnectionsPerTenant;
      const planLimit = shared.limit;
      if ((globalLimit > 0 && count >= globalLimit) ||
          (planLimit > 0 && count >= planLimit)) return "LIMIT" as const;
      const record = await tx.customerWhatsAppConnection.create({
        data: { tenantId: user.tenantId, kind: input.kind, label: input.label }
      });
      await tx.tenantAudit.create({ data: { tenantId: user.tenantId,
        actorId: user.userId, action: "WHATSAPP_CONNECTION_CREATED" } });
      return { id: record.id, kind: record.kind, label: record.label, status: record.status };
    });
    if (typeof result === "string") return reply.code(result === "LIMIT" ? 409 : 403)
      .send({ error: result === "LIMIT" ? "Connection limit reached" : "Connection type or plan not available" });
    return reply.code(201).send({ connection: result });
  });

  app.post<{ Params: { id: string } }>("/portal/api/connections/:id/pair", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    if (user.role === "VIEWER") return reply.code(403).send({ error: "Workspace admin required" });
    const input = pairing.parse(req.body);
    if (!allowAttempt("pair:" + user.tenantId, 6, 900_000))
      return reply.code(429).send({ error: "Pairing attempts limited" });
    const c = await prisma.customerWhatsAppConnection.findFirst({
      where: { id: req.params.id, tenantId: user.tenantId, active: true }
    });
    if (!c) return reply.code(404).send({ error: "Connection not found" });
    if (c.status === "CONNECTED") return reply.code(409).send({ error: "Already connected" });
    if (!connectionTypeAllowed(await policy(prisma), c.kind))
      return reply.code(403).send({ error: "Number type disabled" });
    // Mark pending BEFORE starting Baileys: the gateway may connect quickly
    // and report CONNECTED while this HTTP request is still in flight.
    await prisma.customerWhatsAppConnection.update({
      where: { id: c.id }, data: { status: "PAIRING" }
    });
    try {
      const gateway = await byonRequest(cfg, "/connections/" + c.id + "/start", "POST", input);
      if (!gateway.ok) return reply.code(503).send({ error: "Pairing unavailable" });
      return reply.code(202).send({ pairing: true });
    } catch { return reply.code(503).send({ error: "Gateway unavailable" }); }
  });

  app.get<{ Params: { id: string } }>("/portal/api/connections/:id/status", async (req, reply) => {
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    const c = await prisma.customerWhatsAppConnection.findFirst({
      where: { id: req.params.id, tenantId: user.tenantId, active: true },
      select: { id: true, label: true, kind: true, status: true, phoneLast4: true }
    });
    if (!c) return reply.code(404).send({ error: "Connection not found" });
    reply.header("cache-control", "private, no-store");
    try {
      const res = await byonRequest(cfg, "/connections/" + c.id + "/status");
      if (res.ok) {
        const state = await res.json() as {
          status?: string; pairingCode?: string; qrDataUrl?: string;
          phoneLast4?: string; pairExpiresAt?: number | null
        };
        return { connection: { ...c, status: state.status ?? c.status,
          phoneLast4: state.phoneLast4 ?? c.phoneLast4 },
          pairingCode: state.pairingCode ?? null, qrDataUrl: state.qrDataUrl ?? null,
          pairExpiresAt: typeof state.pairExpiresAt === "number" ? state.pairExpiresAt : null };
      }
    } catch { /* fail closed */ }
    return { connection: c, pairingCode: null, qrDataUrl: null, pairExpiresAt: null };
  });

  app.get<{ Params: { id: string } }>("/portal/api/connections/:id/groups", async (req, reply) => {
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    const c = await prisma.customerWhatsAppConnection.findFirst({
      where: { id: req.params.id, tenantId: user.tenantId, active: true }, select: { id: true }
    });
    if (!c) return reply.code(404).send({ error: "Connection not found" });
    try {
      const res = await byonRequest(cfg, "/connections/" + c.id + "/groups");
      if (!res.ok) return reply.code(503).send({ error: "Connection unavailable" });
      const data = await res.json() as { groups?: Array<{ groupId: string; name: string }> };
      const discovered = (data.groups ?? []).filter(g => isWebGroupId(g.groupId)).slice(0, 200);
      const [managed, limits, count] = await Promise.all([
        prisma.group.findMany({
          where: { connectionId: c.id, tenantId: user.tenantId },
          select: { id: true, whatsappGroupId: true, enabled: true }
        }),
        getTenantLimits(prisma, cfg, user.tenantId),
        prisma.group.count({ where: { tenantId: user.tenantId } })
      ]);
      const known = new Map(managed.map(g => [g.whatsappGroupId, g]));
      return {
        groups: discovered.map(g => {
          const registered = known.get(g.groupId);
          return { ...g, activated: !!registered, enabled: registered?.enabled ?? false,
            managedGroupId: registered?.id ?? null };
        }),
        groupUsage: { used: count, limit: limits.groups }
      };
    } catch { return reply.code(503).send({ error: "Group discovery unavailable" }); }
  });

  app.post("/portal/api/connections/activations", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    if (user.role === "VIEWER") return reply.code(403).send({ error: "Workspace admin required" });
    const input = activationRequest.parse(req.body);
    const c = await prisma.customerWhatsAppConnection.findFirst({
      where: { id: input.connectionId, tenantId: user.tenantId, active: true, status: "CONNECTED" }
    });
    if (!c) return reply.code(404).send({ error: "Connected number not found" });
    if (!connectionTypeAllowed(await policy(prisma), c.kind))
      return reply.code(403).send({ error: "Number type disabled" });
    const limits = await getTenantLimits(prisma, cfg, user.tenantId);
    if (!planActive(limits)) return reply.code(403).send({ error: "Subscription inactive" });
    const [count, pending] = await Promise.all([
      prisma.group.count({ where: { tenantId: user.tenantId } }),
      prisma.groupActivation.count({ where: { tenantId: user.tenantId,
        consumedAt: null, expiresAt: { gt: new Date() } } })
    ]);
    if (count >= limits.groups) return reply.code(409).send({
      error: "Your plan already uses all " + limits.groups + " group slots. The existing group is connected—open My Groups to manage it. Increase the group allowance in your subscription to activate another group.",
      code: "GROUP_LIMIT_REACHED", used: count, limit: limits.groups
    });
    if (pending >= 2) return reply.code(429).send({ error: "Finish existing activation first" });
    if (!allowAttempt("byon-activate:" + user.tenantId, 5, 900_000))
      return reply.code(429).send({ error: "Too many activation attempts" });
    const code = randomBytes(8).toString("hex").toUpperCase();
    const expiresAt = new Date(Date.now() + 900_000);
    await prisma.groupActivation.create({ data: {
      codeHash: digest(code), tenantId: user.tenantId,
      createdBy: user.userId, connectionId: c.id, expiresAt
    } });
    return reply.code(201).send({ code, expiresAt,
      instruction: "A group admin must post /wbot connect " + code + " in the WhatsApp group." });
  });

  app.delete<{ Params: { id: string } }>("/portal/api/connections/:id", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    if (user.role === "VIEWER") return reply.code(403).send({ error: "Workspace admin required" });
    const c = await prisma.customerWhatsAppConnection.findFirst({
      where: { id: req.params.id, tenantId: user.tenantId }
    });
    if (!c) return reply.code(404).send({ error: "Connection not found" });
    // Revoke access in the DB immediately. If gateway cleanup fails, preserve a
    // visible revoked record so the workspace can retry; no translation is allowed.
    await prisma.$transaction(async tx => {
      await tx.customerWhatsAppConnection.update({
        where: { id: c.id }, data: { status: "REVOKED", active: false }
      });
      await tx.group.updateMany({
        where: { connectionId: c.id, tenantId: user.tenantId }, data: { enabled: false }
      });
    });
    try {
      const result = await byonRequest(cfg, "/connections/" + c.id + "/revoke", "POST", {});
      if (!result.ok) return reply.code(202).send({
        removed: false, pending: true,
        message: "Translation stopped. WhatsApp unlink is pending; retry Remove account."
      });
    } catch {
      return reply.code(202).send({
        removed: false, pending: true,
        message: "Translation stopped. WhatsApp unlink is pending; retry Remove account."
      });
    }
    // Deleting the connection also permanently deletes only its groups and
    // their related stored messages. All other workspace sessions stay intact.
    await prisma.$transaction(async tx => {
      await tx.groupActivation.deleteMany({
        where: { connectionId: c.id, tenantId: user.tenantId }
      });
      await tx.group.deleteMany({
        where: { connectionId: c.id, tenantId: user.tenantId }
      });
      await tx.customerWhatsAppConnection.delete({
        where: { id: c.id, tenantId: user.tenantId }
      });
      await tx.tenantAudit.create({ data: {
        tenantId: user.tenantId, actorId: user.userId,
        action: "WHATSAPP_CONNECTION_PERMANENTLY_REMOVED"
      } });
    });
    return { removed: true };
  });

  app.post("/internal/byon/activate", async (req, reply) => {
    if (!byonAuthorized(req.headers.authorization, cfg))
      return reply.code(401).send({ error: "Unauthorized" });
    const cmd = groupProof.parse(req.body);
    if (!isConnectionId(cmd.connectionId)) return reply.code(400).send({ error: "Invalid connection ID" });
    const conn = await prisma.customerWhatsAppConnection.findUnique({
      where: { id: cmd.connectionId }
    });
    if (!conn || !conn.active || conn.status !== "CONNECTED" ||
        !connectionTypeAllowed(await policy(prisma), conn.kind))
      return reply.code(403).send({ error: "Connection disabled" });
    const defaults = defaultGroupLanguages(await loadEnabledLanguages(prisma));
    if (!defaults.length) return reply.code(503).send({ error: "No enabled languages" });
    const now = new Date();
    const success = await prisma.$transaction(async tx => {
      const claim = await tx.groupActivation.findUnique({
        where: { codeHash: digest(cmd.code.toUpperCase()) }
      });
      if (!claim || claim.connectionId !== conn.id || claim.tenantId !== conn.tenantId ||
          claim.consumedAt || claim.expiresAt <= now) return false;
      await tx.$queryRaw`SELECT id FROM Tenant WHERE id = ${conn.tenantId} FOR UPDATE`;
      const plan = await tx.tenantSubscription.findUnique({ where: { tenantId: conn.tenantId } });
      if (plan && !planActive(plan, now)) return false;
      const key = connectionKey(conn.id);
      const existing = await tx.group.findUnique({
        where: { connectionKey_whatsappGroupId: { connectionKey: key, whatsappGroupId: cmd.groupId } }
      });
      if (existing && existing.tenantId && existing.tenantId !== conn.tenantId) return false;
      const used = await tx.group.count({ where: { tenantId: conn.tenantId } });
      const maxGroups = commercialLimits(plan?.planCode ?? "PILOT", {
        groupLimit: plan?.groupLimit ?? cfg.SAAS_MAX_GROUPS,
        whatsappConnectionLimit: plan?.whatsappConnectionLimit ?? 0
      }).groups;
      if ((!existing || !existing.tenantId) && used >= maxGroups) return false;
      const consumed = await tx.groupActivation.updateMany({
        where: { id: claim.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now }
      });
      if (consumed.count !== 1) return false;
      const group = existing
        ? await tx.group.update({ where: { id: existing.id },
            data: { tenantId: conn.tenantId, claimedAt: now,
              consentAt: now, enabled: true, name: cmd.groupName, targetLanguages: defaults } })
        : await tx.group.create({ data: {
            connectionId: conn.id, connectionKey: key,
            whatsappGroupId: cmd.groupId, tenantId: conn.tenantId,
            gateway: "WEB", name: cmd.groupName,
            enabled: true, claimedAt: now, consentAt: now, targetLanguages: defaults
          } });
      await tx.groupActivation.update({ where: { id: claim.id },
        data: { activatedGroupId: group.id } });
      await tx.tenantAudit.create({ data: { tenantId: conn.tenantId,
        actorId: claim.createdBy, groupId: group.id, action: "CUSTOMER_NUMBER_GROUP_ACTIVATED" } });
      return true;
    });
    return success ? { activated: true } :
      reply.code(403).send({ error: "Activation rejected" });
  });

  app.post("/internal/byon/state", async (req, reply) => {
    if (!byonAuthorized(req.headers.authorization, cfg))
      return reply.code(401).send({ error: "Unauthorized" });
    const input = z.object({
      connectionId: z.string().refine(isConnectionId),
      status: z.enum(["PAIRING","CONNECTED","DISCONNECTED","REQUIRES_REPAIR"]),
      phoneLast4: z.string().regex(/^[0-9]{4}$/).optional()
    }).strict().parse(req.body);
    const changed = await prisma.customerWhatsAppConnection.updateMany({
      where: { id: input.connectionId, active: true },
      data: { status: input.status,
        ...(input.status === "CONNECTED" ? { lastSeenAt: new Date() } : {}),
        ...(input.phoneLast4 ? { phoneLast4: input.phoneLast4 } : {}) }
    });
    return reply.code(changed.count ? 200 : 404).send({ accepted: !!changed.count });
  });

  app.get("/internal/byon/bootstrap", async (req, reply) => {
    if (!byonAuthorized(req.headers.authorization, cfg))
      return reply.code(401).send({ error: "Unauthorized" });
    const rules = await policy(prisma);
    if (!rules.customerNumbersEnabled) return { connectionIds: [] };
    const kinds: Array<"PERSONAL" | "BUSINESS"> = [];
    if (rules.personalEnabled) kinds.push("PERSONAL");
    if (rules.businessEnabled) kinds.push("BUSINESS");
    const items = await prisma.customerWhatsAppConnection.findMany({
      where: {
        active: true,
        kind: { in: kinds },
        status: { in: ["CONNECTED", "DISCONNECTED", "PAIRING"] }
      },
      select: { id: true }
    });
    return { connectionIds: items.map(x => x.id) };
  });
}
