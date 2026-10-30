import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../src/config.js";
import { registerPlatformRoutes } from "../src/platform.js";
import { digest } from "../src/portal-auth.js";

const config = loadConfig({
  DATABASE_URL: "mysql://user:pass@localhost:3306/wbot",
  SAAS_ENABLED: "true",
  SAAS_SIGNUP_CODE: "a".repeat(48),
  ADMIN_API_KEY: "b".repeat(64),
  WHATSAPP_VERIFY_TOKEN: "c".repeat(32),
  SAAS_COOKIE_SECURE: "false"
});
const rawToken = "x".repeat(43);
const goodCookie = "wbot_platform_session=" + rawToken;
const requestHeaders = { cookie: goodCookie, "x-wbot-request": "1" };
function platformSession(role = "SUPER_ADMIN") {
  return {
    expiresAt: new Date(Date.now() + 100_000),
    admin: {
      id: "platform-1", displayName: "Platform Operator", email: "owner@example.com",
      role, active: true, lastLoginAt: null
    }
  };
}

test("platform API does not accept customer portal sessions", async () => {
  const app = Fastify();
  registerPlatformRoutes(app, {} as PrismaClient, config);
  for (const path of [
    "/portal/api/platform/me",
    "/portal/api/platform/overview",
    "/portal/api/platform/tenants",
    "/portal/api/platform/groups",
    "/portal/api/platform/deliveries"
  ]) {
    const response = await app.inject({
      method: "GET", url: path,
      headers: { cookie: "wbot_portal_session=" + rawToken }
    });
    assert.equal(response.statusCode, 401, path);
  }
  await app.close();
});

test("admin authorization checks a distinct hashed platform session", async () => {
  const prisma = {
    platformSession: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        assert.equal(where.tokenHash, digest(rawToken));
        return platformSession();
      }
    }
  } as unknown as PrismaClient;
  const app = Fastify();
  registerPlatformRoutes(app, prisma, config);
  const response = await app.inject({
    method: "GET", url: "/portal/api/platform/me",
    headers: { cookie: goodCookie }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().role, "SUPER_ADMIN");
  assert.equal("passwordHash" in response.json(), false);
  await app.close();
});

test("read-only platform operator cannot alter tenant subscription", async () => {
  let changed = false;
  const prisma = {
    platformSession: { findUnique: async () => platformSession("VIEWER") },
    tenantSubscription: { upsert: async () => { changed = true; } }
  } as unknown as PrismaClient;
  const app = Fastify();
  registerPlatformRoutes(app, prisma, config);
  const response = await app.inject({
    method: "PATCH", url: "/portal/api/platform/tenants/tenant-A/subscription",
    headers: requestHeaders,
    payload: {
      planCode: "PILOT", status: "ACTIVE",
      groupLimit: 3, monthlyMessages: 1000, periodEnd: null
    }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(changed, false);
  await app.close();
});

test("non-platform credentials cannot pause customer groups via direct API requests", async () => {
  const app = Fastify();
  registerPlatformRoutes(app, {} as PrismaClient, config);
  const response = await app.inject({
    method: "PATCH", url: "/portal/api/platform/groups/target-id",
    headers: {
      cookie: "wbot_portal_session=" + rawToken,
      "x-wbot-request": "1"
    },
    payload: { enabled: false }
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("platform overview returns aggregated metadata, not private chat content", async () => {
  const prisma = {
    platformSession: { findUnique: async () => platformSession() },
    tenant: { count: async () => 2 },
    portalUser: { count: async () => 4 },
    group: { count: async (query?: { where?: { enabled: boolean } }) =>
      query?.where?.enabled ? 2 : 3 },
    tenantUsage: { aggregate: async () => ({ _sum: { messages: 7 } }) },
    message: { count: async () => 0 },
    gatewayHealth: { findUnique: async () => ({
      state: "CONNECTED", checkedAt: new Date(), changedAt: new Date()
    }) }
  } as unknown as PrismaClient;
  const app = Fastify();
  registerPlatformRoutes(app, prisma, config);
  const response = await app.inject({
    method: "GET", url: "/portal/api/platform/overview",
    headers: { cookie: goodCookie }
  });
  assert.equal(response.statusCode, 200);
  const result = response.json();
  assert.equal(result.tenants, 2);
  assert.equal(result.messagesThisMonth, 7);
  assert.equal(result.gateway.status, "CONNECTED");
  assert.equal("originalText" in result, false);
  await app.close();
});

test("platform login rejects cross-origin requests before credential lookup", async () => {
  const app = Fastify();
  registerPlatformRoutes(app, {} as PrismaClient, config);
  const response = await app.inject({
    method: "POST", url: "/portal/api/platform/auth/login",
    headers: {
      "x-wbot-request": "1",
      origin: "https://attacker.example",
      host: "localhost:9048"
    },
    payload: { email: "owner@example.com", password: "never-a-real-password" }
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});
