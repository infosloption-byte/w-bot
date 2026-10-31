import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";
import { adminIdentity, requiredSuperAdmin } from "./platform.js";
import { requireMutationHeader } from "./portal-auth.js";

const policyInput = z.object({
  customerNumbersEnabled: z.boolean(),
  personalEnabled: z.boolean(),
  businessEnabled: z.boolean(),
  maxConnectionsPerTenant: z.number().int().min(0).max(1000)
}).strict();

export function registerByonPlatformRoutes(app: FastifyInstance, prisma: PrismaClient, cfg: Config) {
  if (!cfg.saasEnabled) return;
  app.get("/portal/api/platform/whatsapp-policy", async (req, reply) => {
    const admin = await adminIdentity(prisma, req, reply);
    if (!admin) return;
    const rule = await prisma.whatsAppConnectionPolicy.findUnique({ where: { id: "global" } });
    return {
      gatewayConfigured: cfg.BYON_GATEWAY_ENABLED === "true",
      policy: rule ?? {
        customerNumbersEnabled: false, personalEnabled: true,
        businessEnabled: true, maxConnectionsPerTenant: 0
      }
    };
  });
  app.patch("/portal/api/platform/whatsapp-policy", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const admin = await adminIdentity(prisma, req, reply);
    if (!admin || !requiredSuperAdmin(admin, reply)) return;
    const input = policyInput.parse(req.body);
    if (input.customerNumbersEnabled && cfg.BYON_GATEWAY_ENABLED !== "true")
      return reply.code(409).send({ error: "Install and configure isolated gateway before enabling customer numbers" });
    const settings = await prisma.$transaction(async tx => {
      const policy = await tx.whatsAppConnectionPolicy.upsert({
        where: { id: "global" },
        create: { id: "global", ...input }, update: input
      });
      await tx.platformAudit.create({
        data: { adminId: admin.id, action: "WHATSAPP_CONNECTION_POLICY_UPDATED" }
      });
      return policy;
    });
    return { policy: settings };
  });
  app.get("/portal/api/platform/whatsapp-connections", async (req, reply) => {
    const admin = await adminIdentity(prisma, req, reply);
    if (!admin) return;
    const items = await prisma.customerWhatsAppConnection.findMany({
      orderBy: { createdAt: "desc" }, take: 100,
      select: {
        id: true, label: true, kind: true, status: true, active: true,
        phoneLast4: true, createdAt: true, lastSeenAt: true,
        tenant: { select: { name: true } }, _count: { select: { groups: true } }
      }
    });
    return { connections: items };
  });
}
