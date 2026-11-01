import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../src/config.js";
import { registerPortalRoutes } from "../src/portal.js";
import { digest, SESSION_COOKIE } from "../src/portal-auth.js";

const token = "x".repeat(43);
const cfg = loadConfig({
  DATABASE_URL: "mysql://u:p@localhost:3306/wbot",
  ADMIN_API_KEY: "a".repeat(64),
  WHATSAPP_VERIFY_TOKEN: "b".repeat(32),
  SAAS_ENABLED: "true",
  SAAS_SIGNUP_CODE: "c".repeat(48)
});

function user(tenantId: string) {
  return {
    userId: "user", expiresAt: new Date(Date.now() + 86400000),
    user: {
      email: "owner@example.com", displayName: "Owner",
      memberships: [{
        tenantId, role: "OWNER",
        tenant: { name: tenantId }
      }]
    }
  };
}
test("customer B cannot list Customer A's groups via direct REST calls", async () => {
  let seenWhere: unknown;
  const prisma = {
    portalSession: { findUnique: async () => user("B") },
    group: { findMany: async (args: { where: unknown }) => {
      seenWhere = args.where;
      return [{ id: "B-only", name: "B", enabled: true }];
    }}
  } as unknown as PrismaClient;
  const app = Fastify();
  registerPortalRoutes(app, prisma, cfg);
  const response = await app.inject({
    method: "GET", url: "/portal/api/groups",
    headers: { cookie: SESSION_COOKIE + "=" + token }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(seenWhere, { tenantId: "B" });
  await app.close();
});

test("direct REST cannot disconnect a group assigned to a foreign tenant", async () => {
  let where: unknown;
  const prisma = {
    portalSession: { findUnique: async (args: { where: { tokenHash: string } }) => {
      assert.equal(args.where.tokenHash, digest(token));
      return user("B");
    }},
    group: { updateMany: async (args: { where: unknown }) => {
      where = args.where;
      return { count: 0 };
    }}
  } as unknown as PrismaClient;
  const app = Fastify();
  registerPortalRoutes(app, prisma, cfg);
  const response = await app.inject({
    method: "DELETE", url: "/portal/api/groups/A-group",
    headers: {
      cookie: SESSION_COOKIE + "=" + token,
      "x-wbot-request": "1"
    }
  });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(where, { id: "A-group", tenantId: "B", gateway: "WEB" });
  await app.close();
});

test("tenant group listing includes customer number metadata and preserves tenant isolation", async () => {
  let seenWhere: unknown;
  let seenSelect: Record<string, unknown> | undefined;
  const prisma = {
    portalSession: { findUnique: async () => user("tenant-a") },
    group: { findMany: async (args: {
      where: unknown; select: Record<string, unknown>
    }) => {
      seenWhere = args.where;
      seenSelect = args.select;
      return [{
        id: "group-owned-by-a", name: "Personal test group",
        whatsappGroupId: "12345678901@g.us", gateway: "WEB", enabled: true,
        connectionId: "test-connection-a",
        connection: { label: "My personal phone", kind: "PERSONAL", phoneLast4: "4567" }
      }];
    } }
  } as unknown as PrismaClient;
  const app = Fastify();
  registerPortalRoutes(app, prisma, cfg);
  const response = await app.inject({
    method: "GET", url: "/portal/api/groups",
    headers: { cookie: SESSION_COOKIE + "=" + token }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(seenWhere, { tenantId: "tenant-a" });
  assert.deepEqual(seenSelect?.connection, {
    select: { label: true, kind: true, phoneLast4: true }
  });
  assert.equal(response.json().groups[0].connection.kind, "PERSONAL");
  await app.close();
});
