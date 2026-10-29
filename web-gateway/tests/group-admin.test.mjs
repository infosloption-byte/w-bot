import test from "node:test";
import assert from "node:assert/strict";
import { isVerifiedGroupAdmin } from "../validation.mjs";

test("only a current WhatsApp admin can activate a group", () => {
  const participants = [
    { id: "123@s.whatsapp.net", lid: "234@lid", admin: "admin" },
    { id: "345@s.whatsapp.net", lid: "456@lid", admin: "superadmin" },
    { id: "789@s.whatsapp.net", lid: "890@lid", admin: null }
  ];
  assert.equal(isVerifiedGroupAdmin(participants, "123@s.whatsapp.net"), true);
  assert.equal(isVerifiedGroupAdmin(participants, "234@lid"), true);
  assert.equal(isVerifiedGroupAdmin(participants, "456@lid"), true);
  assert.equal(isVerifiedGroupAdmin(participants, "890@lid"), false);
  assert.equal(isVerifiedGroupAdmin(participants, "999@lid"), false);
  assert.equal(isVerifiedGroupAdmin([], "123@s.whatsapp.net"), false);
  assert.equal(isVerifiedGroupAdmin(null, "123@s.whatsapp.net"), false);
});
