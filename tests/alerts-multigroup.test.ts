import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../src/config.js";
import { registerAlertsRoutes } from "../src/alerts-routes.js";

const cfg = loadConfig({
  DATABASE_URL: "mysql://u:p@localhost:3306/wbot",
  SAAS_ENABLED: "true", SAAS_SIGNUP_CODE: "a".repeat(48),
  ADMIN_API_KEY: "b".repeat(64), WHATSAPP_VERIFY_TOKEN: "c".repeat(32),
  BYON_GATEWAY_ENABLED: "true", BYON_GATEWAY_TOKEN: "d".repeat(64)
});
const connectionId = "c" + "a".repeat(24);
const groups = ["123456789@g.us", "987654321@g.us"];
const headers = { cookie: "wbot_portal_session=" + "x".repeat(43), "x-wbot-request": "1" };
function db(maxGroups = 3) {
  const saved: Array<{ whatsappGroupId: string }> = [];
  const prisma = {
    portalSession: { findUnique: async () => ({
      expiresAt: new Date(Date.now() + 60000),
      user: { email: "owner@example.com", displayName: "Owner",
        memberships: [{ tenantId: "tenant-A", role: "OWNER", tenant: { name: "Workspace A" } }] }
    }) },
    customerWhatsAppConnection: { findFirst: async (args: { where: { tenantId: string } }) => {
      assert.equal(args.where.tenantId, "tenant-A");
      return { id: connectionId, kind: "PERSONAL", status: "CONNECTED", active: true };
    } },
    whatsAppConnectionPolicy: { findUnique: async () => ({
      customerNumbersEnabled: true, personalEnabled: true, businessEnabled: true
    }) },
    alertSubscription: { findUnique: async () => ({
      tenantId: "tenant-A", enabled: true, status: "ACTIVE", periodEnd: null,
      maxGroups
    }) },
    $transaction: async (handler: (tx: unknown) => Promise<unknown>) => handler({
      $queryRaw: async () => [{ id: "tenant-A" }],
      alertSubscription: { findUnique: async () => ({
        tenantId: "tenant-A", enabled: true, status: "ACTIVE", periodEnd: null, maxGroups
      }) },
      watchGroup: {
        findMany: async () => [],
        count: async () => 0,
        createMany: async (args: { data: Array<{ whatsappGroupId: string }> }) => {
          saved.push(...args.data); return { count: args.data.length };
        }
      },
      tenantAudit: { create: async () => ({}) }
    })
  } as unknown as PrismaClient;
  return { prisma, saved };
}
test("bulk monitoring validates membership, then saves all groups atomically", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    groups: groups.map((groupId, i) => ({ groupId, name: "Consenting group " + (i+1) }))
  }), { status: 200 })) as typeof fetch;
  try {
    const { prisma, saved } = db();
    const app = Fastify(); registerAlertsRoutes(app, prisma, cfg);
    const response = await app.inject({
      method: "POST", url: "/portal/api/alerts/groups/bulk",
      headers, payload: { connectionId, groupIds: groups, consentConfirmed: true }
    });
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().added, 2);
    assert.deepEqual(saved.map(item => item.whatsappGroupId), groups);
    await app.close();
  } finally { globalThis.fetch = original; }
});
test("bulk monitoring cannot exceed subscribed group slots", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    groups: groups.map(groupId => ({ groupId, name: "Consenting group" }))
  }), { status: 200 })) as typeof fetch;
  try {
    const { prisma, saved } = db(1);
    const app = Fastify(); registerAlertsRoutes(app, prisma, cfg);
    const response = await app.inject({
      method: "POST", url: "/portal/api/alerts/groups/bulk",
      headers, payload: { connectionId, groupIds: groups, consentConfirmed: true }
    });
    assert.equal(response.statusCode, 409);
    assert.equal(saved.length, 0);
    await app.close();
  } finally { globalThis.fetch = original; }
});
test("bulk monitoring requires the mutation security header", async () => {
  const app = Fastify(); registerAlertsRoutes(app, {} as PrismaClient, cfg);
  const response = await app.inject({
    method: "POST", url: "/portal/api/alerts/groups/bulk",
    payload: { connectionId, groupIds: groups, consentConfirmed: false }
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});
