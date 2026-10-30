import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";
import {
  allowAttempt, digest, hashPassword, verifyPassword, requireMutationHeader
} from "./portal-auth.js";

const COOKIE = "wbot_platform_session";
const SESSION_SECONDS = 8 * 60 * 60;
const loginSchema = z.object({
  email: z.string().trim().email().max(191).transform(x => x.toLowerCase()),
  password: z.string().min(1).max(128)
}).strict();
const changePassword = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(16).max(128)
}).strict();
const changePlan = z.object({
  planCode: z.string().regex(/^[A-Z0-9_-]{2,30}$/),
  status: z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED"]),
  groupLimit: z.number().int().min(0).max(1000),
  monthlyMessages: z.number().int().min(0).max(1_000_000),
  periodEnd: z.string().datetime().nullable().optional()
}).strict();
const changeGroup = z.object({ enabled: z.boolean() }).strict();

function cookie(value: string, secure: boolean, maxAge = SESSION_SECONDS): string {
  return COOKIE + "=" + value + "; Path=/portal; HttpOnly; SameSite=Strict" +
    "; Max-Age=" + maxAge + (secure ? "; Secure" : "");
}
function fromCookies(req: FastifyRequest): string | null {
  const val = req.headers.cookie?.split(";").map(x => x.trim())
    .find(x => x.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  return val && /^[a-zA-Z0-9_-]{40,100}$/.test(val) ? val : null;
}
async function adminIdentity(
  prisma: PrismaClient, req: FastifyRequest, reply: FastifyReply
) {
  const session = fromCookies(req);
  if (!session) { reply.code(401).send({ error: "Platform sign-in required" }); return null; }
  const record = await prisma.platformSession.findUnique({
    where: { tokenHash: digest(session) }, include: { admin: true }
  });
  if (!record || record.expiresAt <= new Date() || !record.admin.active) {
    reply.code(401).send({ error: "Platform session expired or disabled" });
    return null;
  }
  return record.admin;
}
function requiredSuperAdmin(
  admin: { role: string }, reply: FastifyReply
): boolean {
  if (admin.role === "SUPER_ADMIN") return true;
  reply.code(403).send({ error: "Super administrator access required" });
  return false;
}
async function createPlatformSession(prisma: PrismaClient, adminId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.platformSession.create({
    data: {
      adminId, tokenHash: digest(token),
      expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000)
    }
  });
  return token;
}

export function registerPlatformRoutes(app: FastifyInstance, prisma: PrismaClient, cfg: Config) {
  if (!cfg.saasEnabled) return;

  app.post("/portal/api/platform/auth/login", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const input = loginSchema.parse(req.body);
    if (!allowAttempt("platform-login:" + digest(input.email), 6, 15 * 60_000))
      return reply.code(429).send({ error: "Too many sign-in attempts" });
    const admin = await prisma.platformAdmin.findUnique({ where: { email: input.email } });
    const valid = admin
      ? await verifyPassword(input.password, admin.passwordHash)
      : await (async () => { await hashPassword(input.password); return false; })();
    if (!admin || !admin.active || !valid)
      return reply.code(401).send({ error: "Invalid platform credentials" });
    const token = await createPlatformSession(prisma, admin.id);
    await prisma.$transaction(async tx => {
      await tx.platformAdmin.update({
        where: { id: admin.id }, data: { lastLoginAt: new Date() }
      });
      await tx.platformAudit.create({
        data: { adminId: admin.id, action: "PLATFORM_SIGNED_IN" }
      });
    });
    reply.header("set-cookie", cookie(token, cfg.SAAS_COOKIE_SECURE === "true"));
    return { authenticated: true };
  });

  app.post("/portal/api/platform/auth/logout", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const token = fromCookies(req);
    if (token) await prisma.platformSession.deleteMany({
      where: { tokenHash: digest(token) }
    });
    reply.header("set-cookie", cookie("", cfg.SAAS_COOKIE_SECURE === "true", 0));
    return { authenticated: false };
  });

  app.get("/portal/api/platform/me", async (req, reply) => {
    const admin = await adminIdentity(prisma, req, reply);
    if (!admin) return;
    return {
      id: admin.id, name: admin.displayName,
      email: admin.email, role: admin.role, lastLoginAt: admin.lastLoginAt
    };
  });

  app.post("/portal/api/platform/auth/change-password", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const admin = await adminIdentity(prisma, req, reply);
    if (!admin) return;
    const input = changePassword.parse(req.body);
    if (!await verifyPassword(input.currentPassword, admin.passwordHash))
      return reply.code(403).send({ error: "Current password is incorrect" });
    const passwordHash = await hashPassword(input.newPassword);
    await prisma.$transaction(async tx => {
      await tx.platformAdmin.update({ where: { id: admin.id }, data: { passwordHash } });
      await tx.platformSession.deleteMany({ where: { adminId: admin.id } });
      await tx.platformAudit.create({ data: { adminId: admin.id, action: "PASSWORD_CHANGED" } });
    });
    reply.header("set-cookie", cookie("", cfg.SAAS_COOKIE_SECURE === "true", 0));
    return { changed: true, signInRequired: true };
  });

  app.get("/portal/api/platform/overview", async (req, reply) => {
    const admin = await adminIdentity(prisma, req, reply);
    if (!admin) return;
    const month = new Date().toISOString().slice(0, 7);
    const [
      tenants, users, groups, enabledGroups, used, queued, failures, uncertain, gateway
    ] = await Promise.all([
      prisma.tenant.count(),
      prisma.portalUser.count(),
      prisma.group.count(),
      prisma.group.count({ where: { enabled: true } }),
      prisma.tenantUsage.aggregate({ where: { month }, _sum: { messages: true } }),
      prisma.message.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
      prisma.message.count({ where: { status: "FAILED" } }),
      prisma.message.count({ where: { status: "DELIVERY_UNCERTAIN" } }),
      prisma.gatewayHealth.findUnique({ where: { name: "web" } })
    ]);
    return {
      tenants, users, groups, enabledGroups,
      messagesThisMonth: used._sum.messages ?? 0, queued, failures, uncertain,
      gateway: gateway ? {
        status: gateway.state, checkedAt: gateway.checkedAt,
        changedAt: gateway.changedAt
      } : { status: "CHECKING", checkedAt: null, changedAt: null }
    };
  });

  app.get("/portal/api/platform/tenants", async (req, reply) => {
    const admin = await adminIdentity(prisma, req, reply);
    if (!admin) return;
    const items = await prisma.tenant.findMany({
      orderBy: { createdAt: "desc" }, take: 100,
      select: {
        id: true, name: true, createdAt: true,
        usageBuckets: {
          where: { month: new Date().toISOString().slice(0, 7) },
          take: 1, select: { messages: true }
        },
        _count: { select: { groups: true, members: true } },
        subscription: {
          select: {
            planCode: true, status: true, groupLimit: true,
            monthlyMessages: true, periodEnd: true
          }
        },
        members: {
          where: { role: "OWNER" }, take: 1,
          select: { user: { select: { email: true, displayName: true } } }
        }
      }
    });
    return { tenants: items.map(tenant => ({
      id: tenant.id, name: tenant.name, createdAt: tenant.createdAt,
      groupCount: tenant._count.groups, memberCount: tenant._count.members,
      monthUsage: tenant.usageBuckets[0]?.messages ?? 0,
      owner: tenant.members[0]?.user ?? null, subscription: tenant.subscription
    })) };
  });

  app.get("/portal/api/platform/users", async (req, reply) => {
    const admin = await adminIdentity(prisma, req, reply);
    if (!admin) return;
    const users = await prisma.portalUser.findMany({
      orderBy: { createdAt: "desc" }, take: 100,
      select: {
        id: true, displayName: true, email: true,
        emailVerifiedAt: true, createdAt: true,
        memberships: {
          select: { role: true, tenant: { select: { id: true, name: true } } }
        }
      }
    });
    return { users };
  });

  app.get("/portal/api/platform/groups", async (req, reply) => {
    const admin = await adminIdentity(prisma, req, reply);
    if (!admin) return;
    const groups = await prisma.group.findMany({
      orderBy: { updatedAt: "desc" }, take: 100,
      select: {
        id: true, name: true, enabled: true, gateway: true,
        claimedAt: true, updatedAt: true, targetLanguages: true,
        tenant: { select: { id: true, name: true } },
        _count: { select: { messages: true } }
      }
    });
    // Deliberately omit WhatsApp group JIDs and member identities.
    return { groups };
  });

  app.get("/portal/api/platform/deliveries", async (req, reply) => {
    const admin = await adminIdentity(prisma, req, reply);
    if (!admin) return;
    const messages = await prisma.message.findMany({
      where: { status: { in: ["FAILED", "DELIVERY_UNCERTAIN"] } },
      orderBy: { createdAt: "desc" }, take: 100,
      select: {
        id: true, status: true, attempts: true, createdAt: true,
        // Never return message text, senders, or private WhatsApp identifiers.
        group: { select: {
          name: true, tenant: { select: { name: true } }
        } }
      }
    });
    return { messages };
  });

  app.get("/portal/api/platform/activity", async (req, reply) => {
    const admin = await adminIdentity(prisma, req, reply);
    if (!admin) return;
    const [events, platformEvents] = await Promise.all([
      prisma.tenantAudit.findMany({
        orderBy: { createdAt: "desc" }, take: 80,
        select: {
          id: true, action: true, createdAt: true,
          tenant: { select: { name: true } }
        }
      }),
      prisma.platformAudit.findMany({
        orderBy: { createdAt: "desc" }, take: 40,
        select: { id: true, action: true, createdAt: true }
      })
    ]);
    return { events, platformEvents };
  });

  app.patch<{ Params: { id: string } }>("/portal/api/platform/tenants/:id/subscription", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const admin = await adminIdentity(prisma, req, reply);
    if (!admin || !requiredSuperAdmin(admin, reply)) return;
    const body = changePlan.parse(req.body);
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.params.id }, select: { id: true }
    });
    if (!tenant) return reply.code(404).send({ error: "Workspace not found" });
    const plan = await prisma.$transaction(async tx => {
      const update = await tx.tenantSubscription.upsert({
        where: { tenantId: tenant.id },
        create: {
          tenantId: tenant.id, planCode: body.planCode, status: body.status,
          groupLimit: body.groupLimit, monthlyMessages: body.monthlyMessages,
          periodEnd: body.periodEnd ? new Date(body.periodEnd) : null
        },
        update: {
          planCode: body.planCode, status: body.status,
          groupLimit: body.groupLimit, monthlyMessages: body.monthlyMessages,
          periodEnd: body.periodEnd ? new Date(body.periodEnd) : null
        }
      });
      await tx.platformAudit.create({
        data: { adminId: admin.id, action: "TENANT_PLAN_UPDATED", targetId: tenant.id }
      });
      return update;
    });
    return {
      saved: true, plan: {
        code: plan.planCode, status: plan.status,
        groupLimit: plan.groupLimit, monthlyMessages: plan.monthlyMessages
      }
    };
  });

  app.patch<{ Params: { id: string } }>("/portal/api/platform/groups/:id", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const admin = await adminIdentity(prisma, req, reply);
    if (!admin || !requiredSuperAdmin(admin, reply)) return;
    const input = changeGroup.parse(req.body);
    const updated = await prisma.$transaction(async tx => {
      const saved = await tx.group.updateMany({
        where: {
          id: req.params.id,
          // A platform operator must not activate an unclaimed group without
          // the group-admin consent and code verification workflow.
          ...(input.enabled ? { tenantId: { not: null }, consentAt: { not: null } } : {})
        }, data: { enabled: input.enabled }
      });
      if (saved.count) await tx.platformAudit.create({
        data: { adminId: admin.id, action: input.enabled ? "GROUP_ENABLED" : "GROUP_PAUSED", targetId: req.params.id }
      });
      return saved;
    });
    if (!updated.count) return reply.code(404).send({ error: "Group not found" });
    return { saved: true };
  });
}
