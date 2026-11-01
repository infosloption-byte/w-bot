import type { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";
import { byonRequest, connectionTypeAllowed } from "./byon-shared.js";
import { planActive } from "./quotas.js";

export function formatAlertNotification(input: {
  ruleName: string; groupName: string; summary: string;
  contactNumber: string | null; senderPhone?: string | null; createdAt: Date
}): string {
  const clean = (value: string, max: number) => value
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g," ").trim().slice(0,max);
  const name = clean(input.ruleName, 90);
  const group = clean(input.groupName, 90);
  const text = clean(input.summary, 500);
  const contact = input.contactNumber && /^[+0-9 ()-]{7,32}$/.test(input.contactNumber)
    ? clean(input.contactNumber, 32) : null;
  const sender = input.senderPhone && /^\+[1-9][0-9]{7,14}$/.test(input.senderPhone)
    ? input.senderPhone : null;
  return [
    "🔔 W-Bot Smart Alert",
    "Search: " + name,
    "From: " + group,
    "Matched: " + input.createdAt.toISOString(),
    "Message sender (WhatsApp): " + (sender ?? "Number unavailable"),
    "",
    text,
    ...(contact ? ["", "Contact shared in the source: " + contact] : []),
    "",
    "Check W-Bot → Smart Alerts → Inbox for details."
  ].join("\n").slice(0,1500);
}

type SendResult = "SENT" | "UNCERTAIN" | "CANCELED";

/** Best-effort delivery in a separate queue.
 * If a request might have reached WhatsApp, NEVER resend automatically.
 * This deliberately favors no duplicates over guaranteed at-least-once delivery.
 */
export async function processAlertDeliveries(
  prisma: PrismaClient, cfg: Config,
  send: typeof byonRequest = byonRequest
): Promise<number> {
  if (cfg.BYON_GATEWAY_ENABLED !== "true" || cfg.dryRun) return 0;
  const now = new Date();
  // A crash between sending and DB acknowledgement has an unknown outcome.
  await prisma.alertDelivery.updateMany({
    where: { status: "PROCESSING", nextAttemptAt: { lt: now } },
    data: { status: "UNCERTAIN" }
  });
  const pending = await prisma.alertDelivery.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: now } },
    orderBy: { createdAt: "asc" }, take: 2,
    include: {
      match: { select: {
        summary: true, contactNumber: true, createdAt: true,
        rule: { select: { name: true } },
        event: { select: { senderPhone: true, group: { select: { name: true } } } }
      }}
    }
  });
  let finished = 0;
  for (const delivery of pending) {
    const claimed = await prisma.alertDelivery.updateMany({
      where: { id: delivery.id, status: "PENDING" },
      data: { status: "PROCESSING", attempts: { increment: 1 },
        startedAt: new Date(), nextAttemptAt: new Date(Date.now()+90_000) }
    });
    if (!claimed.count) continue;
    let result: SendResult = "CANCELED";
    let outboundId: string | undefined;
    try {
      const [sub, channel, connection, policy, source, translatedGroup] = await Promise.all([
        prisma.alertSubscription.findUnique({ where: { tenantId: delivery.tenantId } }),
        prisma.alertNotificationChannel.findUnique({ where: { tenantId: delivery.tenantId } }),
        prisma.customerWhatsAppConnection.findFirst({
          where: { id: delivery.connectionId, tenantId: delivery.tenantId,
            active: true, status: "CONNECTED" }
        }),
        prisma.whatsAppConnectionPolicy.findUnique({ where: { id: "global" } }),
        prisma.watchGroup.findFirst({ where: {
          tenantId: delivery.tenantId,
          whatsappGroupId: delivery.groupId
        } }),
        prisma.group.findFirst({ where: {
          tenantId: delivery.tenantId,
          whatsappGroupId: delivery.groupId, enabled: true
        } })
      ]);
      if (sub?.enabled && planActive(sub) && channel?.enabled &&
          channel.connectionId === delivery.connectionId &&
          channel.groupId === delivery.groupId &&
          connection && policy && connectionTypeAllowed(policy, connection.kind) &&
          !source && !translatedGroup) {
        const body = formatAlertNotification({
          ruleName: delivery.match.rule.name,
          groupName: delivery.match.event.group.name,
          summary: delivery.match.summary,
          contactNumber: delivery.match.contactNumber,
          senderPhone: delivery.match.event.senderPhone,
          createdAt: delivery.match.createdAt
        });
        // An HTTP/network timeout is ambiguous; never auto-retry this send.
        result = "UNCERTAIN";
        const response = await send(cfg,
          "/connections/" + delivery.connectionId + "/notify", "POST",
          { groupId: delivery.groupId, text: body });
        if (response.ok) {
          const data = await response.json() as { messageId?: string };
          if (data.messageId) { result = "SENT"; outboundId = data.messageId.slice(0,191); }
        }
      }
    } catch {
      // No sensitive contact, message or group details in logs.
      if (result !== "UNCERTAIN") result = "CANCELED";
    }
    await prisma.alertDelivery.update({
      where: { id: delivery.id },
      data: {
        status: result, sentAt: result === "SENT" ? new Date() : null,
        outboundId: outboundId ?? null
      }
    });
    finished++;
  }
  return finished;
}
