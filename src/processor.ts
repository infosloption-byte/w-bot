import { MessageStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";
import { configuredLanguages, LANGUAGE_NAMES, normalizeLanguageCode, translationTargets } from "./languages.js";
import { GoogleTranslationError, type TranslationProvider } from "./translation.js";
import { sendGroupText } from "./whatsapp.js";

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
    try {
      if (!msg.group.enabled) {
        await prisma.message.update({ where: { id: msg.id },
          data: { status: MessageStatus.COMPLETED, processedAt: new Date() } });
        processed++;
        continue;
      }
      const langs = configuredLanguages(msg.group.targetLanguages);
      const source = normalizeLanguageCode(msg.sourceLanguage || await provider.detect(msg.originalText));
      if (!langs.length) throw new Error("Group has no valid target languages");
      const targets = translationTargets(langs, source);
      let output = msg.outputText;
      if (!output) {
        const parts: string[] = [];
        for (const target of targets) {
          const translated = await provider.translate(msg.originalText, source, target);
          parts.push("🌐 " + LANGUAGE_NAMES[target] + "\n" + translated);
        }
        output = parts.length ? parts.join("\n\n") : "";
        if (output.length > 3900) throw new Error("Translation exceeds WhatsApp text limit");
        await prisma.message.update({
          where: { id: msg.id }, data: { sourceLanguage: source, outputText: output }
        });
      }
      const sentId = output ? await sendGroupText(cfg, msg.group.whatsappGroupId, output) : null;
      await prisma.message.update({
        where: { id: msg.id },
        data: {
          status: MessageStatus.COMPLETED, outboundMessageId: sentId,
          processedAt: new Date(), lastError: null
        }
      });
      processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown processing error";
      const attempts = msg.attempts + 1;
      const permanentlyInvalid = error instanceof GoogleTranslationError
        && error.isPermanentConfigurationError;
      await prisma.message.update({
        where: { id: msg.id },
        data: {
          status: permanentlyInvalid || attempts >= MAX_ATTEMPTS ? MessageStatus.FAILED : MessageStatus.PENDING,
          lastError: message.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + Math.min(60_000, 5_000 * 2 ** attempts))
        }
      });
      console.error("Message processing failed", { id: msg.id, attempts, error: message });
    }
  }
  return processed;
}
