import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../src/config.js";
import { registerAlertsRoutes } from "../src/alerts-routes.js";

const cfg = loadConfig({
  DATABASE_URL: "mysql://u:p@localhost:3306/wbot",
  SAAS_ENABLED: "true", SAAS_SIGNUP_CODE: "a".repeat(48),
  ADMIN_API_KEY: "b".repeat(64), WHATSAPP_VERIFY_TOKEN: "c".repeat(32)
});
const token = "x".repeat(43);
function session() {
  return {
    expiresAt: new Date(Date.now() + 90000), userId: "owner-A",
    user: { email: "owner@example.com", displayName: "Owner",
      memberships: [{ tenantId: "tenant-A", role: "OWNER",
        tenant: { name: "A" } }] }
  };
}
test("Smart Alerts workspace endpoints deny unauthenticated requests", async () => {
  const app = Fastify();
  registerAlertsRoutes(app, {} as PrismaClient, cfg);
  for (const url of ["/portal/api/features", "/portal/api/alerts/groups",
    "/portal/api/alerts/rules", "/portal/api/alerts/inbox"]) {
    assert.equal((await app.inject({ method: "GET", url })).statusCode, 401, url);
  }
  await app.close();
});
test("alerts cannot be self-activated without a separate subscription", async () => {
  const app = Fastify();
  let provisioned = false;
  const db = {
    portalSession: { findUnique: async () => session() },
    tenantSubscription: { findUnique: async () =>
      ({ status: "ACTIVE", periodEnd: null, planCode: "STARTER", translationEnabled: true }) },
    alertSubscription: {
      findUnique: async () => null,
      update: async () => { provisioned = true; }
    }
  } as unknown as PrismaClient;
  registerAlertsRoutes(app, db, cfg);
  const headers = { cookie: "wbot_portal_session=" + token, "x-wbot-request": "1" };
  const before = await app.inject({ method: "GET", url: "/portal/api/features",
    headers: { cookie: headers.cookie } });
  assert.equal(before.statusCode, 200);
  assert.equal(before.json().translation.active, true);
  assert.equal(before.json().alerts.subscribed, false);
  const result = await app.inject({
    method: "PATCH", url: "/portal/api/features/alerts",
    headers, payload: { enabled: true }
  });
  assert.equal(result.statusCode, 403);
  assert.equal(provisioned, false);
  await app.close();
});
