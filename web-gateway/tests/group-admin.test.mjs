import test from "node:test";
import assert from "node:assert/strict";
import { isVerifiedGroupAdmin, senderJidCandidates, parseActivationCommand, classifyActivationText } from "../validation.mjs";

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

test("Baileys sender alternate PN can verify a group admin stored by phone number", () => {
  const key = {
    participant: "553399@lid",
    participantAlt: "94771234567@s.whatsapp.net"
  };
  const ids = senderJidCandidates({ key });
  assert.deepEqual(ids, ["553399@lid", "94771234567@s.whatsapp.net"]);
  assert.equal(isVerifiedGroupAdmin([
    { id: "94771234567@s.whatsapp.net", admin: "superadmin" }
  ], ids), true);
});

test("multi-device JIDs normalize only device suffixes, never different users", () => {
  assert.equal(isVerifiedGroupAdmin([{ id: "123@s.whatsapp.net", admin: "admin" }],
    ["123:4@s.whatsapp.net"]), true);
  assert.equal(isVerifiedGroupAdmin([{ id: "123@lid", admin: "admin" }],
    ["123@s.whatsapp.net"]), false);
  assert.equal(isVerifiedGroupAdmin([{ id: "123@lid", admin: null }],
    ["123@lid"]), false);
});

test("admin status also recognizes older Baileys admin flags", () => {
  assert.equal(isVerifiedGroupAdmin([{ id: "123@lid", isAdmin: true }],
    ["123@lid"]), true);
  assert.equal(isVerifiedGroupAdmin([{ id: "123@lid", isSuperAdmin: true }],
    ["123@lid"]), true);
  assert.equal(isVerifiedGroupAdmin([{ id: "123@lid", isAdmin: false }],
    ["123@lid"]), false);
});

test("activation command parser accepts valid codes and rejects malformed commands", () => {
  assert.equal(parseActivationCommand(" /wbot connect ABCdef1234567890 "), "ABCDEF1234567890");
  assert.equal(parseActivationCommand("/wbot connect 12345678"), null);
  assert.equal(parseActivationCommand("/wbot connect 1234567890ABCDEF more"), null);
  assert.equal(parseActivationCommand("/wbot connect 1234567890ABCDEF"), "1234567890ABCDEF");
  assert.equal(parseActivationCommand(null), null);
  assert.equal(parseActivationCommand(" ABCDEF1234567890 "), "ABCDEF1234567890");
  assert.equal(parseActivationCommand("abcdefghijklmno0"), null);
  assert.equal(parseActivationCommand("CODE ABCDEF1234567890"), null);
  assert.equal(parseActivationCommand("wbot connect ABCDEF1234567890"), null);
  assert.equal(classifyActivationText("/wbot connect ABCDEF1234567890"), "command");
  assert.equal(classifyActivationText("ABCDEF1234567890"), "code_only");
  assert.equal(classifyActivationText("/wbot connect invalid"), "invalid_command");
  assert.equal(classifyActivationText("Hello everyone"), "other");
});
