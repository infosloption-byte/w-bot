import test from "node:test";
import assert from "node:assert/strict";
import { parseActivationCommand, isGroupJid } from "../validation.mjs";
test("admin activation still requires a valid 16-digit code", () => {
  assert.equal(parseActivationCommand("/wbot connect ABCD1234ABCD1234"),"ABCD1234ABCD1234");
  assert.equal(parseActivationCommand("/wbot connect wrong"),null);
  assert.equal(isGroupJid("12345678901@g.us"),true);
});
