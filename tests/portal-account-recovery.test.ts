import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { registerAccountRoutes } from "../src/portal-accounts.js";
import { loadConfig } from "../src/config.js";
import { digest } from "../src/portal-auth.js";

const config = loadConfig({
  DATABASE_URL: "mysql://u:p@localhost:3306/wbot",
  ADMIN_API_KEY: "a".repeat(64),
  WHATSAPP_VERIFY_TOKEN: "b".repeat(32)
});

test("password recovery does not reveal if a customer email exists", async () => {
  const prisma = {
    portalUser: { findUnique: async () => null }
  } as unknown as PrismaClient;
  const app = Fastify();
  registerAccountRoutes(app, prisma, config);
  const response = await app.inject({
    method: "POST", url: "/portal/api/auth/forgot-password",
    headers: { "x-wbot-request": "1", origin: "http://localhost:9048", host: "localhost:9048" },
    payload: { email: "unknown@example.com" }
  });
  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.json(), { accepted: true });
  await app.close();
});

test("expired or malformed reset tokens do not modify a password", async () => {
  const prisma = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      accountToken: { findUnique: async (args: { where: { tokenHash: string } }) => {
        assert.equal(args.where.tokenHash, digest("a".repeat(64)));
        return { id: "token", kind: "RESET_PASSWORD", usedAt: null,
          expiresAt: new Date("2000-01-01") };
      }}
    })
  } as unknown as PrismaClient;
  const app = Fastify();
  registerAccountRoutes(app, prisma, config);
  const response = await app.inject({
    method: "POST", url: "/portal/api/auth/reset-password",
    headers: { "x-wbot-request": "1" },
    payload: { token: "a".repeat(64), password: "a-long-password-1234" }
  });
  assert.equal(response.statusCode, 400);
  await app.close();
});

test("CSRF origin mismatch is rejected even when a custom header is present", async () => {
  const app = Fastify();
  registerAccountRoutes(app, {} as PrismaClient, config);
  const response = await app.inject({
    method: "POST", url: "/portal/api/auth/forgot-password",
    headers: {
      "x-wbot-request": "1",
      origin: "https://evil.example",
      host: "localhost:9048"
    },
    payload: { email: "a@example.com" }
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});
