import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";
import { DEFAULT_TARGET_LANGUAGES, isLanguage, normalizeLanguageCode } from "./languages.js";
import {
  allowAttempt, createSession, digest, hashPassword, verifyPassword,
  requirePortalAuth, requireMutationHeader, sessionCookie,
  SESSION_COOKIE
} from "./portal-auth.js";
import { isWebGroupId } from "./gateways.js";
import { registerAccountRoutes } from "./portal-accounts.js";
import { issueAccountToken, mailConfigured, sendAccountEmail } from "./mailer.js";
import { getTenantLimits, planActive, monthKey } from "./quotas.js";

const registration = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(191).transform(x => x.toLowerCase()),
  password: z.string().min(12).max(128),
  workspace: z.string().trim().min(2).max(191),
  inviteCode: z.string().min(24).max(200)
}).strict();
const login = z.object({
  email: z.string().trim().email().transform(x => x.toLowerCase()),
  password: z.string().min(1).max(128)
}).strict();
const groupEdit = z.object({
  enabled: z.boolean().optional(),
  targetLanguages: z.array(
    z.string().transform(normalizeLanguageCode).refine(isLanguage)
  ).min(1).max(5).refine(arr => new Set(arr).size === arr.length).optional()
}).strict().refine(x => Object.keys(x).length > 0);
const activationInput = z.object({
  groupId: z.string().refine(isWebGroupId),
  groupName: z.string().trim().min(1).max(191),
  messageId: z.string().min(1).max(191),
  senderId: z.string().min(1).max(191),
  code: z.string().regex(/^[A-Fa-f0-9]{16}$/),
  adminVerified: z.literal(true)
}).strict();

function safeCompare(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function rejected(reply: { code: (n: number) => { send: (body: object) => unknown } }, status = 403) {
  return reply.code(status).send({ error: "Group activation could not be completed" });
}

export function registerPortalRoutes(app: FastifyInstance, prisma: PrismaClient, cfg: Config): void {
  if (!cfg.saasEnabled) return;
  registerAccountRoutes(app, prisma, cfg);

  app.post("/portal/api/auth/register", async (request, reply) => {
    if (!requireMutationHeader(request, reply)) return;
    const data = registration.parse(request.body);
    if (!allowAttempt("register:" + digest(data.email), 4, 3600_000)) {
      return reply.code(429).send({ error: "Too many signup attempts" });
    }
    if (!safeCompare(data.inviteCode, cfg.SAAS_SIGNUP_CODE!)) {
      return reply.code(403).send({ error: "Invalid pilot invitation" });
    }
    if (cfg.SAAS_REQUIRE_EMAIL_VERIFICATION === "true" && !mailConfigured(cfg)) {
      return reply.code(503).send({ error: "Email verification is not available yet" });
    }
    const passwordHash = await hashPassword(data.password);
    let user: { id: string };
    try {
      user = await prisma.$transaction(async tx => {
        const created = await tx.portalUser.create({
          data: { email: data.email, displayName: data.name, passwordHash }
        });
        const tenant = await tx.tenant.create({
          data: { name: data.workspace }
        });
        await tx.tenantMember.create({
          data: { userId: created.id, tenantId: tenant.id, role: "OWNER" }
        });
        await tx.tenantSubscription.create({
          data: {
            tenantId: tenant.id, planCode: "PILOT", status: "TRIAL",
            groupLimit: cfg.SAAS_MAX_GROUPS,
            monthlyMessages: cfg.SAAS_MONTHLY_MESSAGES
          }
        });
        await tx.tenantAudit.create({
          data: { tenantId: tenant.id, actorId: created.id, action: "WORKSPACE_CREATED" }
        });
        return created;
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        return reply.code(409).send({ error: "Email is already registered" });
      }
      throw error;
    }
    if (mailConfigured(cfg)) {
      const emailToken = await issueAccountToken(prisma, user.id, "VERIFY_EMAIL");
      try {
        await sendAccountEmail(cfg, data.email, "verify", emailToken);
      } catch {
        app.log.error("Customer registration email delivery failed");
      }
    }
    const token = await createSession(prisma, user.id);
    reply.header("set-cookie", sessionCookie(token, cfg.SAAS_COOKIE_SECURE === "true"));
    return reply.code(201).send({
      registered: true, verificationRequired: cfg.SAAS_REQUIRE_EMAIL_VERIFICATION === "true"
    });
  });

  app.post("/portal/api/auth/login", async (request, reply) => {
    if (!requireMutationHeader(request, reply)) return;
    const data = login.parse(request.body);
    if (!allowAttempt("login:" + request.ip + ":" + digest(data.email).slice(0, 16), 8, 15 * 60_000)) {
      return reply.code(429).send({ error: "Too many sign-in attempts" });
    }
    const user = await prisma.portalUser.findUnique({ where: { email: data.email } });
    // Match the password hashing cost even when no user exists.
    const passwordOk = user
      ? await verifyPassword(data.password, user.passwordHash)
      : await (async () => {
          await hashPassword(data.password);
          return false;
        })();
    if (!user || !passwordOk) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }
    const token = await createSession(prisma, user.id);
    reply.header("set-cookie", sessionCookie(token, cfg.SAAS_COOKIE_SECURE === "true"));
    return { authenticated: true };
  });

  app.post("/portal/api/auth/logout", async (request, reply) => {
    if (!requireMutationHeader(request, reply)) return;
    const raw = request.headers.cookie?.split(";").map(x => x.trim())
      .find(x => x.startsWith(SESSION_COOKIE + "="))?.split("=")[1];
    if (raw && /^[A-Za-z0-9_-]{40,100}$/.test(raw)) {
      await prisma.portalSession.deleteMany({ where: { tokenHash: digest(raw) } });
    }
    reply.header("set-cookie", sessionCookie("", cfg.SAAS_COOKIE_SECURE === "true", 0));
    return { authenticated: false };
  });

  app.get("/portal/api/me", async (request, reply) => {
    const user = await requirePortalAuth(prisma, request, reply);
    if (!user) return;
    const [limits, account] = await Promise.all([
      getTenantLimits(prisma, cfg, user.tenantId),
      prisma.portalUser.findUnique({
        where: { id: user.userId }, select: { emailVerifiedAt: true }
      })
    ]);
    return {
      user: {
        name: user.displayName, email: user.email,
        emailVerified: Boolean(account?.emailVerifiedAt)
      },
      workspace: { id: user.tenantId, name: user.tenantName, role: user.role },
      limits: { groups: limits.groups, messagesPerMonth: limits.messagesPerMonth },
      subscription: { plan: limits.plan, status: limits.status },
      botPhoneNumber: cfg.SAAS_BOT_NUMBER ?? null,
      note: "Invite-only technical pilot; a linked WhatsApp bot is unofficial."
    };
  });

  app.get("/portal/api/groups", async (request, reply) => {
    const user = await requirePortalAuth(prisma, request, reply);
    if (!user) return;
    const groups = await prisma.group.findMany({
      where: { tenantId: user.tenantId },
      select: {
        id: true, name: true, whatsappGroupId: true, enabled: true,
        gateway: true, targetLanguages: true, claimedAt: true, createdAt: true
      },
      orderBy: { createdAt: "desc" }
    });
    return { groups };
  });

  app.patch<{ Params: { id: string } }>("/portal/api/groups/:id", async (request, reply) => {
    if (!requireMutationHeader(request, reply)) return;
    const user = await requirePortalAuth(prisma, request, reply);
    if (!user) return;
    if (user.role === "VIEWER") return reply.code(403).send({ error: "Read-only membership" });
    const changes = groupEdit.parse(request.body);
    const result = await prisma.group.updateMany({
      where: { id: request.params.id, tenantId: user.tenantId, gateway: "WEB" },
      data: changes
    });
    if (!result.count) return reply.code(404).send({ error: "Group not found" });
    await prisma.tenantAudit.create({
      data: { tenantId: user.tenantId, actorId: user.userId, groupId: request.params.id, action: "GROUP_UPDATED" }
    });
    return { saved: true };
  });

  app.delete<{ Params: { id: string } }>("/portal/api/groups/:id", async (request, reply) => {
    if (!requireMutationHeader(request, reply)) return;
    const user = await requirePortalAuth(prisma, request, reply);
    if (!user) return;
    if (user.role === "VIEWER") return reply.code(403).send({ error: "Read-only membership" });

    // Disconnect only a group owned by this tenant, without deleting the
    // underlying WhatsApp message history or changing any other workspace.
    const result = await prisma.group.updateMany({
      where: { id: request.params.id, tenantId: user.tenantId, gateway: "WEB" },
      data: { tenantId: null, claimedAt: null, consentAt: null, enabled: false }
    });
    if (!result.count) return reply.code(404).send({ error: "Group not found" });
    await prisma.tenantAudit.create({
      data: { tenantId: user.tenantId, actorId: user.userId, groupId: request.params.id, action: "GROUP_DISCONNECTED" }
    });
    return { disconnected: true };
  });

  app.delete<{ Params: { id: string } }>("/portal/api/groups/:id/messages", async (request, reply) => {
    if (!requireMutationHeader(request, reply)) return;
    const user = await requirePortalAuth(prisma, request, reply);
    if (!user) return;
    if (user.role === "VIEWER") return reply.code(403).send({ error: "Read-only membership" });
    const group = await prisma.group.findFirst({
      where: { id: request.params.id, tenantId: user.tenantId },
      select: { id: true, claimedAt: true, enabled: true }
    });
    if (!group?.claimedAt) return reply.code(404).send({ error: "Group not found" });
    if (group.enabled) return reply.code(409).send({ error: "Pause the group before erasing its stored history" });
    const deleted = await prisma.message.deleteMany({
      where: { groupId: group.id, createdAt: { gte: group.claimedAt } }
    });
    await prisma.tenantAudit.create({
      data: { tenantId: user.tenantId, actorId: user.userId, groupId: group.id, action: "MESSAGES_DELETED" }
    });
    return { deleted: deleted.count };
  });

  app.get("/portal/api/connection", async (request, reply) => {
    const user = await requirePortalAuth(prisma, request, reply);
    if (!user) return;
    const pulse = await prisma.gatewayHealth.findUnique({ where: { name: "web" } });
    return {
      gateway: "web",
      status: cfg.webEnabled ? pulse?.state ?? "CHECKING" : "DISABLED",
      checkedAt: pulse?.checkedAt ?? null
    };
  });

  app.get("/portal/api/usage", async (request, reply) => {
    const user = await requirePortalAuth(prisma, request, reply);
    if (!user) return;
    const memberGroups = await prisma.group.findMany({
      where: { tenantId: user.tenantId },
      select: { id: true, claimedAt: true }
    });
    const month = monthKey();
    const counter = await prisma.tenantUsage.findUnique({
      where: { tenantId_month: { tenantId: user.tenantId, month } }
    });
    const limits = await getTenantLimits(prisma, cfg, user.tenantId);
    const periodStart = monthStart();
    const segments = memberGroups.map(group => ({
      groupId: group.id,
      createdAt: {
        gte: group.claimedAt && group.claimedAt > periodStart
          ? group.claimedAt : periodStart
      }
    }));
    const recent = segments.length ? await prisma.message.findMany({
      where: { OR: segments },
      orderBy: { createdAt: "desc" }, take: 10,
      select: {
        id: true, status: true, sourceLanguage: true, createdAt: true,
        group: { select: { name: true } }
      }
    }) : [];
    return {
      groups: memberGroups.length, messages: counter?.messages ?? 0,
      limits: { groups: limits.groups, messagesPerMonth: limits.messagesPerMonth },
      plan: { code: limits.plan, status: limits.status },
      recent
    };
  });

  app.post("/portal/api/activations", async (request, reply) => {
    if (!requireMutationHeader(request, reply)) return;
    // Explicit customer acknowledgement, followed by a separate command from
    // an actual group administrator, establishes the pilot consent workflow.
    z.object({ consentConfirmed: z.literal(true) }).strict().parse(request.body);
    const user = await requirePortalAuth(prisma, request, reply);
    if (!user) return;
    if (user.role === "VIEWER") return reply.code(403).send({ error: "Read-only membership" });
    if (cfg.SAAS_REQUIRE_EMAIL_VERIFICATION === "true") {
      const verified = await prisma.portalUser.findUnique({
        where: { id: user.userId }, select: { emailVerifiedAt: true }
      });
      if (!verified?.emailVerifiedAt) {
        return reply.code(403).send({ error: "Verify your email before activating WhatsApp groups" });
      }
    }
    if (!allowAttempt("activation:" + user.tenantId, 5, 15 * 60_000)) {
      return reply.code(429).send({ error: "Too many activation requests" });
    }
    const now = new Date();
    const limits = await getTenantLimits(prisma, cfg, user.tenantId);
    if (!planActive(limits, now)) {
      return reply.code(403).send({ error: "Subscription inactive; group activation unavailable" });
    }
    const [groups, pending] = await Promise.all([
      prisma.group.count({ where: { tenantId: user.tenantId } }),
      prisma.groupActivation.count({ where: {
        tenantId: user.tenantId, consumedAt: null, expiresAt: { gt: now }
      } })
    ]);
    if (groups >= limits.groups) {
      return reply.code(409).send({ error: "Group plan limit reached" });
    }
    if (pending >= 2) return reply.code(429).send({ error: "Finish an existing activation first" });
    const code = randomBytes(8).toString("hex").toUpperCase();
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    await prisma.groupActivation.create({
      data: {
        codeHash: digest(code), tenantId: user.tenantId,
        createdBy: user.userId, expiresAt
      }
    });
    return reply.code(201).send({
      code, expiresAt,
      instruction: "Add the W-Bot number to your group. A group admin must send /wbot connect " + code
    });
  });

  app.get("/portal/api/activations", async (request, reply) => {
    const user = await requirePortalAuth(prisma, request, reply);
    if (!user) return;
    return {
      activations: await prisma.groupActivation.findMany({
        where: { tenantId: user.tenantId },
        orderBy: { createdAt: "desc" }, take: 50,
        select: {
          id: true, createdAt: true, expiresAt: true,
          consumedAt: true, activatedGroupId: true
        }
      })
    };
  });

  // The trusted, private Baileys gateway performs a fresh online groupMetadata
  // lookup, checks that the command sender is a WhatsApp group admin, then
  // forwards the command here. Never accept a public customer assertion.
  app.post("/internal/web/activate", async (request, reply) => {
    const h = request.headers.authorization;
    const supplied = h?.startsWith("Bearer ") ? h.slice(7) : "";
    if (!cfg.webEnabled || !cfg.WEB_GATEWAY_TOKEN ||
        !safeCompare(supplied, cfg.WEB_GATEWAY_TOKEN)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const command = activationInput.parse(request.body);
    const now = new Date();
    try {
      const result = await prisma.$transaction(async tx => {
        const claim = await tx.groupActivation.findUnique({
          where: { codeHash: digest(command.code.toUpperCase()) }
        });
        if (!claim || claim.consumedAt || claim.expiresAt <= now) return null;
        const existing = await tx.group.findUnique({
          where: { whatsappGroupId: command.groupId }
        });
        // A group may never be silently moved between customer workspaces.
        if (existing && (existing.gateway !== "WEB" ||
            (existing.tenantId && existing.tenantId !== claim.tenantId))) return null;
        // Lock the owning workspace row: concurrent activation requests from
        // different groups must not oversubscribe its group allowance.
        await tx.$queryRaw`SELECT id FROM Tenant WHERE id = ${claim.tenantId} FOR UPDATE`;
        const limits = await tx.tenantSubscription.findUnique({
          where: { tenantId: claim.tenantId }
        });
        if (limits && !planActive(limits, now)) return null;
        const maxGroups = limits?.groupLimit ?? cfg.SAAS_MAX_GROUPS;
        const count = await tx.group.count({ where: { tenantId: claim.tenantId } });
        if ((!existing || !existing.tenantId) && count >= maxGroups) return null;
        const consumed = await tx.groupActivation.updateMany({
          where: { id: claim.id, consumedAt: null, expiresAt: { gt: now } },
          data: { consumedAt: now }
        });
        if (consumed.count !== 1) return null;
        const updatedGroup = existing
          ? await tx.group.update({
              where: { id: existing.id },
              data: {
                tenantId: claim.tenantId, claimedAt: now, consentAt: now,
                name: command.groupName, enabled: true,
                targetLanguages: [...DEFAULT_TARGET_LANGUAGES]
              }
            })
          : await tx.group.create({
              data: {
                tenantId: claim.tenantId, claimedAt: now, consentAt: now,
                whatsappGroupId: command.groupId,
                gateway: "WEB", name: command.groupName, enabled: true,
                targetLanguages: [...DEFAULT_TARGET_LANGUAGES]
              }
            });
        await tx.groupActivation.update({
          where: { id: claim.id }, data: { activatedGroupId: updatedGroup.id }
        });
        await tx.tenantAudit.create({
          data: {
            tenantId: claim.tenantId, actorId: claim.createdBy,
            groupId: updatedGroup.id, action: "GROUP_ACTIVATED"
          }
        });
        return { activated: true };
      });
      if (!result) return rejected(reply);
      return result;
    } catch {
      // A simultaneous claim or stale state is treated as a safe rejection.
      return rejected(reply);
    }
  });
}
