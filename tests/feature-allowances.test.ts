import test from "node:test";
import assert from "node:assert/strict";
import { sharedConnectionAllowance } from "../src/feature-allowances.js";

const translation = (status: string, planCode = "STARTER") =>
  ({ planCode, status, periodEnd: null, groupLimit: 10,
    whatsappConnectionLimit: planCode === "PILOT" ? 0 : 1 });
const alerts = (status: string, maxConnections = 2) =>
  ({ status, periodEnd: null, maxConnections });

test("alert-only customer may link an account when translation is canceled", () => {
  assert.deepEqual(sharedConnectionAllowance(translation("CANCELED"), alerts("ACTIVE")),
    { eligible: true, limit: 2 });
});
test("the maximum active allowance applies to centralized accounts, not the sum", () => {
  assert.deepEqual(sharedConnectionAllowance(translation("ACTIVE"), alerts("ACTIVE")),
    { eligible: true, limit: 2 });
  assert.deepEqual(sharedConnectionAllowance(translation("ACTIVE", "BUSINESS"), alerts("ACTIVE")),
    { eligible: true, limit: 5 });
});
test("when neither feature is active, new connections cannot be registered", () => {
  assert.deepEqual(sharedConnectionAllowance(translation("CANCELED"), alerts("CANCELED")),
    { eligible: false, limit: 0 });
});
test("legacy pilot connections remain available", () => {
  assert.deepEqual(sharedConnectionAllowance(translation("TRIAL", "PILOT"), null),
    { eligible: true, limit: 0 });
});
