import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

test("new hardening schema and migration preserve tenant ownership and source text retention", () => {
  const schema = readFileSync(fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url)), "utf8");
  const sql = readFileSync(fileURLToPath(new URL(
    "../prisma/migrations/20261030000100_model_b_hardening/migration.sql",
    import.meta.url)), "utf8");
  for (const model of ["TenantUsage", "TenantSubscription", "AccountToken", "TenantAudit", "GatewayHealth"]) {
    assert.ok(schema.includes("model " + model + " {"));
    assert.ok(sql.includes("CREATE TABLE \`" + model + "\`"));
  }
  assert.ok(schema.includes("sendStartedAt"));
  assert.ok(schema.includes("DELIVERY_UNCERTAIN"));
  assert.ok(sql.includes("WHERE g.tenantId IS NOT NULL"));
});
