import test from "node:test";
import assert from "node:assert/strict";
import { extractByonLiveMessage, isBotText } from "../message-routing.mjs";

const own = "94771234567@s.whatsapp.net";
const make = (text, fromMe=true, id="ABC123") => ({
  key: { remoteJid:"12345678901@g.us", id, fromMe },
  message: { conversation:text }
});
test("translates live human messages from connected owner's phone",()=>{
  const msg=extractByonLiveMessage(make("How are you?"),"notify",own);
  assert.deepEqual(msg,{groupId:"12345678901@g.us",messageId:"ABC123",
    senderId:own,text:"How are you?"});
});
test("owner messages with valid participant JID preserve sender for reply quoting",()=>{
  const source=make("Hello from admin");
  source.key.participant="12345678901@lid";
  const msg=extractByonLiveMessage(source,"notify",own);
  assert.equal(msg.senderId,"12345678901@lid");
});
test("other group members still use legacy text extraction",()=>{
  const other=make("Hello all",false);
  other.key.participant="1234567000@s.whatsapp.net";
  assert.equal(extractByonLiveMessage(other,"notify",own).text,"Hello all");
});
test("never translate bot output or previously sent outbound IDs",()=>{
  for(const text of ["🌐 Hebrew\nשלום","✅ W-Bot translation activated for this group.",
    "⚠️ Activation could not be completed."]) {
    assert.equal(extractByonLiveMessage(make(text),"notify",own),null);
    assert.equal(isBotText(text),true);
  }
  assert.equal(extractByonLiveMessage(make("My message"),"notify",own,new Set(["ABC123"])),null);
});
test("reject history, personal chats, invalid sender identity and unsupported media",()=>{
  assert.equal(extractByonLiveMessage(make("Old message"),"append",own),null);
  const dm=make("Private"); dm.key.remoteJid=own;
  assert.equal(extractByonLiveMessage(dm,"notify",own),null);
  assert.equal(extractByonLiveMessage(make("No owner"),"notify","invalid"),null);
  const audio=make("Whatever"); audio.message={ audioMessage:{ptt:true} };
  assert.equal(extractByonLiveMessage(audio,"notify",own),null);
});
test("reject oversize or missing owner human messages",()=>{
  assert.equal(extractByonLiveMessage(make("x".repeat(1001)),"notify",own),null);
  assert.equal(extractByonLiveMessage(make("  "),"notify",own),null);
});

test("fresh append from linked phone is translatable without reprocessing history",()=>{
  const live=make("Phone-side outgoing text",true,"OWN-APPEND-1");
  live.messageTimestamp=Math.floor(Date.now()/1000);
  assert.equal(extractByonLiveMessage(live,"append",own)?.text,"Phone-side outgoing text");
  const stale=make("Old history",true,"OLD-APPEND");
  stale.messageTimestamp=Math.floor(Date.now()/1000)-180;
  assert.equal(extractByonLiveMessage(stale,"append",own),null);
  assert.equal(extractByonLiveMessage(make("No timestamp",true),"append",own),null);
  const other=make("Old incoming",false);
  other.messageTimestamp=Math.floor(Date.now()/1000);
  assert.equal(extractByonLiveMessage(other,"append",own),null);
});
