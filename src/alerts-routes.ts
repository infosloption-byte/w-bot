import { z } from "zod";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import { requirePortalAuth, requireMutationHeader } from "./portal-auth.js";
import { planActive, monthKey } from "./quotas.js";
import { byonRequest, connectionTypeAllowed, isConnectionId } from "./byon-shared.js";
import { isWebGroupId } from "./gateways.js";

const editMode = z.object({ enabled: z.boolean() }).strict();
const sourceInput = z.object({
  connectionId: z.string().refine(isConnectionId),
  groupId: z.string().refine(isWebGroupId),
  consentConfirmed: z.literal(true)
}).strict();
const ruleShape = z.object({
  name: z.string().trim().min(2).max(100),
  category: z.enum(["GENERIC", "TOUR"]).default("GENERIC"),
  keywords: z.string().trim().min(2).max(500).refine(
    value => value.split(",").some(word => word.trim().length >= 2),
    "Add at least one matching phrase"
  ),
  origin: z.string().trim().max(100).nullable().optional(),
  destination: z.string().trim().max(100).nullable().optional(),
  minPrice: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  maxPrice: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  requireContact: z.boolean().default(false),
  enabled: z.boolean().default(true)
}).strict();
const validFare = (value: { minPrice?: number | null; maxPrice?: number | null }) =>
  value.minPrice == null || value.maxPrice == null || value.minPrice <= value.maxPrice;
const ruleInput = ruleShape.refine(validFare, "Minimum fare cannot exceed maximum fare");
const patchRule = ruleShape.partial().refine(
  value => Object.keys(value).length > 0 && validFare(value),
  "Set at least one field and keep fare bounds valid"
);
const isAdmin = (role: string) => role !== "VIEWER";
const ensureCurrentAlerts = async (prisma: PrismaClient, tenantId: string) => {
  const sub = await prisma.alertSubscription.findUnique({ where: { tenantId } });
  return sub && planActive(sub) ? sub : null;
};

export function registerAlertsRoutes(app: FastifyInstance, prisma: PrismaClient, cfg: Config): void {
  if (!cfg.saasEnabled) return;
  app.get("/portal/api/features", async (req, reply) => {
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    const [translation, alerts] = await Promise.all([
      prisma.tenantSubscription.findUnique({ where: { tenantId: user.tenantId } }),
      prisma.alertSubscription.findUnique({ where: { tenantId: user.tenantId } })
    ]);
    return {
      billingEnabled: false,
      translation: {
        subscribed: !!translation, enabled: translation?.translationEnabled ?? true,
        active: !!translation && planActive(translation),
        planCode: translation?.planCode ?? "PILOT", status: translation?.status ?? "TRIAL"
      },
      alerts: {
        subscribed: !!alerts, enabled: alerts?.enabled ?? false,
        active: !!alerts && planActive(alerts),
        planCode: alerts?.planCode ?? null, status: alerts?.status ?? "NOT_SUBSCRIBED",
        limits: alerts ? {
          groups: alerts.maxGroups, connections: alerts.maxConnections, rules: alerts.maxRules, matchesPerMonth: alerts.maxMatchesPerMonth
        } : null
      }
    };
  });

  app.patch("/portal/api/features/translation", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    if (!isAdmin(user.role)) return reply.code(403).send({ error: "Workspace admin required" });
    const input = editMode.parse(req.body);
    const subscription = await prisma.tenantSubscription.findUnique({
      where: { tenantId: user.tenantId }
    });
    if (!subscription || (input.enabled && !planActive(subscription)))
      return reply.code(403).send({ error: "Active translation subscription required" });
    await prisma.tenantSubscription.update({
      where: { tenantId: user.tenantId }, data: { translationEnabled: input.enabled }
    });
    await prisma.tenantAudit.create({ data: {
      tenantId: user.tenantId, actorId: user.userId,
      action: input.enabled ? "TRANSLATION_ENABLED" : "TRANSLATION_PAUSED"
    } });
    return { enabled: input.enabled };
  });

  app.patch("/portal/api/features/alerts", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    if (!isAdmin(user.role)) return reply.code(403).send({ error: "Workspace admin required" });
    const input = editMode.parse(req.body);
    const subscription = await prisma.alertSubscription.findUnique({
      where: { tenantId: user.tenantId }
    });
    if (!subscription || (input.enabled && !planActive(subscription)))
      return reply.code(403).send({ error: "Separate Smart Alerts subscription required" });
    await prisma.alertSubscription.update({
      where: { tenantId: user.tenantId }, data: { enabled: input.enabled }
    });
    await prisma.tenantAudit.create({ data: {
      tenantId: user.tenantId, actorId: user.userId,
      action: input.enabled ? "ALERTS_ENABLED" : "ALERTS_PAUSED"
    } });
    return { enabled: input.enabled };
  });

  app.get("/portal/api/alerts/groups", async (req, reply) => {
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    const groups = await prisma.watchGroup.findMany({
      where: { tenantId: user.tenantId }, orderBy: { createdAt: "desc" },
      select: { id: true, name: true, enabled: true, connectionId: true,
        whatsappGroupId: true, createdAt: true, consentAt: true }
    });
    return { groups };
  });

  app.post("/portal/api/alerts/groups", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    if (!isAdmin(user.role)) return reply.code(403).send({ error: "Workspace admin required" });
    const input = sourceInput.parse(req.body);
    const conn = await prisma.customerWhatsAppConnection.findFirst({
      where: { id: input.connectionId, tenantId: user.tenantId,
        active: true, status: "CONNECTED" }
    });
    if (!conn || cfg.BYON_GATEWAY_ENABLED !== "true")
      return reply.code(403).send({ error: "Connected customer number required" });
    const policy = await prisma.whatsAppConnectionPolicy.findUnique({ where: { id: "global" } });
    if (!policy || !connectionTypeAllowed(policy, conn.kind))
      return reply.code(403).send({ error: "Connection unavailable" });
    const subscription = await ensureCurrentAlerts(prisma, user.tenantId);
    if (!subscription?.enabled) return reply.code(403).send({ error: "Enable an active Alerts subscription first" });
    let name: string | undefined;
    try {
      const response = await byonRequest(cfg, "/connections/" + conn.id + "/groups");
      if (!response.ok) return reply.code(503).send({ error: "Could not validate group membership" });
      const discovered = await response.json() as { groups?: Array<{ groupId: string; name: string }> };
      name = discovered.groups?.find(group => group.groupId === input.groupId)?.name;
    } catch { return reply.code(503).send({ error: "Could not validate group membership" }); }
    if (!name) return reply.code(403).send({ error: "This account is not a member of that group" });
    const label = name.slice(0,191);
    try {
      const group = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM Tenant WHERE id = ${user.tenantId} FOR UPDATE`;
        const entitlement = await tx.alertSubscription.findUnique({ where: { tenantId: user.tenantId } });
        if (!entitlement?.enabled || !planActive(entitlement)) return null;
        const used = await tx.watchGroup.count({ where: { tenantId: user.tenantId } });
        if (used >= entitlement.maxGroups) return null;
        const created = await tx.watchGroup.create({ data: {
          tenantId: user.tenantId, connectionId: conn.id,
          whatsappGroupId: input.groupId, name: label, consentAt: new Date()
        } });
        await tx.tenantAudit.create({ data: { tenantId: user.tenantId,
          actorId: user.userId, action: "ALERT_SOURCE_CONNECTED" } });
        return created;
      });
      return group ? reply.code(201).send({ group }) :
        reply.code(409).send({ error: "Alert group allowance reached or subscription inactive" });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return reply.code(409).send({ error: "Group already monitored" });
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>("/portal/api/alerts/groups/:id", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    if (!isAdmin(user.role)) return reply.code(403).send({ error: "Workspace admin required" });
    const input = editMode.parse(req.body);
    const result = await prisma.watchGroup.updateMany({
      where: { id: req.params.id, tenantId: user.tenantId }, data: { enabled: input.enabled }
    });
    if (!result.count) return reply.code(404).send({ error: "Group not found" });
    return { saved: true };
  });

  app.delete<{ Params: { id: string } }>("/portal/api/alerts/groups/:id", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    if (!isAdmin(user.role)) return reply.code(403).send({ error: "Workspace admin required" });
    const deleted = await prisma.watchGroup.deleteMany({
      where: { id: req.params.id, tenantId: user.tenantId }
    });
    if (!deleted.count) return reply.code(404).send({ error: "Group not found" });
    return { removed: true };
  });

  app.get("/portal/api/alerts/rules", async (req, reply) => {
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    return { rules: await prisma.watchRule.findMany({
      where: { tenantId: user.tenantId }, orderBy: { createdAt: "desc" }, take: 100
    }) };
  });

  app.post("/portal/api/alerts/rules", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    if (!isAdmin(user.role)) return reply.code(403).send({ error: "Workspace admin required" });
    const input = ruleInput.parse(req.body);
    const created = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM Tenant WHERE id = ${user.tenantId} FOR UPDATE`;
      const entitlement = await tx.alertSubscription.findUnique({ where: { tenantId: user.tenantId } });
      if (!entitlement?.enabled || !planActive(entitlement)) return null;
      const used = await tx.watchRule.count({ where: { tenantId: user.tenantId } });
      if (used >= entitlement.maxRules) return null;
      return tx.watchRule.create({ data: { ...input, tenantId: user.tenantId } });
    });
    return created ? reply.code(201).send({ rule: created }) :
      reply.code(409).send({ error: "Smart Alerts subscription inactive or rule limit reached" });
  });

  app.patch<{ Params: { id: string } }>("/portal/api/alerts/rules/:id", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    if (!isAdmin(user.role)) return reply.code(403).send({ error: "Workspace admin required" });
    const input = patchRule.parse(req.body);
    const changed = await prisma.watchRule.updateMany({
      where: { id: req.params.id, tenantId: user.tenantId }, data: input
    });
    if (!changed.count) return reply.code(404).send({ error: "Rule not found" });
    return { saved: true };
  });

  app.delete<{ Params: { id: string } }>("/portal/api/alerts/rules/:id", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    if (!isAdmin(user.role)) return reply.code(403).send({ error: "Workspace admin required" });
    const result = await prisma.watchRule.deleteMany({
      where: { id: req.params.id, tenantId: user.tenantId }
    });
    if (!result.count) return reply.code(404).send({ error: "Rule not found" });
    return { removed: true };
  });

  app.get("/portal/api/alerts/inbox", async (req, reply) => {
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    const matches = await prisma.alertMatch.findMany({
      where: { tenantId: user.tenantId }, orderBy: { createdAt: "desc" }, take: 100,
      select: { id: true, summary: true, quotedPrice: true, contactNumber: true,
        isRead: true, createdAt: true,
        rule: { select: { name: true } },
        event: { select: { externalMessageId: true,
          group: { select: { name: true } } } } }
    });
    return { matches };
  });

  app.patch<{ Params: { id: string } }>("/portal/api/alerts/inbox/:id", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    const input = z.object({ isRead: z.boolean() }).strict().parse(req.body);
    const changed = await prisma.alertMatch.updateMany({
      where: { id: req.params.id, tenantId: user.tenantId }, data: input
    });
    if (!changed.count) return reply.code(404).send({ error: "Alert not found" });
    return { saved: true };
  });

  app.get("/portal/api/alerts/usage", async (req, reply) => {
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    const [sub, usage, groups, rules] = await Promise.all([
      prisma.alertSubscription.findUnique({ where: { tenantId: user.tenantId } }),
      prisma.alertUsage.findUnique({ where: { tenantId_month: { tenantId: user.tenantId, month: monthKey() } } }),
      prisma.watchGroup.count({ where: { tenantId: user.tenantId } }),
      prisma.watchRule.count({ where: { tenantId: user.tenantId } })
    ]);
    return { used: usage?.matches ?? 0, groups, rules,
      limits: sub ? { matchesPerMonth: sub.maxMatchesPerMonth, groups: sub.maxGroups, rules: sub.maxRules } : null };
  });
}
