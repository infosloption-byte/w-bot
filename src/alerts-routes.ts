import { z } from "zod";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import { requirePortalAuth, requireMutationHeader } from "./portal-auth.js";
import { planActive, monthKey } from "./quotas.js";
import { byonRequest, connectionTypeAllowed, isConnectionId } from "./byon-shared.js";
import { isWebGroupId } from "./gateways.js";
import { searchParameters } from "./alerts-ai.js";

const editMode = z.object({ enabled: z.boolean() }).strict();
const sourceInput = z.object({
  connectionId: z.string().refine(isConnectionId),
  groupId: z.string().refine(isWebGroupId),
  consentConfirmed: z.literal(true)
}).strict();
const bulkSourceInput = z.object({
  connectionId: z.string().refine(isConnectionId),
  groupIds: z.array(z.string().refine(isWebGroupId)).min(1).max(50)
    .refine(items => new Set(items).size === items.length, "Group IDs must be unique"),
  consentConfirmed: z.literal(true)
}).strict();

// Rules are generic: arbitrary user-defined labels and plain-language values.
// No category, location, fare or keyword field is required in new rules.
const ruleInput = z.object({
  name: z.string().trim().min(2).max(100),
  parameters: searchParameters
}).strict();
const ruleUpdate = ruleInput.partial().extend({ enabled: z.boolean().optional() }).strict()
  .refine(input => Object.keys(input).length > 0);

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
      alertsAiReady: cfg.ALERTS_AI_ENABLED === "true",
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

  // One selected connection, multiple explicitly opted-in groups, atomic quota.
  app.post("/portal/api/alerts/groups/bulk", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    if (!isAdmin(user.role)) return reply.code(403).send({ error: "Workspace admin required" });
    const input = bulkSourceInput.parse(req.body);
    if (cfg.BYON_GATEWAY_ENABLED !== "true")
      return reply.code(403).send({ error: "Customer gateway is unavailable" });
    const conn = await prisma.customerWhatsAppConnection.findFirst({
      where: { id: input.connectionId, tenantId: user.tenantId,
        active: true, status: "CONNECTED" }
    });
    if (!conn) return reply.code(403).send({ error: "Connected customer account required" });
    const policy = await prisma.whatsAppConnectionPolicy.findUnique({ where: { id: "global" } });
    if (!policy || !connectionTypeAllowed(policy, conn.kind))
      return reply.code(403).send({ error: "Connection type unavailable" });
    let discovered: Array<{ groupId: string; name: string }> = [];
    try {
      const response = await byonRequest(cfg, "/connections/" + conn.id + "/groups");
      if (!response.ok) return reply.code(503).send({ error: "Unable to verify group membership" });
      const body = await response.json() as { groups?: Array<{ groupId: string; name: string }> };
      discovered = body.groups ?? [];
    } catch { return reply.code(503).send({ error: "Unable to verify group membership" }); }
    const members = new Map(discovered.filter(g => isWebGroupId(g.groupId))
      .map(g => [g.groupId, g.name]));
    if (!input.groupIds.every(id => members.has(id)))
      return reply.code(403).send({ error: "One or more selected groups are not joined by this account" });
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM Tenant WHERE id = ${user.tenantId} FOR UPDATE`;
      const sub = await tx.alertSubscription.findUnique({ where: { tenantId: user.tenantId } });
      if (!sub?.enabled || !planActive(sub)) return null;
      const existing = await tx.watchGroup.findMany({
        where: { tenantId: user.tenantId, connectionId: conn.id,
          whatsappGroupId: { in: input.groupIds } },
        select: { id: true, whatsappGroupId: true }
      });
      const already = new Set(existing.map(g => g.whatsappGroupId));
      const newIds = input.groupIds.filter(id => !already.has(id));
      const used = await tx.watchGroup.count({ where: { tenantId: user.tenantId } });
      if (used + newIds.length > sub.maxGroups) return null;
      // Reactivate previously paused groups, but never enroll unselected groups.
      if (existing.length) await tx.watchGroup.updateMany({
        where: { tenantId: user.tenantId, id: { in: existing.map(g => g.id) } },
        data: { enabled: true, consentAt: new Date() }
      });
      if (newIds.length) await tx.watchGroup.createMany({ data: newIds.map(id => ({
        tenantId: user.tenantId, connectionId: conn.id, whatsappGroupId: id,
        name: (members.get(id) ?? "").slice(0, 191), enabled: true,
        consentAt: new Date()
      })) });
      await tx.tenantAudit.create({ data: {
        tenantId: user.tenantId, actorId: user.userId, action: "ALERT_SOURCES_SELECTED"
      } });
      return { added: newIds.length, enabled: input.groupIds.length };
    });
    if (!result) return reply.code(409).send({
      error: "Not enough group slots or Smart Alerts subscription inactive"
    });
    return reply.code(201).send(result);
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
      return tx.watchRule.create({ data: {
        name: input.name, parameters: input.parameters, tenantId: user.tenantId,
        keywords: "", category: "GENERIC"
      } });
    });
    return created ? reply.code(201).send({ rule: created }) :
      reply.code(409).send({ error: "Smart Alerts subscription inactive or rule limit reached" });
  });

  app.patch<{ Params: { id: string } }>("/portal/api/alerts/rules/:id", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    if (!isAdmin(user.role)) return reply.code(403).send({ error: "Workspace admin required" });
    const input = ruleUpdate.parse(req.body);
    const current = await prisma.watchRule.findFirst({
      where: { id: req.params.id, tenantId: user.tenantId },
      select: { id: true }
    });
    if (!current) return reply.code(404).send({ error: "Rule not found" });
    const changed = await prisma.watchRule.updateMany({
      where: { id: current.id, tenantId: user.tenantId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.parameters === undefined ? {} : {
          parameters: input.parameters, keywords: "", category: "GENERIC"
        }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled })
      }
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

  const inboxFilters = z.object({
    read: z.enum(["all", "read", "unread"]).default("all"),
    q: z.string().trim().max(100).optional(),
    group: z.string().max(191).optional(),
    rule: z.string().max(191).optional(),
    page: z.coerce.number().int().min(0).max(20).default(0)
  });
  app.get("/portal/api/alerts/inbox", async (req, reply) => {
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    const query = inboxFilters.parse(req.query);
    const where: Prisma.AlertMatchWhereInput = {
      tenantId: user.tenantId,
      ...(query.read === "all" ? {} : { isRead: query.read === "read" }),
      ...(query.rule ? { watchRuleId: query.rule } : {}),
      ...(query.group ? { event: { watchGroupId: query.group } } : {}),
      ...(query.q ? { OR: [
        { summary: { contains: query.q } },
        { rule: { name: { contains: query.q } } },
        { event: { group: { name: { contains: query.q } } } }
      ] } : {})
    };
    const matches = await prisma.alertMatch.findMany({
      where, orderBy: { createdAt: "desc" }, skip: query.page * 50, take: 51,
      select: { id: true, summary: true, quotedPrice: true, contactNumber: true,
        isRead: true, createdAt: true,
        rule: { select: { id: true, name: true } },
        delivery: { select: { status: true, sentAt: true } },
        event: { select: { externalMessageId: true, watchGroupId: true,
          createdAt: true, group: { select: { name: true } } } } }
    });
    return { matches: matches.slice(0,50), hasMore: matches.length > 50, page: query.page };
  });

  app.get<{ Params: { id: string } }>("/portal/api/alerts/inbox/:id", async (req, reply) => {
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    const match = await prisma.alertMatch.findFirst({
      where: { id: req.params.id, tenantId: user.tenantId },
      select: {
        id: true, summary: true, contactNumber: true, quotedPrice: true,
        isRead: true, createdAt: true, criteriaSnapshot: true,
        rule: { select: { id: true, name: true, parameters: true } },
        delivery: { select: { status: true, sentAt: true, attempts: true } },
        event: { select: {
          externalMessageId: true, createdAt: true, processedAt: true,
          group: { select: { name: true } }
        } }
      }
    });
    if (!match) return reply.code(404).send({ error: "Alert not found" });
    return { match };
  });

  const channelInput = z.object({
    connectionId: z.string().refine(isConnectionId),
    groupId: z.string().refine(isWebGroupId),
    consentConfirmed: z.literal(true)
  }).strict();
  app.get("/portal/api/alerts/notification-channel", async (req, reply) => {
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    const channel = await prisma.alertNotificationChannel.findUnique({
      where: { tenantId: user.tenantId },
      select: { connectionId: true, groupId: true, groupName: true,
        enabled: true, updatedAt: true }
    });
    return { channel };
  });
  app.put("/portal/api/alerts/notification-channel", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    if (!isAdmin(user.role)) return reply.code(403).send({ error: "Workspace admin required" });
    const input = channelInput.parse(req.body);
    const [sub, connection, policy] = await Promise.all([
      ensureCurrentAlerts(prisma, user.tenantId),
      prisma.customerWhatsAppConnection.findFirst({
        where: { id: input.connectionId, tenantId: user.tenantId, active: true, status: "CONNECTED" }
      }),
      prisma.whatsAppConnectionPolicy.findUnique({ where: { id: "global" } })
    ]);
    if (!sub?.enabled || !connection || !policy || !connectionTypeAllowed(policy,connection.kind))
      return reply.code(403).send({ error: "Active subscription and connected account required" });
    const [watched, translation] = await Promise.all([
      prisma.watchGroup.findFirst({ where: {
        tenantId: user.tenantId, connectionId: input.connectionId,
        whatsappGroupId: input.groupId
      } }),
      prisma.group.findFirst({ where: {
        tenantId: user.tenantId, connectionId: input.connectionId,
        whatsappGroupId: input.groupId, enabled: true
      } })
    ]);
    if (watched || translation) return reply.code(409).send({
      error: "Choose a dedicated group not used for monitoring or translation"
    });
    let groupName: string | undefined;
    try {
      const response = await byonRequest(cfg, "/connections/" + connection.id + "/groups");
      if (!response.ok) return reply.code(503).send({ error: "Cannot verify group membership" });
      const result = await response.json() as { groups?: Array<{ groupId: string; name: string }> };
      groupName = result.groups?.find(g => g.groupId === input.groupId)?.name;
    } catch { return reply.code(503).send({ error: "Cannot verify group membership" }); }
    if (!groupName) return reply.code(403).send({ error: "Account is not in the selected group" });
    const channel = await prisma.alertNotificationChannel.upsert({
      where: { tenantId: user.tenantId },
      create: { tenantId: user.tenantId, connectionId: connection.id,
        groupId: input.groupId, groupName: groupName.slice(0,191),
        consentAt: new Date(), enabled: true },
      update: { connectionId: connection.id, groupId: input.groupId,
        groupName: groupName.slice(0,191), consentAt: new Date(), enabled: true }
    });
    // Queued deliveries targeting a previous channel must never be redirected.
    await prisma.alertDelivery.updateMany({
      where: { tenantId: user.tenantId, status: "PENDING",
        OR: [{ connectionId: { not: channel.connectionId } },
          { groupId: { not: channel.groupId } }] },
      data: { status: "CANCELED" }
    });
    return { channel: { connectionId: channel.connectionId, groupId: channel.groupId,
      groupName: channel.groupName, enabled: channel.enabled } };
  });
  app.delete("/portal/api/alerts/notification-channel", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    if (!isAdmin(user.role)) return reply.code(403).send({ error: "Workspace admin required" });
    await prisma.alertNotificationChannel.updateMany({
      where: { tenantId: user.tenantId }, data: { enabled: false }
    });
    await prisma.alertDelivery.updateMany({
      where: { tenantId: user.tenantId, status: "PENDING" },
      data: { status: "CANCELED" }
    });
    return { disabled: true };
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
    return { used: usage?.matches ?? 0, analyses: usage?.analyses ?? 0, groups, rules,
      limits: sub ? {
        matchesPerMonth: sub.maxMatchesPerMonth, analysesPerMonth: sub.maxAnalysesPerMonth,
        groups: sub.maxGroups, rules: sub.maxRules
      } : null };
  });
}
