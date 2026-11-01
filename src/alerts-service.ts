import { Prisma, type PrismaClient } from "@prisma/client";
import { evaluateWatchRule } from "./alerts-matcher.js";
import { analyzeAlertMessage, searchParameters, type SemanticMatch, type SemanticRule } from "./alerts-ai.js";
import { planActive, monthKey } from "./quotas.js";
import type { Config } from "./config.js";
import { connectionTypeAllowed } from "./byon-shared.js";

export async function ingestWatchedMessage(prisma: PrismaClient, cfg: Config, details: {
  connectionId: string; groupId: string; messageId: string; text: string
}): Promise<boolean> {
  if (cfg.BYON_GATEWAY_ENABLED !== "true" || !details.text.trim() ||
      details.text.length > 1000) return false;
  // Independent allowlist. Translation's Group and Message tables are never touched.
  const group = await prisma.watchGroup.findFirst({
    where: {
      connectionId: details.connectionId, whatsappGroupId: details.groupId, enabled: true,
      connection: { active: true, status: "CONNECTED" }
    }, select: { id: true, tenantId: true, connection: { select: { kind: true } } }
  });
  if (!group) return false;
  const policy = await prisma.whatsAppConnectionPolicy.findUnique({ where: { id: "global" } });
  if (!policy || !connectionTypeAllowed(policy, group.connection.kind)) return false;
  const sub = await prisma.alertSubscription.findUnique({ where: { tenantId: group.tenantId } });
  if (!sub?.enabled || !planActive(sub)) return false;
  const result = await prisma.watchEvent.createMany({
    data: [{
      tenantId: group.tenantId, watchGroupId: group.id,
      externalMessageId: details.messageId, content: details.text
    }], skipDuplicates: true
  });
  return result.count === 1;
}

class AlertAllowanceReached extends Error {}

/** Separate polling loop and database queue: no translation provider or
 * group send endpoint is invoked by this worker. All notifications are private
 * inbox rows. Every accepted event clears raw text after processing.
 */
export async function processPendingAlerts(
  prisma: PrismaClient, cfg?: Config,
  analyze: typeof analyzeAlertMessage = analyzeAlertMessage
): Promise<number> {
  // Recover a worker crash after it claimed a job. A claimed job's lease
  // expires after five minutes. The unique (event,rule) key avoids repeats.
  const now = new Date();
  await prisma.watchEvent.updateMany({
    where: { status: "PROCESSING", attempts: { lt: 3 }, nextAttemptAt: { lt: now } },
    data: { status: "FAILED" }
  });
  await prisma.watchEvent.updateMany({
    where: { status: "PROCESSING", attempts: { gte: 3 }, nextAttemptAt: { lt: now } },
    data: { status: "FAILED", content: null }
  });
  const pending = await prisma.watchEvent.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      attempts: { lt: 3 }, nextAttemptAt: { lte: new Date() }
    }, take: 20, orderBy: { createdAt: "asc" },
    include: { group: { select: { enabled: true, tenantId: true } } }
  });
  let processed = 0;
  for (const event of pending) {
    const claim = await prisma.watchEvent.updateMany({
      where: { id: event.id, status: event.status, attempts: { lt: 3 } },
      data: { status: "PROCESSING", attempts: { increment: 1 },
        nextAttemptAt: new Date(Date.now() + 5 * 60_000) }
    });
    if (!claim.count) continue;
    try {
      const sub = await prisma.alertSubscription.findUnique({ where: { tenantId: event.tenantId } });
      if (event.content && event.group.enabled && event.group.tenantId === event.tenantId &&
          sub?.enabled && planActive(sub)) {
        const rules = await prisma.watchRule.findMany({
          where: { tenantId: event.tenantId, enabled: true }, take: 500
        });
        const matches = new Map<string, SemanticMatch>();
        const aiRules: SemanticRule[] = [];
        for (const rule of rules) {
          if (rule.parameters != null) {
            const parsed = searchParameters.safeParse(rule.parameters);
            if (parsed.success) aiRules.push({
              id: rule.id, name: rule.name, parameters: parsed.data
            });
          } else {
            // Existing customers' previously saved keyword rules still work.
            const match = evaluateWatchRule(event.content, rule);
            if (match) matches.set(rule.id, match);
          }
        }
        if (aiRules.length && cfg?.ALERTS_AI_ENABLED === "true") {
          // One independently metered AI request per batch of <=20 rules.
          // A quota exhaustion skips AI processing, never translation.
          for (let i = 0; i < aiRules.length; i += 20) {
            const batch = aiRules.slice(i, i + 20);
            const currentMonth = monthKey();
            const allowed = await prisma.$transaction(async tx => {
              const active = await tx.alertSubscription.findUnique({
                where: { tenantId: event.tenantId }
              });
              if (!active?.enabled || !planActive(active)) return false;
              await tx.$executeRaw`INSERT IGNORE INTO AlertUsage (tenantId, month, matches, analyses)
                VALUES (${event.tenantId}, ${currentMonth}, 0, 0)`;
              const reserved = await tx.alertUsage.updateMany({
                where: { tenantId: event.tenantId, month: currentMonth,
                  analyses: { lt: active.maxAnalysesPerMonth } },
                data: { analyses: { increment: 1 } }
              });
              return reserved.count === 1;
            }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
            if (!allowed) break;
            const found = await analyze(cfg, event.content, batch);
            for (const [id, match] of found) matches.set(id, match);
          }
        }
        for (const rule of rules) {
          const match = matches.get(rule.id);
          if (!match) continue;
          try {
            await prisma.$transaction(async tx => {
              const current = await tx.alertSubscription.findUnique({
                where: { tenantId: event.tenantId }
              });
              if (!current?.enabled || !planActive(current)) return;
              const created = await tx.alertMatch.create({
                data: { tenantId: event.tenantId, watchEventId: event.id,
                  watchRuleId: rule.id, ...match,
                  criteriaSnapshot: rule.parameters ?? {
                    legacyKeywords: rule.keywords,
                    ...(rule.origin ? { origin: rule.origin } : {}),
                    ...(rule.destination ? { destination: rule.destination } : {})
                  } }
              });
              // Queue only new matches with an explicitly opted-in notification channel.
              // This is independent of the translation group/reply pipeline.
              const destination = await tx.alertNotificationChannel.findUnique({
                where: { tenantId: event.tenantId }
              });
              if (destination?.enabled) {
                await tx.alertDelivery.create({
                  data: {
                    tenantId: event.tenantId, alertMatchId: created.id,
                    connectionId: destination.connectionId,
                    groupId: destination.groupId
                  }
                });
              }
              await tx.$executeRaw`INSERT IGNORE INTO AlertUsage (tenantId, month, matches, analyses)
                VALUES (${event.tenantId}, ${monthKey()}, 0, 0)`;
              const reserved = await tx.alertUsage.updateMany({
                where: { tenantId: event.tenantId, month: monthKey(),
                  matches: { lt: current.maxMatchesPerMonth } },
                data: { matches: { increment: 1 } }
              });
              if (!reserved.count) throw new AlertAllowanceReached();
            }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
          } catch (error) {
            if (error instanceof AlertAllowanceReached) break;
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
            throw error;
          }
        }
      }
      await prisma.watchEvent.update({
        where: { id: event.id },
        data: { status: "COMPLETED", content: null, processedAt: new Date() }
      });
      processed++;
    } catch {
      // Do not reveal private message text or phone numbers in logs or errors.
      const attempts = event.attempts + 1;
      await prisma.watchEvent.update({
        where: { id: event.id },
        data: {
          status: "FAILED",
          ...(attempts >= 3 ? { content: null } : {}),
          nextAttemptAt: new Date(Date.now() + attempts * 30000)
        }
      });
    }
  }
  return processed;
}
