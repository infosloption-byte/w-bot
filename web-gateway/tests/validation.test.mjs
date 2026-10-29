import test from "node:test";
import assert from "node:assert/strict";
import { isGroupJid, extractLiveMessage, isPairingPhoneNumber } from "../validation.mjs";

test("group IDs are accepted, direct chats and URLs rejected", () => {
  assert.equal(isGroupJid("120363123456789012@g.us"), true);
  assert.equal(isGroupJid("12345678-987654@g.us"), true);
  assert.equal(isGroupJid("123@s.whatsapp.net"), false);
  assert.equal(isGroupJid("http://evil.test"), false);
});

const live = {
  key: { remoteJid: "120363123456789012@g.us", participant: "123@s.whatsapp.net", id: "ABC", fromMe: false },
  message: { conversation: "Hello everyone" }
};
test("receives only new group messages with text", () => {
  assert.deepEqual(extractLiveMessage(live, "notify"), {
    groupId: "120363123456789012@g.us", messageId: "ABC",
    senderId: "123@s.whatsapp.net", text: "Hello everyone"
  });
  assert.equal(extractLiveMessage(live, "append"), null);
  assert.equal(extractLiveMessage({ ...live, key: { ...live.key, fromMe: true } }, "notify"), null);
  assert.equal(extractLiveMessage({ ...live, key: { ...live.key, remoteJid: "123@s.whatsapp.net" } }, "notify"), null);
  assert.equal(extractLiveMessage({ ...live, message: { conversation: "🌐 English\nHello" } }, "notify"), null);
});

test("handles extended text and ignores non-text", () => {
  assert.equal(extractLiveMessage({
    ...live, message: { extendedTextMessage: { text: "Hi" } }
  }, "notify")?.text, "Hi");
  assert.equal(extractLiveMessage({ ...live, message: { imageMessage: {} } }, "notify"), null);
});

test("pairing numbers use country code and digits only", () => {
  assert.equal(isPairingPhoneNumber("94771234567"), true);
  assert.equal(isPairingPhoneNumber("447911123456"), true);
  assert.equal(isPairingPhoneNumber("+94771234567"), false);
  assert.equal(isPairingPhoneNumber("0771234567 "), false);
  assert.equal(isPairingPhoneNumber("1234"), false);
  assert.equal(isPairingPhoneNumber("0000000000"), false);
});
