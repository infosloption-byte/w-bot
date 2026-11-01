import { MessageStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";
import { configuredLanguages, loadEnabledLanguages, normalizeLanguageCode, translationTargets } from "./languages.js";
import { GoogleTranslationError, type TranslationProvider } from "./translation.js";
import { GeminiApiError } from "./gemini.js";
import { sendGatewayText, GatewayUnavailableError } from "./gateways.js";
import { connectionTypeAllowed } from "./byon-shared.js";

const MAX_ATTEMPTS = 3;

export function pickFairMessages<T extends { groupId: string; group: { tenantId?: string | null } }>(
  pending: T[], limit = 10
): T[] {
  const queues = new Map<string, T[]>();
  for (const item of pending) {
    const key = item.group.tenantId || "legacy:" + item.groupId;
    const queue = queues.get(key) ?? [];
    queue.push(item);
    queues.set(key, queue);
  }
  const results: T[] = [];
  while (results.length < limit && queues.size) {
    for (const [key, queue] of queues) {
      const item = queue.shift();
      if (item) results.push(item);
      if (!queue.length) queues.delete(key);
      if (results.length >= limit) break;
    }
  }
  return results;
}

export async function processPending(prisma: PrismaClient, provider: TranslationProvider, cfg: Config): Promise<number> {
  const now = new Date();
  // Recover jobs from a crashed process. Outbound delivery is at-least-once.
  // A crashed worker may have sent a WhatsApp reply but failed to persist its
  // acknowledgement. Do not resend such messages blindly.
  await prisma.message.updateMany({
    where: {
      status: MessageStatus.PROCESSING,
      nextAttemptAt: { lte: now },
      sendStartedAt: { not: null }
    },
    data: {
      status: MessageStatus.DELIVERY_UNCERTAIN,
      lastError: "Send acknowledgement unknown after worker interruption"
    }
  });
  await prisma.message.updateMany({
    where: {
      status: MessageStatus.PROCESSING,
      nextAttemptAt: { lte: now },
      sendStartedAt: null
    },
    data: { status: MessageStatus.PENDING }
  });
  const pending = await prisma.message.findMany({
    where: { status: MessageStatus.PENDING, nextAttemptAt: { lte: now } },
    orderBy: { createdAt: "asc" }, take: 100, include: { group: true }
  });
  // Read the global catalog for each worker pass so an operator's language
  // enable/disable change takes effect on the next newly processed message.
  const catalog = pending.length ? await loadEnabledLanguages(prisma) : [];
  const allowed = new Set(catalog.map(x => x.code));
  const names = Object.fromEntries(catalog.map(x => [x.code, x.name]));
  // Prevent one busy tenant from monopolizing all 10 jobs per tick.
  const fairOrder = pickFairMessages(pending, 10);
  let processed = 0;
  for (const msg of fairOrder) {
    const claimed = await prisma.message.updateMany({
      where: { id: msg.id, status: MessageStatus.PENDING },
      data: {
        status: MessageStatus.PROCESSING, attempts: { increment: 1 },
        nextAttemptAt: new Date(Date.now() + 5 * 60_000)
      }
    });
    if (!claimed.count) continue;
    const startedAt = Date.now();
    const queuedMs = Math.max(0, startedAt - msg.createdAt.getTime());
    let translationMs = 0;
    let sendMs = 0;
    try {
      if (!msg.group.enabled) {
        await prisma.message.update({ where: { id: msg.id },
          data: { status: MessageStatus.COMPLETED, processedAt: new Date() } });
        processed++;
        continue;
      }
      const langs = configuredLanguages(msg.group.targetLanguages, allowed);
      if (!langs.length) {
        await prisma.message.update({
          where: { id: msg.id }, data: {
            status: MessageStatus.COMPLETED, processedAt: new Date(),
            lastError: "No enabled target languages for this group"
          }
        });
        processed++;
        continue;
      }
      let source = msg.sourceLanguage ? normalizeLanguageCode(msg.sourceLanguage) : "";
      let output = msg.outputText;

      if (output === null) {
        const translationStarted = Date.now();
        const results: Record<string, string> = {};
        if (provider.translateBatch) {
          // Gemini does language detection and all translations in ONE request.
          const batch = await provider.translateBatch(msg.originalText, langs, names);
          source = normalizeLanguageCode(batch.sourceLanguage);
          Object.assign(results, batch.translations);
        } else {
          source = source || normalizeLanguageCode(await provider.detect(msg.originalText));
          for (const target of translationTargets(langs, source, allowed)) {
            results[target] = await provider.translate(msg.originalText, source, target);
          }
        }

        const parts: string[] = [];
        // Always include every configured language. When it is the detected
        // source language, preserve the exact input instead of retranslating.
        for (const target of langs) {
          const translated = target === source ? msg.originalText : results[target];
          if (typeof translated !== "string" || !translated.trim()) {
            throw new Error("Translation missing for " + target);
          }
          parts.push("🌐 " + names[target] + "\n" + translated);
        }
        output = parts.join("\n\n");
        if (output.length > 3900) throw new Error("Translation exceeds WhatsApp text limit");
        translationMs = Date.now() - translationStarted;
        await prisma.message.update({
          where: { id: msg.id }, data: { sourceLanguage: source, outputText: output }
        });
      }
      // Recheck ownership/enablement before sending a delayed queued message.
      if (msg.group.tenantId) {
        const liveGroup = await prisma.group.findUnique({
          where: { id: msg.groupId },
          select: { tenantId: true, enabled: true, claimedAt: true, connectionId: true }
        });
        if (!liveGroup || !liveGroup.enabled ||
            liveGroup.tenantId !== msg.group.tenantId ||
            liveGroup.claimedAt?.getTime() !== msg.group.claimedAt?.getTime() ||
            liveGroup.connectionId !== msg.group.connectionId) {
          await prisma.message.update({
            where: { id: msg.id },
            data: { status: MessageStatus.COMPLETED, processedAt: new Date(), lastError: "Group ownership changed before send" }
          });
          processed++;
          continue;
        }
      }
      if (msg.group.connectionId) {
        const connection = await prisma.customerWhatsAppConnection.findUnique({
          where: { id: msg.group.connectionId }
        });
        const policy = await prisma.whatsAppConnectionPolicy.findUnique({ where: { id: "global" } });
        if (!connection || !connection.active || connection.status !== "CONNECTED" ||
            !policy || !connectionTypeAllowed(policy, connection.kind)) {
          throw new GatewayUnavailableError("WEB", "CUSTOMER_CONNECTION_DISABLED");
        }
      }
      const sendStarted = Date.now();
      if (!cfg.dryRun && output) {
        await prisma.message.update({
          where: { id: msg.id }, data: { sendStartedAt: new Date() }
        });
      }
      const sentId = output ? await sendGatewayText(
        cfg,
        msg.group.gateway,
        msg.group.whatsappGroupId,
        output,
        { messageId: msg.externalMessageId, senderId: msg.senderId, text: msg.originalText },
        msg.group.connectionId
      ) : null;
      sendMs = Date.now() - sendStarted;
      await prisma.message.update({
        where: { id: msg.id },
        data: {
          status: MessageStatus.COMPLETED, outboundMessageId: sentId,
          processedAt: new Date(), lastError: null, sendStartedAt: null
        }
      });
      console.info("Translation job completed", {
        id: msg.id, gateway: msg.group.gateway,
        queueDelayMs: queuedMs, translationMs, sendMs,
        totalMs: Date.now() - msg.createdAt.getTime()
      });
      processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown processing error";
      const attempts = msg.attempts + 1;
      const permanentlyInvalid = (error instanceof GoogleTranslationError
        || error instanceof GeminiApiError) && error.isPermanentConfigurationError;
      const mayHaveSent = !cfg.dryRun &&
        !(error instanceof GatewayUnavailableError);
      // Only classify as uncertain if the send was actually marked in the DB.
      const persisted = typeof prisma.message.findUnique === "function"
        ? await prisma.message.findUnique({
            where: { id: msg.id }, select: { sendStartedAt: true }
          })
        : null;
      const uncertain = mayHaveSent && Boolean(persisted?.sendStartedAt);
      await prisma.message.update({
        where: { id: msg.id },
        data: {
          status: uncertain ? MessageStatus.DELIVERY_UNCERTAIN :
            permanentlyInvalid || (attempts >= MAX_ATTEMPTS && !(error instanceof GatewayUnavailableError))
              ? MessageStatus.FAILED : MessageStatus.PENDING,
          sendStartedAt: uncertain ? persisted!.sendStartedAt : null,
          lastError: (uncertain ? "Delivery acknowledgement uncertain: " : "") + message.slice(0, 420),
          nextAttemptAt: new Date(Date.now() + (error instanceof GatewayUnavailableError ? 60_000 : Math.min(60_000, 5_000 * 2 ** attempts)))
        }
      });
      console.error("Message processing failed", { id: msg.id, attempts, error: message });
    }
  }
  return processed;
}
