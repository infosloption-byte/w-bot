import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { extractGroupMessages, verifySignature } from "../src/whatsapp.js";

const secret = "testing-secret";
test("HMAC raw-body signature verified; altered body rejected", () => {
  const body = Buffer.from('{"hello":"world"}');
  const header = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifySignature(body, header, secret), true);
  assert.equal(verifySignature(Buffer.from('{"hello":"tampered"}'), header, secret), false);
  assert.equal(verifySignature(body, "sha256=bad", secret), false);
});
test("only official group messages, never direct messages or statuses", () => {
  const groupMsg = { id: "mid1", group_id: "group1", from: "member1", type: "text", text: { body: "Hello" } };
  const directMsg = { id: "mid2", from: "member2", type: "text", text: { body: "Private" } };
  const payload = { object: "whatsapp_business_account", entry: [{ changes: [{
    field: "messages", value: { messages: [groupMsg,directMsg], statuses: [{ id: "status1" }] }
  }] }] };
  assert.deepEqual(extractGroupMessages(payload), [{ groupId: "group1", messageId: "mid1", senderId: "member1", text: "Hello" }]);
  assert.deepEqual(extractGroupMessages({ object: "unknown" }), []);
});
