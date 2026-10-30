import type { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";

/** Delete old content and expired security tokens. This is a bounded batch
 * to reduce long locks while running alongside the live translation worker.
 */
export async function runRetention(prisma: PrismaClient, cfg: Config) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - cfg.MESSAGE_RETENTION_DAYS * 86_400_000);
  const old = await prisma.message.findMany({
    where: { createdAt: { lt: cutoff }, status: { in: ["COMPLETED","FAILED","DELIVERY_UNCERTAIN"] } },
    select: { id: true }, take: 250
  });
  if (old.length) await prisma.message.deleteMany({ where: { id: { in: old.map(x => x.id) } } });
  await prisma.accountToken.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.portalSession.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.groupActivation.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } }
  });
  await prisma.tenantAudit.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - 90 * 86_400_000) } }
  });
  return old.length;
}
