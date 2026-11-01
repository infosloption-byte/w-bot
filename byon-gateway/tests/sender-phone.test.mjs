import test from "node:test";
import assert from "node:assert/strict";
import {phoneFromJid,resolveSenderPhone} from "../sender-phone.mjs";
const message = (key) => ({key:{remoteJid:"12345678901@g.us",id:"msg-1",...key}});
test("uses original message participant PN rather than embedded booking contact", async () => {
  const result=await resolveSenderPhone(message({fromMe:false,
    participant:"94771234567@s.whatsapp.net"}),"94779999999@s.whatsapp.net");
  assert.equal(result,"+94771234567");
});
test("owner fromMe uses actual linked account phone, not participant LID", async () => {
  const result=await resolveSenderPhone(message({fromMe:true,
    participant:"123456789@lid"}),"94779999999:1@s.whatsapp.net");
  assert.equal(result,"+94779999999");
});
test("participantAlt identifies PN when participant is LID", async () => {
  const result=await resolveSenderPhone(message({fromMe:false,
    participant:"123456789@lid",participantAlt:"94771111111@s.whatsapp.net"}));
  assert.equal(result,"+94771111111");
});
test("LID maps to a phone only when group metadata verifies the sender", async () => {
  const result=await resolveSenderPhone(message({fromMe:false,participant:"123456789@lid"}),
    null,async()=>({participants:[{id:"123456789@lid",phoneNumber:"94770000000@s.whatsapp.net"},
      {id:"999999999@lid",phoneNumber:"94775555555@s.whatsapp.net"}]}));
  assert.equal(result,"+94770000000");
});
test("verified metadata accepts explicit numeric phoneNumber for the matching LID", async () => {
  const result=await resolveSenderPhone(message({fromMe:false,participant:"123456789@lid"}),
    null,async()=>({participants:[{id:"123456789@lid",phoneNumber:"94770000000"}]}));
  assert.equal(result,"+94770000000");
});
test("LID-only or ambiguous metadata remains unavailable, never masquerades as a phone", async () => {
  const m=message({fromMe:false,participant:"123456789@lid"});
  assert.equal(await resolveSenderPhone(m,null),null);
  assert.equal(await resolveSenderPhone(m,null,async()=>({participants:[{id:"123456789@lid"}]})),null);
  assert.equal(await resolveSenderPhone(m,null,async()=>({participants:[
    {id:"123456789@lid",phoneNumber:"94770000000@s.whatsapp.net"},
    {lid:"123456789@lid",phoneNumber:"94771111111@s.whatsapp.net"}]})),null);
});
test("never treats a LID, group JID, or local string as a real phone", () => {
  for(const value of ["123456789@lid","123456789@g.us","0771234567",
    "1234@s.whatsapp.net","not-a-number"])
    assert.equal(phoneFromJid(value),null);
  assert.equal(phoneFromJid("94771234567:12@s.whatsapp.net"),"+94771234567");
});
