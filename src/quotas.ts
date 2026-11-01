import { Prisma, type PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";

export class QuotaExceededError extends Error {
  constructor() { super("Monthly message allowance reached"); }
}
export class InactivePlanError extends Error {
  constructor() { super("Tenant subscription is inactive"); }
}
export function monthKey(at = new Date()): string {
  return at.toISOString().slice(0, 7);
}
export async function getTenantLimits(prisma: PrismaClient, cfg: Config, tenantId: string) {
  const subscription = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
  return {
    plan: subscription?.planCode ?? "PILOT",
    status: subscription?.status ?? "TRIAL",
    groups: subscription?.groupLimit ?? cfg.SAAS_MAX_GROUPS,
    whatsappConnections: subscription?.whatsappConnectionLimit ?? 0,
    messagesPerMonth: subscription?.monthlyMessages ?? cfg.SAAS_MONTHLY_MESSAGES,
    periodEnd: subscription?.periodEnd ?? null
  };
}
export function planActive(plan: { status: string; periodEnd: Date | null }, now = new Date()): boolean {
  return (plan.status === "ACTIVE" || plan.status === "TRIAL") &&
    (!plan.periodEnd || plan.periodEnd > now);
}

/** A single MySQL transaction reserves capacity and inserts the incoming
 * message. Unique message IDs and atomic conditional increments make repeated
 * webhook deliveries free and prevent concurrency overspend. If a quota
 * reservation fails the transaction rolls back the message insertion too.
 */
export async function ingestTenantMessage(
  prisma: PrismaClient, cfg: Config, details: {
    tenantId: string; groupId: string; messageId: string; senderId: string; text: string
  }
): Promise<boolean> {
  const now = new Date();
  const month = monthKey(now);
  try {
    return await prisma.$transaction(async tx => {
      const plan = await tx.tenantSubscription.findUnique({
        where: { tenantId: details.tenantId }
      });
      if (plan && !planActive(plan, now)) throw new InactivePlanError();
      const limit = plan?.monthlyMessages ?? cfg.SAAS_MONTHLY_MESSAGES;
      const group = await tx.group.findFirst({
        where: {
          id: details.groupId, tenantId: details.tenantId,
          gateway: "WEB", enabled: true
        }, select: { id: true }
      });
      if (!group) return false;
      // Create BEFORE reserving so duplicate WhatsApp events never consume usage.
      await tx.message.create({
        data: {
          groupId: details.groupId, externalMessageId: details.messageId,
          senderId: details.senderId, originalText: details.text
        }
      });
      // MySQL INSERT IGNORE is atomic under a concurrent first request of a
      // new month; an empty Prisma upsert update could race.
      await tx.$executeRaw`INSERT IGNORE INTO TenantUsage (tenantId, month, messages)
        VALUES (${details.tenantId}, ${month}, 0)`;
      // 0 is the explicit unlimited-text allowance for paid tiers. Keep
      // counting accepted messages for monitoring, abuse controls and invoicing.
      const used = await tx.tenantUsage.updateMany({
        where: {
          tenantId: details.tenantId, month,
          ...(limit === 0 ? {} : { messages: { lt: limit } })
        },
        data: { messages: { increment: 1 } }
      });
      if (!used.count) throw new QuotaExceededError();
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error) {
    if (error instanceof QuotaExceededError || error instanceof InactivePlanError) return false;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}
