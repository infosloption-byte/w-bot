import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../src/config.js";
import { registerPortalRoutes } from "../src/portal.js";
import { digest, SESSION_COOKIE } from "../src/portal-auth.js";

function pilotConfig() {
  return loadConfig({
    DATABASE_URL: "mysql://user:pass@localhost:3306/wbot",
    ADMIN_API_KEY: "a".repeat(64),
    WHATSAPP_VERIFY_TOKEN: "b".repeat(32),
    SAAS_ENABLED: "true",
    SAAS_SIGNUP_CODE: "c".repeat(48),
    SAAS_COOKIE_SECURE: "false",
    DRY_RUN: "true"
  });
}

const sessionToken = "x".repeat(43);
const session = {
  userId: "user-a",
  expiresAt: new Date(Date.now() + 86_400_000),
  user: {
    id: "user-a", email: "owner@example.com", displayName: "Owner A",
    memberships: [{
      tenantId: "tenant-a", role: "OWNER",
      tenant: { id: "tenant-a", name: "Workspace A" }
    }]
  }
};

test("group updates require a tenant filter and reject another tenant's group", async () => {
  const writes: unknown[] = [];
  const prisma = {
    portalSession: { findUnique: async (args: { where: { tokenHash: string } }) => {
      assert.equal(args.where.tokenHash, digest(sessionToken));
      return session;
    }},
    group: { updateMany: async (args: unknown) => {
      writes.push(args);
      return { count: 0 }; // foreign group's record should not match tenant-a
    }}
  } as unknown as PrismaClient;
  const app = Fastify();
  registerPortalRoutes(app, prisma, pilotConfig());
  const response = await app.inject({
    method: "PATCH", url: "/portal/api/groups/foreign-group",
    headers: {
      cookie: SESSION_COOKIE + "=" + sessionToken,
      "x-wbot-request": "1"
    },
    payload: { enabled: false }
  });
  assert.equal(response.statusCode, 404);
  assert.equal(writes.length, 1);
  assert.deepEqual((writes[0] as { where: unknown }).where, {
    id: "foreign-group", tenantId: "tenant-a", gateway: "WEB"
  });
  await app.close();
});

test("mutating portal routes reject requests without custom CSRF header", async () => {
  const prisma = {} as PrismaClient;
  const app = Fastify();
  registerPortalRoutes(app, prisma, pilotConfig());
  const response = await app.inject({
    method: "POST", url: "/portal/api/auth/login",
    payload: { email: "owner@example.com", password: "something" }
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test("invalid group claim is rejected without assigning ownership", async () => {
  let updated = false;
  const prisma = {
    groupActivation: {
      findUnique: async () => ({
        id: "activation", tenantId: "tenant-a",
        consumedAt: null, expiresAt: new Date(Date.now() + 90_000)
      })
    },
    group: { findUnique: async () => ({
      id: "group-owned-by-b",
      tenantId: "tenant-b",
      gateway: "WEB"
    }) },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        groupActivation: {
          findUnique: async () => ({
            id: "activation", tenantId: "tenant-a",
            consumedAt: null, expiresAt: new Date(Date.now() + 90_000)
          }),
          updateMany: async () => { updated = true; return { count: 1 }; }
        },
        group: { findUnique: async () => ({
          id: "group-owned-by-b", tenantId: "tenant-b", gateway: "WEB"
        }) }
      })
  } as unknown as PrismaClient;
  const app = Fastify();
  const cfg = loadConfig({
    ...pilotConfig(),
    WEB_GATEWAY_ENABLED: "true",
    WEB_GATEWAY_TOKEN: "z".repeat(64)
  } as NodeJS.ProcessEnv);
  registerPortalRoutes(app, prisma, cfg);
  const response = await app.inject({
    method: "POST", url: "/internal/web/activate",
    headers: { authorization: "Bearer " + "z".repeat(64) },
    payload: {
      groupId: "120363123456789012@g.us", groupName: "Foreign group",
      messageId: "ABC", senderId: "123@lid",
      code: "ABCDEF0123456789", adminVerified: true
    }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(updated, false);
  await app.close();
});
