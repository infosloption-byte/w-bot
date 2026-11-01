import test from "node:test";
import assert from "node:assert/strict";
import { isGroupJid, extractLiveMessage, isPairingPhoneNumber, buildQuotedMessage, diagnoseIncomingGroupMessage } from "../validation.mjs";

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

test("quoted replies use the original message key and support WhatsApp LID participants", () => {
  assert.deepEqual(buildQuotedMessage("120363412606399130@g.us", {
    messageId: "3EB0F75D24828D089F1AF2",
    senderId: "99106504601758@lid",
    text: "Hello everyone, this is a translation test."
  }), {
    key: {
      id: "3EB0F75D24828D089F1AF2",
      remoteJid: "120363412606399130@g.us",
      participant: "99106504601758@lid",
      fromMe: false
    },
    message: { conversation: "Hello everyone, this is a translation test." }
  });
  assert.equal(buildQuotedMessage("120363412606399130@g.us", {
    messageId: "abc", senderId: "not-a-jid", text: "Hello"
  }), null);
  assert.equal(buildQuotedMessage("120363412606399130@g.us", {
    messageId: "abc", senderId: "94771234567@s.whatsapp.net", text: "Hello"
  })?.key.participant, "94771234567@s.whatsapp.net");
});

test("group diagnostics expose only safe filter reasons, not the WhatsApp message", () => {
  assert.equal(diagnoseIncomingGroupMessage(live, "notify"), "accepted");
  assert.equal(diagnoseIncomingGroupMessage(live, "append"), "not_live_notify");
  assert.equal(diagnoseIncomingGroupMessage({ ...live, key: { ...live.key, fromMe: true } }, "notify"), "from_bot_account");
  assert.equal(diagnoseIncomingGroupMessage({ ...live, key: { ...live.key, participant: undefined } }, "notify"), "missing_sender_id");
  assert.equal(diagnoseIncomingGroupMessage({ ...live, message: { imageMessage: {} } }, "notify"), "non_text_or_unsupported_wrapper");
  assert.equal(diagnoseIncomingGroupMessage({ ...live, key: { ...live.key, remoteJid: "123@s.whatsapp.net" } }, "notify"), "not_group");
  const reason = diagnoseIncomingGroupMessage({ ...live, message: { conversation: "/wbot connect SECRET" } }, "notify");
  assert.equal(reason, "accepted");
  assert.ok(!reason.includes("SECRET"));
});
