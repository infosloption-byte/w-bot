import test from "node:test";
import assert from "node:assert/strict";
import { runRetention } from "../src/retention.js";
import { loadConfig } from "../src/config.js";

test("retention purges completed message history in bounded batches", async () => {
  let messageWhere: unknown;
  let deleted: unknown;
  const db = {
    message: {
      findMany: async (args: { where: unknown; take: number }) => {
        assert.equal(args.take, 250);
        messageWhere = args.where;
        return [{ id: "m1" }, { id: "m2" }];
      },
      deleteMany: async (args: unknown) => { deleted = args; return { count: 2 }; }
    },
    accountToken: { deleteMany: async () => ({ count: 0 }) },
    portalSession: { deleteMany: async () => ({ count: 0 }) },
    platformSession: { deleteMany: async () => ({ count: 0 }) },
    groupActivation: { deleteMany: async () => ({ count: 0 }) },
    tenantAudit: { deleteMany: async () => ({ count: 0 }) }
  };
  const cfg = loadConfig({
    DATABASE_URL: "mysql://u:p@localhost:3306/wbot",
    ADMIN_API_KEY: "a".repeat(64),
    WHATSAPP_VERIFY_TOKEN: "b".repeat(32),
    MESSAGE_RETENTION_DAYS: "30"
  });
  assert.equal(await runRetention(db as never, cfg), 2);
  assert.deepEqual(deleted, { where: { id: { in: ["m1","m2"] } } });
  assert.ok(messageWhere);
});
