import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { loadConfig } from "../src/config.js";
import { ingestTenantMessage, monthKey, planActive } from "../src/quotas.js";

function cfg() {
  return loadConfig({
    DATABASE_URL: "mysql://u:p@localhost:3306/wbot",
    ADMIN_API_KEY: "a".repeat(64),
    WHATSAPP_VERIFY_TOKEN: "b".repeat(32),
    DRY_RUN: "true", SAAS_MONTHLY_MESSAGES: "2"
  });
}
test("UTC month keys roll over and inactive subscriptions are blocked", () => {
  assert.equal(monthKey(new Date("2026-10-31T23:59:59Z")), "2026-10");
  assert.equal(monthKey(new Date("2026-11-01T00:00:01Z")), "2026-11");
  assert.equal(planActive({ status: "CANCELED", periodEnd: null }), false);
  assert.equal(planActive({ status: "TRIAL", periodEnd: null }), true);
  assert.equal(planActive({ status: "ACTIVE", periodEnd: new Date("2000-01-01") }), false);
});

test("reservations reject repeated messages and enforce a tenant allowance", async () => {
  let used = 0;
  let created = 0;
  const seen = new Set<string>();
  const db = {
    $transaction: async (callback: (tx: unknown) => Promise<boolean>) => callback({
      tenantSubscription: {
        findUnique: async () => ({
          status: "ACTIVE", periodEnd: null, monthlyMessages: 2
        })
      },
      group: { findFirst: async () => ({ id: "group-A" }) },
      message: {
        create: async (args: { data: { externalMessageId: string } }) => {
          if (seen.has(args.data.externalMessageId)) throw new Prisma.PrismaClientKnownRequestError(
            "duplicate", { code: "P2002", clientVersion: "6.19.0" }
          );
          seen.add(args.data.externalMessageId);
          created++;
        }
      },
      $executeRaw: async () => 1,
      tenantUsage: {
        updateMany: async () => {
          if (used >= 2) return { count: 0 };
          used++; return { count: 1 };
        }
      }
    })
  };
  const make = (messageId: string) => ingestTenantMessage(db as never, cfg(), {
    tenantId: "tenant-A", groupId: "group-A", messageId,
    senderId: "sender-A", text: "Hello"
  });
  assert.equal(await make("1"), true);
  assert.equal(await make("1"), false);
  assert.equal(await make("2"), true);
  assert.equal(await make("3"), false);
  assert.equal(used, 2);
  assert.equal(created, 3); // fake lacks transaction rollback; real MySQL rolls back #3
});

test("quota reservations ignore foreign or disabled group ownership", async () => {
  let used = false;
  const db = {
    $transaction: async (callback: (tx: unknown) => Promise<boolean>) => callback({
      tenantSubscription: { findUnique: async () => null },
      group: { findFirst: async () => null },
      message: { create: async () => { used = true; } }
    })
  };
  assert.equal(await ingestTenantMessage(db as never, cfg(), {
    tenantId: "tenant-A", groupId: "foreign", messageId: "1",
    senderId: "sender", text: "Hello"
  }), false);
  assert.equal(used, false);
});
