import Fastify from "fastify";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "./db.js";
import { loadConfig } from "./config.js";
import { DEFAULT_TARGET_LANGUAGES, LANGUAGE_NAMES, isLanguage, normalizeLanguageCode } from "./languages.js";
import { createTranslationProvider } from "./translation.js";
import { extractGroupMessages, verifySignature } from "./whatsapp.js";
import { processPending } from "./processor.js";

const cfg = loadConfig();
const app = Fastify({ logger: { redact: ["req.headers.authorization", "req.headers.x-hub-signature-256"] }, bodyLimit: 256 * 1024 });
const provider = createTranslationProvider(cfg);

function safeToken(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const targets = z.array(
  z.string().transform(normalizeLanguageCode).refine(isLanguage, "Unsupported language")
).min(1).max(DEFAULT_TARGET_LANGUAGES.length)
  .refine(v => new Set(v).size === v.length, "Duplicate language");
const groupSchema = z.object({
  groupId: z.string().min(1).max(191),
  name: z.string().trim().min(1).max(191),
  enabled: z.boolean().default(true),
  targetLanguages: targets.default([...DEFAULT_TARGET_LANGUAGES])
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
  try { done(null, JSON.parse((body as Buffer).toString("utf8"))); }
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

async function enqueue(groupId: string, messageId: string, senderId: string, text: string) {
  // Ignore our own translated group replies (including group webhook echoes).
  if (text.startsWith("🌐 ")) return false;
  if (await prisma.message.findFirst({ where: { outboundMessageId: messageId }, select: { id: true } })) return false;
  const group = await prisma.group.findUnique({ where: { whatsappGroupId: groupId } });
  if (!group || !group.enabled) return false; // fail closed: only explicitly registered groups
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
    if (await enqueue(message.groupId, message.messageId, message.senderId, message.text)) accepted++;
  }
  return reply.send({ received: true, accepted });
});

app.get("/api/languages", async () => ({
  languages: DEFAULT_TARGET_LANGUAGES.map(code => ({ code, name: LANGUAGE_NAMES[code] })),
  defaultTargetLanguages: [...DEFAULT_TARGET_LANGUAGES]
}));

app.get("/api/groups", async () => {
  const groups = await prisma.group.findMany({ orderBy: { createdAt: "desc" } });
  return { groups };
});

app.post("/api/groups", async (request, reply) => {
  const data = groupSchema.parse(request.body);
  const group = await prisma.group.upsert({
    where: { whatsappGroupId: data.groupId },
    create: { whatsappGroupId: data.groupId, name: data.name, enabled: data.enabled, targetLanguages: data.targetLanguages },
    update: { name: data.name, enabled: data.enabled, targetLanguages: data.targetLanguages }
  });
  return reply.code(201).send({ group });
});

app.patch<{ Params: { groupId: string } }>("/api/groups/:groupId", async (request, reply) => {
  const data = editGroupSchema.parse(request.body);
  if (!Object.keys(data).length) return reply.code(400).send({ error: "No changes supplied" });
  const group = await prisma.group.findUnique({ where: { whatsappGroupId: request.params.groupId } });
  if (!group) return reply.code(404).send({ error: "Group not found" });
  const updated = await prisma.group.update({ where: { id: group.id }, data });
  return { group: updated };
});

app.get("/api/messages", async (request) => {
  const q = z.object({ groupId: z.string().min(1).optional() }).parse(request.query);
  const group = q.groupId ? await prisma.group.findUnique({ where: { whatsappGroupId: q.groupId } }) : null;
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
  const accepted = await enqueue(data.groupId, data.messageId || randomUUID(), data.senderId, data.text);
  if (!accepted) return reply.code(409).send({ accepted: false, reason: "Unknown/disabled group or duplicate message ID" });
  return reply.code(202).send({ accepted: true, note: "Translation will be processed asynchronously; no WhatsApp message is sent." });
});

let processing = false;
const timer = setInterval(async () => {
  if (processing) return;
  processing = true;
  try { await processPending(prisma, provider, cfg); }
  catch (err) { app.log.error({ err }, "Worker cycle failed"); }
  finally { processing = false; }
}, 2000);
timer.unref();

async function shutdown() {
  clearInterval(timer);
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
