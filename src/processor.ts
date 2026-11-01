import { MessageStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";
import { configuredLanguages, LANGUAGE_NAMES, normalizeLanguageCode, translationTargets } from "./languages.js";
import { GoogleTranslationError, type TranslationProvider } from "./translation.js";
import { GeminiApiError } from "./gemini.js";
import { sendGatewayText, GatewayUnavailableError } from "./gateways.js";

const MAX_ATTEMPTS = 3;

export async function processPending(prisma: PrismaClient, provider: TranslationProvider, cfg: Config): Promise<number> {
  const now = new Date();
  // Recover jobs from a crashed process. Outbound delivery is at-least-once.
  await prisma.message.updateMany({
    where: { status: MessageStatus.PROCESSING, nextAttemptAt: { lte: now } },
    data: { status: MessageStatus.PENDING }
  });
  const pending = await prisma.message.findMany({
    where: { status: MessageStatus.PENDING, nextAttemptAt: { lte: now } },
    orderBy: { createdAt: "asc" }, take: 10, include: { group: true }
  });
  let processed = 0;
  for (const msg of pending) {
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
      const langs = configuredLanguages(msg.group.targetLanguages);
      if (!langs.length) throw new Error("Group has no valid target languages");
      let source = msg.sourceLanguage ? normalizeLanguageCode(msg.sourceLanguage) : "";
      let output = msg.outputText;

      if (output === null) {
        const translationStarted = Date.now();
        const results: Record<string, string> = {};
        if (provider.translateBatch) {
          // Gemini does language detection and all translations in ONE request.
          const batch = await provider.translateBatch(msg.originalText, langs);
          source = normalizeLanguageCode(batch.sourceLanguage);
          Object.assign(results, batch.translations);
        } else {
          source = source || normalizeLanguageCode(await provider.detect(msg.originalText));
          for (const target of translationTargets(langs, source)) {
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
          parts.push("🌐 " + LANGUAGE_NAMES[target] + "\n" + translated);
        }
        output = parts.join("\n\n");
        if (output.length > 3900) throw new Error("Translation exceeds WhatsApp text limit");
        translationMs = Date.now() - translationStarted;
        await prisma.message.update({
          where: { id: msg.id }, data: { sourceLanguage: source, outputText: output }
        });
      }
      const sendStarted = Date.now();
      const sentId = output ? await sendGatewayText(
        cfg,
        msg.group.gateway,
        msg.group.whatsappGroupId,
        output,
        { messageId: msg.externalMessageId, senderId: msg.senderId, text: msg.originalText }
      ) : null;
      sendMs = Date.now() - sendStarted;
      await prisma.message.update({
        where: { id: msg.id },
        data: {
          status: MessageStatus.COMPLETED, outboundMessageId: sentId,
          processedAt: new Date(), lastError: null
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
      await prisma.message.update({
        where: { id: msg.id },
        data: {
          status: permanentlyInvalid || (attempts >= MAX_ATTEMPTS && !(error instanceof GatewayUnavailableError)) ? MessageStatus.FAILED : MessageStatus.PENDING,
          lastError: message.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + (error instanceof GatewayUnavailableError ? 60_000 : Math.min(60_000, 5_000 * 2 ** attempts)))
        }
      });
      console.error("Message processing failed", { id: msg.id, attempts, error: message });
    }
  }
  return processed;
}
