import { Prisma, type PrismaClient } from "@prisma/client";
import { commercialLimits, getCommercialPlan } from "./plans.js";
import type { Config } from "./config.js";

export class InactivePlanError extends Error {
  constructor() { super("Tenant subscription is inactive"); }
}
export function monthKey(at = new Date()): string {
  return at.toISOString().slice(0, 7);
}
export async function getTenantLimits(prisma: PrismaClient, cfg: Config, tenantId: string) {
  const subscription = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
  const limits = commercialLimits(subscription?.planCode ?? "PILOT", {
    groupLimit: subscription?.groupLimit ?? cfg.SAAS_MAX_GROUPS,
    whatsappConnectionLimit: subscription?.whatsappConnectionLimit ?? 0
  });
  return {
    plan: subscription?.planCode ?? "PILOT",
    billingInterval: subscription?.billingInterval ?? "MONTHLY",
    commercialPriceCents: (() => { const p = getCommercialPlan(subscription?.planCode ?? "");
      return p ? (subscription?.billingInterval === "YEARLY" ? p.yearlyCents : p.monthlyCents) : null;
    })(),
    unlimitedTextTranslations: true,
    status: subscription?.status ?? "TRIAL",
    groups: limits.groups,
    whatsappConnections: limits.whatsappConnections,
    periodEnd: subscription?.periodEnd ?? null
  };
}
export function planActive(plan: { status: string; periodEnd: Date | null }, now = new Date()): boolean {
  return (plan.status === "ACTIVE" || plan.status === "TRIAL") &&
    (!plan.periodEnd || plan.periodEnd > now);
}

/** A single transaction ingests each unique authorized message and meters usage.
 * Duplicate protection remains; no monthly text translation quota applies.
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
      // Track monthly usage for reporting and abuse alerts, without a
      // subscription message-count ceiling.
      await tx.tenantUsage.update({
        where: { tenantId_month: { tenantId: details.tenantId, month } },
        data: { messages: { increment: 1 } }
      });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error) {
    if (error instanceof InactivePlanError) return false;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}
