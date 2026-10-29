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

  app.post("/portal/api/auth/register", async (request, reply) => {
    if (!requireMutationHeader(request, reply)) return;
    if (!allowAttempt("register:" + request.ip, 4, 3600_000)) {
      return reply.code(429).send({ error: "Too many signup attempts" });
    }
    const data = registration.parse(request.body);
    if (!safeCompare(data.inviteCode, cfg.SAAS_SIGNUP_CODE!)) {
      return reply.code(403).send({ error: "Invalid pilot invitation" });
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
        return created;
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        return reply.code(409).send({ error: "Email is already registered" });
      }
      throw error;
    }
    const token = await createSession(prisma, user.id);
    reply.header("set-cookie", sessionCookie(token, cfg.SAAS_COOKIE_SECURE === "true"));
    return reply.code(201).send({ registered: true });
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
    return {
      user: { name: user.displayName, email: user.email },
      workspace: { id: user.tenantId, name: user.tenantName, role: user.role },
      limits: { groups: cfg.SAAS_MAX_GROUPS, messagesPerMonth: cfg.SAAS_MONTHLY_MESSAGES },
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
    return { saved: true };
  });

  app.get("/portal/api/usage", async (request, reply) => {
    const user = await requirePortalAuth(prisma, request, reply);
    if (!user) return;
    const memberGroups = await prisma.group.findMany({
      where: { tenantId: user.tenantId },
      select: { id: true, claimedAt: true }
    });
    // Only report messages received AFTER the tenant was verified as the
    // group owner; do not expose historical data from previously unclaimed groups.
    const segments = memberGroups.map(group => ({
      groupId: group.id,
      createdAt: {
        gte: group.claimedAt && group.claimedAt > monthStart()
          ? group.claimedAt : monthStart()
      }
    }));
    const [messages, recent] = segments.length
      ? await Promise.all([
          prisma.message.count({ where: { OR: segments } }),
          prisma.message.findMany({
            where: { OR: segments },
            orderBy: { createdAt: "desc" }, take: 10,
            select: {
              id: true, status: true, sourceLanguage: true, createdAt: true,
              group: { select: { name: true } }
            }
          })
        ])
      : [0, []] as const;
    return {
      groups: memberGroups.length, messages,
      limits: { groups: cfg.SAAS_MAX_GROUPS, messagesPerMonth: cfg.SAAS_MONTHLY_MESSAGES },
      recent
    };
  });

  app.post("/portal/api/activations", async (request, reply) => {
    if (!requireMutationHeader(request, reply)) return;
    const user = await requirePortalAuth(prisma, request, reply);
    if (!user) return;
    if (user.role === "VIEWER") return reply.code(403).send({ error: "Read-only membership" });
    if (!allowAttempt("activation:" + user.tenantId, 5, 15 * 60_000)) {
      return reply.code(429).send({ error: "Too many activation requests" });
    }
    const now = new Date();
    const [groups, pending] = await Promise.all([
      prisma.group.count({ where: { tenantId: user.tenantId } }),
      prisma.groupActivation.count({ where: {
        tenantId: user.tenantId, consumedAt: null, expiresAt: { gt: now }
      } })
    ]);
    if (groups >= cfg.SAAS_MAX_GROUPS) {
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
        where: { tenantId: user.tenantId, consumedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true, expiresAt: true }
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
        const count = await tx.group.count({ where: { tenantId: claim.tenantId } });
        if ((!existing || !existing.tenantId) && count >= cfg.SAAS_MAX_GROUPS) return null;
        const consumed = await tx.groupActivation.updateMany({
          where: { id: claim.id, consumedAt: null, expiresAt: { gt: now } },
          data: { consumedAt: now }
        });
        if (consumed.count !== 1) return null;
        if (existing) {
          await tx.group.update({
            where: { id: existing.id },
            data: {
              tenantId: claim.tenantId,
              claimedAt: now,
              name: command.groupName,
              enabled: true,
              targetLanguages: [...DEFAULT_TARGET_LANGUAGES]
            }
          });
        } else {
          await tx.group.create({
            data: {
              tenantId: claim.tenantId,
              claimedAt: now,
              whatsappGroupId: command.groupId,
              gateway: "WEB",
              name: command.groupName, enabled: true,
              targetLanguages: [...DEFAULT_TARGET_LANGUAGES]
            }
          });
        }
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
