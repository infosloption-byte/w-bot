import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";
import { allowAttempt, requirePortalAuth, requireMutationHeader,
  verifyPassword, hashPassword, digest, SESSION_COOKIE, sessionCookie } from "./portal-auth.js";
import { mailConfigured, sendAccountEmail, issueAccountToken } from "./mailer.js";
import { getTenantLimits } from "./quotas.js";
import { PAID_PLANS } from "./plan-catalog.js";

const address = z.object({ email: z.string().email().max(191).transform(s => s.toLowerCase()) }).strict();
const newPassword = z.string().min(12).max(128);
const tokenInput = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const resetInput = tokenInput.extend({ password: newPassword });
const passwordChange = z.object({ currentPassword: z.string(), newPassword }).strict();
const profileChange = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  workspace: z.string().trim().min(2).max(191).optional()
}).strict().refine(data => Object.keys(data).length > 0);

export function registerAccountRoutes(app: FastifyInstance, prisma: PrismaClient, cfg: Config) {
  // A generic response prevents leaking which addresses belong to customers.
  app.post("/portal/api/auth/forgot-password", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const input = address.parse(req.body);
    if (!allowAttempt("forgot:" + digest(input.email), 3, 60 * 60_000)) {
      return reply.code(202).send({ accepted: true });
    }
    const user = await prisma.portalUser.findUnique({ where: { email: input.email } });
    if (user && mailConfigured(cfg)) {
      const token = await issueAccountToken(prisma, user.id, "RESET_PASSWORD");
      try { await sendAccountEmail(cfg, user.email, "reset", token); }
      catch { app.log.error("Password reset delivery failed (email omitted)"); }
    }
    return reply.code(202).send({ accepted: true });
  });

  app.post("/portal/api/auth/reset-password", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const input = resetInput.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    const now = new Date();
    const changed = await prisma.$transaction(async tx => {
      const item = await tx.accountToken.findUnique({ where: { tokenHash: digest(input.token) } });
      if (!item || item.kind !== "RESET_PASSWORD" || item.usedAt || item.expiresAt <= now) return false;
      const claimed = await tx.accountToken.updateMany({
        where: { id: item.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now }
      });
      if (!claimed.count) return false;
      await tx.portalUser.update({
        where: { id: item.userId }, data: { passwordHash, emailVerifiedAt: now }
      });
      await tx.portalSession.deleteMany({ where: { userId: item.userId } });
      await tx.accountToken.deleteMany({ where: { userId: item.userId, kind: "VERIFY_EMAIL" } });
      return true;
    });
    if (!changed) return reply.code(400).send({ error: "Reset link expired or already used" });
    return { changed: true };
  });

  app.post("/portal/api/auth/verify-email", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const input = tokenInput.parse(req.body);
    const now = new Date();
    const verified = await prisma.$transaction(async tx => {
      const item = await tx.accountToken.findUnique({ where: { tokenHash: digest(input.token) } });
      if (!item || item.kind !== "VERIFY_EMAIL" || item.usedAt || item.expiresAt <= now) return false;
      const claimed = await tx.accountToken.updateMany({
        where: { id: item.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now }
      });
      if (!claimed.count) return false;
      await tx.portalUser.update({
        where: { id: item.userId }, data: { emailVerifiedAt: now }
      });
      return true;
    });
    if (!verified) return reply.code(400).send({ error: "Verification link expired or already used" });
    return { verified: true };
  });

  app.post("/portal/api/auth/resend-verification", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    if (!mailConfigured(cfg)) return reply.code(503).send({ error: "Email delivery is not configured" });
    if (!allowAttempt("verify:" + user.userId, 3, 60 * 60_000)) {
      return reply.code(429).send({ error: "Too many verification requests" });
    }
    const account = await prisma.portalUser.findUnique({ where: { id: user.userId } });
    if (!account || account.emailVerifiedAt) return { sent: false, alreadyVerified: true };
    const token = await issueAccountToken(prisma, account.id, "VERIFY_EMAIL");
    try { await sendAccountEmail(cfg, account.email, "verify", token); }
    catch {
      app.log.error("Email verification delivery failed (email omitted)");
      return reply.code(502).send({ error: "Unable to send verification email" });
    }
    return { sent: true };
  });

  app.patch("/portal/api/profile", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    const update = profileChange.parse(req.body);
    if (update.workspace && user.role !== "OWNER" && user.role !== "ADMIN")
      return reply.code(403).send({ error: "Workspace management requires admin access" });
    await prisma.$transaction(async tx => {
      if (update.name) await tx.portalUser.update({
        where: { id: user.userId }, data: { displayName: update.name }
      });
      if (update.workspace) await tx.tenant.update({
        where: { id: user.tenantId }, data: { name: update.workspace }
      });
      await tx.tenantAudit.create({
        data: { tenantId: user.tenantId, actorId: user.userId, action: "PROFILE_UPDATED" }
      });
    });
    return { saved: true };
  });

  app.post("/portal/api/auth/change-password", async (req, reply) => {
    if (!requireMutationHeader(req, reply)) return;
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    const input = passwordChange.parse(req.body);
    const account = await prisma.portalUser.findUnique({ where: { id: user.userId } });
    if (!account || !await verifyPassword(input.currentPassword, account.passwordHash)) {
      return reply.code(403).send({ error: "Current password is incorrect" });
    }
    const passwordHash = await hashPassword(input.newPassword);
    await prisma.$transaction(async tx => {
      await tx.portalUser.update({ where: { id: user.userId }, data: { passwordHash } });
      await tx.portalSession.deleteMany({ where: { userId: user.userId } });
      await tx.tenantAudit.create({
        data: { tenantId: user.tenantId, actorId: user.userId, action: "PASSWORD_CHANGED" }
      });
    });
    reply.header("set-cookie", sessionCookie("", cfg.SAAS_COOKIE_SECURE === "true", 0));
    return { changed: true, signInRequired: true };
  });

  app.get("/portal/api/audit", async (req, reply) => {
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    const events = await prisma.tenantAudit.findMany({
      where: { tenantId: user.tenantId },
      select: { id: true, action: true, groupId: true, createdAt: true },
      orderBy: { createdAt: "desc" }, take: 50
    });
    return { events };
  });

  app.get("/portal/api/plans", async (req, reply) => {
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    return { plans: PAID_PLANS, billingEnabled: false };
  });

  app.get("/portal/api/subscription", async (req, reply) => {
    const user = await requirePortalAuth(prisma, req, reply);
    if (!user) return;
    return {
      subscription: await getTenantLimits(prisma, cfg, user.tenantId),
      billingEnabled: false,
      note: "Pilot subscriptions are assigned administratively; no payment provider is connected."
    };
  });
}
