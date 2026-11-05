import Fastify from "fastify";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "./db.js";
import { loadConfig } from "./config.js";
import { MAX_GROUP_LANGUAGES, normalizeLanguageCode, loadEnabledLanguages, defaultGroupLanguages, validateTargetLanguages } from "./languages.js";
import { createTranslationProvider } from "./translation.js";
import { extractGroupMessages, verifySignature } from "./whatsapp.js";
import { processPending } from "./processor.js";
import { isWebGroupId, type GatewayKind } from "./gateways.js";
import { registerPortalRoutes } from "./portal.js";
import { registerByonPortalRoutes } from "./byon-portal.js";
import { byonAuthorized, connectionKey, connectionTypeAllowed } from "./byon-shared.js";
import { registerPlatformRoutes } from "./platform.js";
import { registerAlertsRoutes } from "./alerts-routes.js";
import { ingestWatchedMessage, processPendingAlerts } from "./alerts-service.js";
import { processAlertDeliveries } from "./alerts-delivery.js";
import { ingestTenantMessage } from "./quotas.js";
import { runRetention } from "./retention.js";
import { parseRequestJson } from "./json-body.js";
import { checkGatewayHealth } from "./gateway-health.js";

const cfg = loadConfig();
const app = Fastify({ logger: { redact: ["req.headers.authorization", "req.headers.x-hub-signature-256"] }, bodyLimit: 256 * 1024 });
const provider = createTranslationProvider(cfg);
registerPortalRoutes(app, prisma, cfg);
registerByonPortalRoutes(app, prisma, cfg);
registerPlatformRoutes(app, prisma, cfg);
registerAlertsRoutes(app, prisma, cfg);

function safeToken(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const targets = z.array(z.string().transform(normalizeLanguageCode))
  .min(1).max(MAX_GROUP_LANGUAGES)
  .refine(v => new Set(v).size === v.length, "Duplicate language");
const groupSchema = z.object({
  groupId: z.string().min(1).max(191),
  name: z.string().trim().min(1).max(191),
  enabled: z.boolean().default(true),
  gateway: z.enum(["official", "web"]).default("official"),
  targetLanguages: targets.optional()
}).strict();
const editGroupSchema = z.object({
  name: z.string().trim().min(1).max(191).optional(),
  enabled: z.boolean().optional(),
  targetLanguages: targets.optional()
}).strict();
const simulationSchema = z.object({
  groupId: z.string().min(1).max(191),
  senderId: z.string().min(1).max(191).default("demo-user"),
  messageId: z.string().min(1).max(191).optional(),
  text: z.string().trim().min(1).max(1000)
}).strict();

// Preserve the original JSON bytes so Meta's HMAC signature is verified correctly.
app.removeContentTypeParser("application/json");
app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
  (request as typeof request & { rawBody?: Buffer }).rawBody = body as Buffer;
  try { done(null, parseRequestJson(request.method, body as Buffer)); }
  catch (error) { done(error as Error, undefined); }
});

app.addHook("onRequest", async (request, reply) => {
  if (!request.url.startsWith("/api/")) return;
  const authorization = request.headers.authorization;
  if (!safeToken(authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined, cfg.ADMIN_API_KEY)) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
});

app.setErrorHandler((err, request, reply) => {
  if (err instanceof z.ZodError) return reply.code(400).send({ error: "Invalid request", issues: err.issues });
  request.log.error({ err }, "Request failed");
  const rawStatus = err instanceof Error && "statusCode" in err && typeof err.statusCode === "number"
    ? err.statusCode : 500;
  const statusCode = rawStatus >= 400 && rawStatus < 500 ? rawStatus : 500;
  const message = statusCode < 500 && err instanceof Error ? err.message : "Internal server error";
  return reply.code(statusCode).send({ error: message });
});

app.get("/healthz", async () => ({ ok: true, dryRun: cfg.dryRun, translationProvider: cfg.TRANSLATION_PROVIDER }));
app.get("/readyz", async (_request, reply) => {
  try { await prisma.$queryRawUnsafe("SELECT 1"); return { ready: true }; }
  catch { return reply.code(503).send({ ready: false }); }
});

app.get("/webhooks/whatsapp", async (request, reply) => {
  const q = request.query as Record<string, unknown>;
  if (q["hub.mode"] !== "subscribe" ||
      !safeToken(typeof q["hub.verify_token"] === "string" ? q["hub.verify_token"] : undefined, cfg.WHATSAPP_VERIFY_TOKEN) ||
      typeof q["hub.challenge"] !== "string") {
    return reply.code(403).send("Verification rejected");
  }
  return reply.type("text/plain").send(q["hub.challenge"]);
});

async function enqueue(groupId: string, messageId: string, senderId: string, text: string, gateway: GatewayKind, key = "shared") {
  // Ignore our own translated group replies (including group webhook echoes).
  if (text.startsWith("🌐 ")) return false;
  if (await prisma.message.findFirst({ where: { outboundMessageId: messageId }, select: { id: true } })) return false;
  const group = await prisma.group.findUnique({ where: { connectionKey_whatsappGroupId: { connectionKey: key, whatsappGroupId: groupId } } });
  if (!group || !group.enabled || group.gateway !== gateway) return false; // fail closed: channel-locked allowlist
  if (key !== "shared") {
    const c = await prisma.customerWhatsAppConnection.findUnique({
      where: { id: key.slice(5) }
    });
    const rules = await prisma.whatsAppConnectionPolicy.findUnique({ where: { id: "global" } });
    if (!c || !c.active || c.status !== "CONNECTED" || c.id !== group.connectionId ||
        !group.tenantId || group.tenantId !== c.tenantId ||
        !rules || !connectionTypeAllowed(rules, c.kind)) return false;
  }
  if (group.tenantId) {
    if (!group.consentAt) return false;
    const subscription = await prisma.tenantSubscription.findUnique({
      where: { tenantId: group.tenantId },
      select: { translationEnabled: true }
    });
    if (subscription?.translationEnabled === false) return false;
    return ingestTenantMessage(prisma, cfg, {
      tenantId: group.tenantId, groupId: group.id,
      messageId, senderId, text
    });
  }
  const saved = await prisma.message.createMany({
    data: [{ groupId: group.id, externalMessageId: messageId, senderId, originalText: text }],
    skipDuplicates: true
  });
  return saved.count > 0;
}

app.post("/webhooks/whatsapp", async (request, reply) => {
  const rawBody = (request as typeof request & { rawBody?: Buffer }).rawBody;
  if (!cfg.WHATSAPP_APP_SECRET || !rawBody ||
      !verifySignature(rawBody, request.headers["x-hub-signature-256"] as string | undefined, cfg.WHATSAPP_APP_SECRET)) {
    return reply.code(401).send({ error: "Invalid webhook signature" });
  }
  const messages = extractGroupMessages(request.body);
  let accepted = 0;
  for (const message of messages) {
    if (await enqueue(message.groupId, message.messageId, message.senderId, message.text, "OFFICIAL")) accepted++;
  }
  return reply.send({ received: true, accepted });
});

const webIngress = z.object({
  groupId: z.string().min(1).max(191).refine(isWebGroupId, "Invalid Web group JID"),
  messageId: z.string().min(1).max(191),
  senderId: z.string().min(1).max(191),
  text: z.string().trim().min(1).max(1000)
}).strict();

// Private Docker-only service-to-service ingress; never proxy this route publicly.
app.post("/internal/web/message", async (request, reply) => {
  const header = request.headers.authorization;
  if (!cfg.webEnabled || !cfg.WEB_GATEWAY_TOKEN ||
      !safeToken(header?.startsWith("Bearer ") ? header.slice(7) : undefined, cfg.WEB_GATEWAY_TOKEN)) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  const m = webIngress.parse(request.body);
  const accepted = await enqueue(m.groupId, m.messageId, m.senderId, m.text, "WEB");
  return reply.code(202).send({ accepted });
});

const byonIngress = webIngress.extend({
  connectionId: z.string().regex(/^c[a-z0-9]{18,35}$/),
  // Only authenticated gateway metadata; privacy LIDs are not telephone numbers.
  senderPhone: z.string().regex(/^\+[1-9][0-9]{7,14}$/).optional()
});
app.post("/internal/byon/message", async (request, reply) => {
  if (!byonAuthorized(request.headers.authorization, cfg))
    return reply.code(401).send({ error: "Unauthorized" });
  const m = byonIngress.parse(request.body);
  // Two isolated pipelines receive the same authenticated live event.
  // Failure in one never prevents delivery to the other.
  const [translation, alerts] = await Promise.allSettled([
    enqueue(m.groupId, m.messageId, m.senderId, m.text, "WEB", connectionKey(m.connectionId)),
    ingestWatchedMessage(prisma, cfg, {
      connectionId: m.connectionId, groupId: m.groupId,
      messageId: m.messageId, text: m.text, senderPhone: m.senderPhone ?? null
    })
  ]);
  if (translation.status === "rejected") app.log.error("Translation ingest failed");
  if (alerts.status === "rejected") app.log.error("Smart Alerts ingest failed");
  const translated = translation.status === "fulfilled" && translation.value;
  const watched = alerts.status === "fulfilled" && alerts.value;
  return reply.code(202).send({ accepted: translated || watched });
});

app.get("/api/gateways", async () => {
  let webStatus: "disabled" | "connected" | "disconnected" | "unreachable" = "disabled";
  if (cfg.webEnabled && cfg.WEB_GATEWAY_TOKEN) {
    try {
      const result = await fetch(cfg.WEB_GATEWAY_URL + "/status", {
        headers: { authorization: "Bearer " + cfg.WEB_GATEWAY_TOKEN },
        signal: AbortSignal.timeout(2000)
      });
      const body = await result.json() as { connected?: boolean };
      webStatus = result.ok ? (body.connected === true ? "connected" : "disconnected") : "unreachable";
    } catch { webStatus = "unreachable"; }
  }
  return {
    official: { configured: Boolean(cfg.WHATSAPP_ACCESS_TOKEN && cfg.WHATSAPP_PHONE_NUMBER_ID) },
    web: { enabled: cfg.webEnabled, status: webStatus },
    dryRun: cfg.dryRun,
    note: "Gateways operate on separate registered groups; automatic cross-group failover is prohibited."
  };
});

app.get("/api/web/groups", async (_request, reply) => {
  if (!cfg.webEnabled || !cfg.WEB_GATEWAY_TOKEN) {
    return reply.code(503).send({ error: "Web gateway disabled" });
  }
  try {
    const response = await fetch(cfg.WEB_GATEWAY_URL + "/groups", {
      headers: { authorization: "Bearer " + cfg.WEB_GATEWAY_TOKEN },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return reply.code(503).send({ error: "Web gateway not connected" });
    const result = await response.json() as { groups?: Array<{ groupId?: string; name?: string }> };
    return {
      groups: (result.groups || []).filter(item =>
        typeof item.groupId === "string" && isWebGroupId(item.groupId) &&
        typeof item.name === "string"
      ).map(item => ({ groupId: item.groupId, name: item.name })).slice(0, 300)
    };
  } catch {
    return reply.code(503).send({ error: "Web gateway unavailable" });
  }
});

const reconcileSchema = z.object({
  action: z.enum(["mark_delivered", "retry"])
}).strict();

// Delivery-uncertain events are *never* automatically resent. An operator must
// inspect WhatsApp delivery history before choosing to retry (possible duplicate).
app.post<{ Params: { id: string } }>("/api/messages/:id/reconcile",
  async (request, reply) => {
    const input = reconcileSchema.parse(request.body);
    const msg = await prisma.message.findUnique({
      where: { id: request.params.id }, include: { group: true }
    });
    if (!msg || !["DELIVERY_UNCERTAIN", "FAILED"].includes(msg.status)) {
      return reply.code(404).send({ error: "Message not available for reconciliation" });
    }
    const updated = await prisma.message.updateMany({
      where: { id: msg.id, status: { in: ["DELIVERY_UNCERTAIN", "FAILED"] } },
      data: input.action === "retry"
        ? {
            status: "PENDING", sendStartedAt: null,
            nextAttemptAt: new Date(), lastError: "Manual retry approved by operator"
          }
        : {
            status: "COMPLETED", sendStartedAt: null,
            processedAt: new Date(), lastError: "Operator confirmed delivery"
          }
    });
    if (!updated.count) return reply.code(409).send({ error: "Message state changed" });
    if (msg.group.tenantId) await prisma.tenantAudit.create({
      data: {
        tenantId: msg.group.tenantId, groupId: msg.groupId,
        action: input.action === "retry" ? "DELIVERY_RETRY_BY_OPERATOR" : "DELIVERY_CONFIRMED_BY_OPERATOR"
      }
    });
    return { reconciled: true, action: input.action };
  }
);

const planAdminSchema = z.object({
  planCode: z.string().trim().regex(/^[A-Z0-9_-]{2,30}$/),
  status: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED"]),
  groupLimit: z.number().int().min(0).max(1000),
  monthlyMessages: z.number().int().min(0).max(1_000_000),
  periodEnd: z.string().datetime().nullable().optional()
}).strict();

// This path is covered by the existing global ADMIN_API_KEY authentication and
// must remain bound to localhost; customers cannot change their own plan.
app.patch<{ Params: { tenantId: string } }>("/api/tenants/:tenantId/subscription",
  async (request, reply) => {
    const body = planAdminSchema.parse(request.body);
    const tenant = await prisma.tenant.findUnique({
      where: { id: request.params.tenantId }, select: { id: true }
    });
    if (!tenant) return reply.code(404).send({ error: "Workspace not found" });
    const plan = await prisma.tenantSubscription.upsert({
      where: { tenantId: tenant.id },
      create: {
        tenantId: tenant.id,
        planCode: body.planCode, status: body.status,
        groupLimit: body.groupLimit, monthlyMessages: body.monthlyMessages,
        periodEnd: body.periodEnd ? new Date(body.periodEnd) : null
      },
      update: {
        planCode: body.planCode, status: body.status,
        groupLimit: body.groupLimit, monthlyMessages: body.monthlyMessages,
        periodEnd: body.periodEnd ? new Date(body.periodEnd) : null
      }
    });
    await prisma.tenantAudit.create({
      data: { tenantId: tenant.id, action: "PLAN_UPDATED_BY_OPERATOR" }
    });
    return {
      tenantId: tenant.id, planCode: plan.planCode, status: plan.status,
      groups: plan.groupLimit, messagesPerMonth: plan.monthlyMessages,
      periodEnd: plan.periodEnd
    };
  }
);

app.get("/api/ops/health", async () => ({
  gateway: await prisma.gatewayHealth.findUnique({ where: { name: "web" } }),
  retentionDays: cfg.MESSAGE_RETENTION_DAYS
}));

app.get("/api/languages", async () => {
  const languages = await loadEnabledLanguages(prisma);
  return {
    languages,
    defaultTargetLanguages: defaultGroupLanguages(languages),
    maxPerGroup: MAX_GROUP_LANGUAGES
  };
});

app.get("/api/groups", async () => {
  const groups = await prisma.group.findMany({ orderBy: { createdAt: "desc" } });
  return { groups };
});

app.post("/api/groups", async (request, reply) => {
  const data = groupSchema.parse(request.body);
  const enabledLanguages = await loadEnabledLanguages(prisma);
  const selectedLanguages = data.targetLanguages ?? defaultGroupLanguages(enabledLanguages);
  if (!validateTargetLanguages(selectedLanguages, enabledLanguages)) {
    return reply.code(400).send({ error: "Select languages enabled by the platform (maximum 10)" });
  }
  if (data.gateway === "web" && !isWebGroupId(data.groupId)) {
    return reply.code(400).send({ error: "Web group IDs must end in @g.us" });
  }
  const gateway: GatewayKind = data.gateway === "web" ? "WEB" : "OFFICIAL";
  const existing = await prisma.group.findUnique({ where: { connectionKey_whatsappGroupId: { connectionKey: "shared", whatsappGroupId: data.groupId } } });
  if (existing && existing.gateway !== gateway) {
    return reply.code(409).send({ error: "Existing group is locked to a different gateway" });
  }
  const group = await prisma.group.upsert({
    where: { connectionKey_whatsappGroupId: { connectionKey: "shared", whatsappGroupId: data.groupId } },
    create: { whatsappGroupId: data.groupId, gateway, name: data.name, enabled: data.enabled, targetLanguages: selectedLanguages },
    update: { name: data.name, enabled: data.enabled, targetLanguages: selectedLanguages }
  });
  return reply.code(201).send({ group });
});

app.patch<{ Params: { groupId: string } }>("/api/groups/:groupId", async (request, reply) => {
  const data = editGroupSchema.parse(request.body);
  if (data.targetLanguages &&
      !validateTargetLanguages(data.targetLanguages, await loadEnabledLanguages(prisma))) {
    return reply.code(400).send({ error: "Unsupported or disabled target languages" });
  }
  if (!Object.keys(data).length) return reply.code(400).send({ error: "No changes supplied" });
  const group = await prisma.group.findUnique({ where: { connectionKey_whatsappGroupId: { connectionKey: "shared", whatsappGroupId: request.params.groupId } } });
  if (!group) return reply.code(404).send({ error: "Group not found" });
  const updated = await prisma.group.update({ where: { id: group.id }, data });
  if (data.targetLanguages) await prisma.message.updateMany({
    where: {
      groupId: group.id, status: "PENDING", sendStartedAt: null,
      outputText: { not: null }
    },
    data: { outputText: null, sourceLanguage: null }
  });
  return { group: updated };
});

app.get("/api/messages", async (request) => {
  const q = z.object({ groupId: z.string().min(1).optional() }).parse(request.query);
  const group = q.groupId ? await prisma.group.findUnique({ where: { connectionKey_whatsappGroupId: { connectionKey: "shared", whatsappGroupId: q.groupId } } }) : null;
  if (q.groupId && !group) return { messages: [] };
  const messages = await prisma.message.findMany({
    where: group ? { groupId: group.id } : undefined,
    orderBy: { createdAt: "desc" }, take: 50,
    select: {
      id: true, externalMessageId: true, senderId: true, status: true,
      sourceLanguage: true, outputText: true, attempts: true,
      lastError: true, createdAt: true, processedAt: true
    }
  });
  return { messages };
});

app.post("/api/simulate", async (request, reply) => {
  if (!cfg.dryRun) return reply.code(403).send({ error: "Simulation is only enabled in DRY_RUN mode" });
  const data = simulationSchema.parse(request.body);
  const accepted = await enqueue(data.groupId, data.messageId || randomUUID(), data.senderId, data.text,
    (await prisma.group.findUnique({ where: { connectionKey_whatsappGroupId: { connectionKey: "shared", whatsappGroupId: data.groupId } }, select: { gateway: true } }))?.gateway || "OFFICIAL");
  if (!accepted) return reply.code(409).send({ accepted: false, reason: "Unknown/disabled group or duplicate message ID" });
  return reply.code(202).send({ accepted: true, note: "Translation will be processed asynchronously; no WhatsApp message is sent." });
});

// Periodic cleanup and connection health operate independently of translation.
let maintenance = false;
const maintenanceTimer = setInterval(async () => {
  if (maintenance) return;
  maintenance = true;
  try {
    await runRetention(prisma, cfg);
  } catch (err) {
    app.log.error({ err }, "Retention cycle failed");
  } finally { maintenance = false; }
}, 60 * 60_000);
maintenanceTimer.unref();

let checkingConnection = false;
const healthTimer = setInterval(async () => {
  if (checkingConnection) return;
  checkingConnection = true;
  try { await checkGatewayHealth(prisma, cfg); }
  catch (err) { app.log.error({ err }, "Gateway monitoring cycle failed"); }
  finally { checkingConnection = false; }
}, 30_000);
healthTimer.unref();

let processing = false;
const timer = setInterval(async () => {
  if (processing) return;
  processing = true;
  try { await processPending(prisma, provider, cfg); }
  catch (err) { app.log.error({ err }, "Worker cycle failed"); }
  finally { processing = false; }
}, 500);
timer.unref();

// A separate timer/queue can be paused or removed without changing translations.
let processingAlerts = false;
const alertsTimer = setInterval(async () => {
  if (processingAlerts) return;
  processingAlerts = true;
  try { await processPendingAlerts(prisma, cfg); }
  catch { app.log.error("Smart Alerts worker cycle failed"); }
  finally { processingAlerts = false; }
}, 1200);
alertsTimer.unref();

// Optional customer-selected WhatsApp alert group: independent of translation.
let sendingAlerts = false;
const deliveryTimer = setInterval(async () => {
  if (sendingAlerts) return;
  sendingAlerts = true;
  try { await processAlertDeliveries(prisma, cfg); }
  catch { app.log.error("Smart Alerts notification cycle failed"); }
  finally { sendingAlerts = false; }
}, 4000);
deliveryTimer.unref();

async function shutdown() {
  clearInterval(timer);
  clearInterval(alertsTimer);
  clearInterval(deliveryTimer);
  clearInterval(maintenanceTimer);
  clearInterval(healthTimer);
  await app.close();
  await prisma.$disconnect();
}
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });

try {
  await prisma.$connect();
  await app.listen({ host: cfg.HOST, port: cfg.PORT });
} catch (err) {
  app.log.error({ err }, "Startup failed");
  await shutdown();
  process.exitCode = 1;
}
