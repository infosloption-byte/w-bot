import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { PAID_PLANS, paidPlanFor } from "../src/plan-catalog.js";
import { loadConfig } from "../src/config.js";
import { registerPlatformRoutes } from "../src/platform.js";

const cfg = loadConfig({
  DATABASE_URL: "mysql://user:pass@localhost:3306/wbot",
  SAAS_ENABLED: "true",
  SAAS_SIGNUP_CODE: "a".repeat(48),
  ADMIN_API_KEY: "b".repeat(64),
  WHATSAPP_VERIFY_TOKEN: "c".repeat(32),
  SAAS_COOKIE_SECURE: "false"
});

test("published USD subscriptions have ten paid months per annual term", () => {
  assert.deepEqual(PAID_PLANS.map(p => [
    p.code, p.monthlyUsd, p.yearlyUsd, p.whatsappConnectionLimit, p.groupLimit
  ]), [
    ["STARTER", 69, 690, 1, 10],
    ["TEAM", 179, 1790, 2, 30],
    ["BUSINESS", 329, 3290, 5, 50]
  ]);
  assert.ok(PAID_PLANS.every(p => p.monthlyMessages === 0 && p.unlimitedTextTranslations));
  assert.ok(PAID_PLANS.every(p => p.yearlyUsd === p.monthlyUsd * 10));
  assert.equal(paidPlanFor("PILOT"), undefined);
});

test("published tier assignment cannot override its canonical limits", async () => {
  const token = "x".repeat(43);
  let captured: Record<string, unknown> | null = null;
  const prisma = {
    platformSession: { findUnique: async () => ({
      expiresAt: new Date(Date.now() + 100000),
      admin: { id: "admin-1", role: "SUPER_ADMIN", active: true }
    }) },
    tenant: { findUnique: async () => ({ id: "tenant-1" }) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      tenantSubscription: { upsert: async (args: {
        create: Record<string, unknown>; update: Record<string, unknown>
      }) => {
        captured = args.create;
        assert.equal(args.create.groupLimit, args.update.groupLimit);
        return args.create;
      } },
      platformAudit: { create: async () => ({}) }
    })
  } as unknown as PrismaClient;
  const app = Fastify();
  registerPlatformRoutes(app, prisma, cfg);
  const response = await app.inject({
    method: "PATCH", url: "/portal/api/platform/tenants/tenant-1/subscription",
    headers: { cookie: "wbot_platform_session=" + token, "x-wbot-request": "1" },
    payload: {
      planCode: "TEAM", status: "ACTIVE",
      groupLimit: 1000, monthlyMessages: 999999, whatsappConnectionLimit: 500,
      periodEnd: null
    }
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(captured?.["groupLimit"], 30);
  assert.equal(captured?.["monthlyMessages"], 0);
  assert.equal(captured?.["whatsappConnectionLimit"], 2);
  await app.close();
});

test("pricing catalog is visible only to signed-in platform admins", async () => {
  const app = Fastify();
  registerPlatformRoutes(app, {
    platformSession: { findUnique: async () => ({
      expiresAt: new Date(Date.now() + 100000),
      admin: { id: "admin-1", active: true, role: "VIEWER" }
    }) }
  } as unknown as PrismaClient, cfg);
  assert.equal((await app.inject({ method: "GET", url: "/portal/api/platform/plans" })).statusCode, 401);
  const response = await app.inject({
    method: "GET", url: "/portal/api/platform/plans",
    headers: { cookie: "wbot_platform_session=" + "x".repeat(43) }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().billingEnabled, false);
  assert.equal(response.json().plans.length, 3);
  await app.close();
});
