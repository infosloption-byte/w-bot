import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { ingestWatchedMessage, processPendingAlerts } from "../src/alerts-service.js";

const cfg = loadConfig({
  DATABASE_URL: "mysql://u:p@localhost:3306/wbot",
  ADMIN_API_KEY: "a".repeat(64),
  WHATSAPP_VERIFY_TOKEN: "b".repeat(32),
  BYON_GATEWAY_ENABLED: "true",
  BYON_GATEWAY_TOKEN: "c".repeat(64)
});
const details = { connectionId: "c" + "a".repeat(24), groupId: "123456789@g.us",
  messageId: "abc", text: "Van from Kandy to Ella" };

test("watched messages use WatchEvent and cannot enter translation queue", async () => {
  let captured: unknown = null;
  const db = {
    watchGroup: { findFirst: async () => ({
      id: "watch-group", tenantId: "tenant-A", connection: { kind: "PERSONAL" }
    }) },
    whatsAppConnectionPolicy: { findUnique: async () => ({
      customerNumbersEnabled: true, personalEnabled: true, businessEnabled: true
    }) },
    alertSubscription: { findUnique: async () => ({
      enabled: true, status: "ACTIVE", periodEnd: null
    }) },
    watchEvent: { createMany: async (args: unknown) => {
      captured = args; return { count: 1 };
    } },
    message: { create: async () => { throw Error("MUST NOT TRANSLATE"); } }
  };
  assert.equal(await ingestWatchedMessage(db as never, cfg, details), true);
  assert.deepEqual((captured as { data: Array<{ tenantId: string }> }).data[0]?.tenantId, "tenant-A");
});

test("alerts are denied when their separate subscription is not active", async () => {
  let stored = false;
  const db = {
    watchGroup: { findFirst: async () => ({
      id: "watch-group", tenantId: "tenant-A", connection: { kind: "PERSONAL" }
    }) },
    whatsAppConnectionPolicy: { findUnique: async () => ({
      customerNumbersEnabled: true, personalEnabled: true, businessEnabled: true
    }) },
    alertSubscription: { findUnique: async () => null },
    watchEvent: { createMany: async () => { stored = true; } }
  };
  assert.equal(await ingestWatchedMessage(db as never, cfg, details), false);
  assert.equal(stored, false);
});

test("processing disabled alerts erases text and never invokes the translator", async () => {
  const updates: Array<{ data: Record<string, unknown> }> = [];
  const event = {
    id: "event-A", tenantId: "tenant-A", watchGroupId: "group-A",
    status: "PENDING", attempts: 0, content: "private message",
    group: { enabled: true, tenantId: "tenant-A" }
  };
  const db = {
    watchEvent: {
      updateMany: async () => ({ count: 1 }),
      findMany: async () => [event],
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args); return args;
      }
    },
    alertSubscription: { findUnique: async () => ({ status: "ACTIVE", enabled: false, periodEnd: null }) },
    watchRule: { findMany: async () => { throw Error("Rules should not be evaluated"); } },
    message: { findMany: async () => { throw Error("Translation queue should never be queried"); } }
  };
  assert.equal(await processPendingAlerts(db as never), 1);
  assert.equal(updates.at(-1)?.data.content, null);
  assert.equal(updates.at(-1)?.data.status, "COMPLETED");
});
