import test from "node:test";
import assert from "node:assert/strict";
import { parseActivationCommand, isGroupJid, isVerifiedGroupAdmin } from "../validation.mjs";
test("admin activation still requires a valid 16-digit code", () => {
  assert.equal(parseActivationCommand("/wbot connect ABCD1234ABCD1234"),"ABCD1234ABCD1234");
  assert.equal(parseActivationCommand("/wbot connect wrong"),null);
  assert.equal(isGroupJid("12345678901@g.us"),true);
});

test("direct group selection requires the linked account to be a verified admin", () => {
  const group = [
    { id: "94770000001@s.whatsapp.net", admin: "admin" },
    { id: "94770000002@s.whatsapp.net", admin: null }
  ];
  assert.equal(isVerifiedGroupAdmin(group, ["94770000001@s.whatsapp.net"]), true);
  assert.equal(isVerifiedGroupAdmin(group, ["94770000002@s.whatsapp.net"]), false);
  assert.equal(isVerifiedGroupAdmin(group, ["94770000003@s.whatsapp.net"]), false);
  assert.equal(isVerifiedGroupAdmin([], ["94770000001@s.whatsapp.net"]), false);
});
