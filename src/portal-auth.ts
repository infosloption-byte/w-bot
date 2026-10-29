import { createHash, randomBytes, scrypt as rawScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient, MemberRole } from "@prisma/client";

const scrypt = promisify(rawScrypt);
export const SESSION_COOKIE = "wbot_portal_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const result = await scrypt(password, Buffer.from(salt, "hex"), 64) as Buffer;
  return "scrypt$" + salt + "$" + result.toString("hex");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt" ||
      !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
  const result = await scrypt(password, Buffer.from(parts[1], "hex"), 64) as Buffer;
  return timingSafeEqual(result, Buffer.from(parts[2], "hex"));
}

export function sessionCookie(token: string, secure: boolean, maxAge = SESSION_MAX_AGE): string {
  const base = SESSION_COOKIE + "=" + encodeURIComponent(token)
    + "; HttpOnly; SameSite=Strict; Path=/portal; Max-Age=" + maxAge;
  return secure ? base + "; Secure" : base;
}

function cookieFromRequest(request: FastifyRequest): string | null {
  const cookies = request.headers.cookie?.split(";") ?? [];
  for (const cookie of cookies) {
    const [name, ...value] = cookie.trim().split("=");
    if (name !== SESSION_COOKIE || !value.length) continue;
    const token = value.join("=");
    if (/^[A-Za-z0-9_-]{40,100}$/.test(token)) return token;
  }
  return null;
}

export async function createSession(prisma: PrismaClient, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.portalSession.create({
    data: {
      tokenHash: digest(token), userId,
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE * 1000)
    }
  });
  return token;
}

export type PortalAuth = {
  userId: string;
  tenantId: string;
  role: MemberRole;
  email: string;
  displayName: string;
  tenantName: string;
};

export async function requirePortalAuth(
  prisma: PrismaClient, request: FastifyRequest, reply: FastifyReply
): Promise<PortalAuth | null> {
  const token = cookieFromRequest(request);
  if (!token) { reply.code(401).send({ error: "Sign in required" }); return null; }
  const session = await prisma.portalSession.findUnique({
    where: { tokenHash: digest(token) },
    include: {
      user: { include: {
        memberships: { include: { tenant: true }, orderBy: { joinedAt: "asc" }, take: 1 }
      } }
    }
  });
  if (!session || session.expiresAt <= new Date() || !session.user.memberships[0]) {
    reply.code(401).send({ error: "Session expired" });
    return null;
  }
  const membership = session.user.memberships[0];
  return {
    userId: session.userId,
    tenantId: membership.tenantId,
    role: membership.role,
    email: session.user.email,
    displayName: session.user.displayName,
    tenantName: membership.tenant.name
  };
}

export function requireMutationHeader(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.headers["x-wbot-request"] !== "1") {
    reply.code(403).send({ error: "Request header required" });
    return false;
  }
  return true;
}

// Limited per-instance abuse control for the invite-only pilot.
// Replace with a shared persistent limiter before public signup.
const buckets = new Map<string, { count: number; resets: number }>();
export function allowAttempt(key: string, limit = 8, windowMs = 60_000): boolean {
  const now = Date.now();
  if (buckets.size > 10_000) {
    for (const [id, value] of buckets) if (value.resets <= now) buckets.delete(id);
  }
  const entry = buckets.get(key);
  if (!entry || entry.resets < now) {
    buckets.set(key, { count: 1, resets: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}
