import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { formatAlertNotification, processAlertDeliveries } from "../src/alerts-delivery.js";

const config = loadConfig({
  DATABASE_URL: "mysql://user:pass@localhost:3306/wbot",
  ADMIN_API_KEY: "a".repeat(64), WHATSAPP_VERIFY_TOKEN: "b".repeat(32),
  BYON_GATEWAY_ENABLED: "true", BYON_GATEWAY_TOKEN: "c".repeat(64),
  DRY_RUN: "false"
});
const delivery = {
  id: "delivery-1", tenantId: "tenant-a", connectionId: "c" + "a".repeat(24),
  groupId: "999888777@g.us", status: "PENDING",
  match: {
    summary: "Looking for a van in Galle", contactNumber: "0771234567",
    createdAt: new Date("2026-11-01T04:00:00Z"),
    rule: { name: "Trips from Galle" },
    event: { group: { name: "Tour opportunities" } }
  }
};
function makeDb(overrides?:{channelEnabled?:boolean;subEnabled?:boolean;sourceExists?:boolean}) {
  const updates: Array<{data:Record<string,unknown>}> = [];
  const mock = {
    alertDelivery: {
      updateMany: async () => ({count:1}),
      findMany: async () => [delivery],
      update: async (req:{data:Record<string,unknown>}) => {
        updates.push(req);return {};
      }
    },
    alertSubscription: {findUnique:async()=>({
      enabled:overrides?.subEnabled??true,status:"ACTIVE",periodEnd:null
    })},
    alertNotificationChannel: {findUnique:async()=>({
      enabled:overrides?.channelEnabled??true,
      connectionId:delivery.connectionId,groupId:delivery.groupId
    })},
    customerWhatsAppConnection: {findFirst:async()=>({
      id:delivery.connectionId,kind:"PERSONAL",status:"CONNECTED",active:true
    })},
    whatsAppConnectionPolicy: {findUnique:async()=>({
      customerNumbersEnabled:true,personalEnabled:true,businessEnabled:true
    })},
    watchGroup: {findFirst:async()=>overrides?.sourceExists?{id:"source"}:null},
    group: {findFirst:async()=>null},
    message: {create:async()=>{throw Error("Translation pipeline must not be accessed");}}
  };
  return {mock,updates};
}
test("notification contains source-grounded context without exposing message IDs", () => {
  const text = formatAlertNotification({
    ruleName:delivery.match.rule.name, groupName:delivery.match.event.group.name,
    summary:delivery.match.summary, contactNumber:delivery.match.contactNumber,
    createdAt:delivery.match.createdAt
  });
  assert.match(text,/W-Bot Smart Alert/);
  assert.match(text,/Trips from Galle/);
  assert.match(text,/0771234567/);
  assert.ok(text.length<1600);
});
test("outbound alert shows sender and contact as separate verified facts", () => {
  const text = formatAlertNotification({
    ruleName: "Tours to Galle", groupName: "Test group",
    summary: "Tour requested. Contact in message: 0771234567",
    senderPhone: "+94771112233", contactNumber: "0771234567",
    createdAt: new Date("2026-11-01T08:21:38Z")
  });
  assert.match(text, /Message sender \(WhatsApp\): \+94771112233/);
  assert.match(text, /Contact shared in the source: 0771234567/);
  assert.ok(text.indexOf("Message sender") < text.indexOf("Contact shared"));
});
test("unverified or LID-only identity is never printed as a phone", () => {
  const text = formatAlertNotification({
    ruleName: "Search", groupName: "Test group", summary: "Matching message",
    senderPhone: "123456789@lid", contactNumber: null,
    createdAt: new Date("2026-11-01T08:21:38Z")
  });
  assert.match(text, /Message sender \(WhatsApp\): Number unavailable/);
  assert.doesNotMatch(text, /123456789@lid/);
});
test("a configured destination sends one alert and never calls translation", async () => {
  const {mock,updates}=makeDb();let calls=0;
  const sender = async (_cfg:unknown,path:string,method:string,data?:unknown)=>{
    calls++;assert.ok(path.endsWith("/notify"));assert.equal(method,"POST");
    assert.equal((data as {groupId:string}).groupId,delivery.groupId);
    return new Response(JSON.stringify({messageId:"wa-message-1"}),{status:200});
  };
  const count=await processAlertDeliveries(mock as never,config,sender as never);
  assert.equal(count,1);assert.equal(calls,1);
  assert.equal(updates.at(-1)?.data.status,"SENT");
  assert.equal(updates.at(-1)?.data.outboundId,"wa-message-1");
});
test("a paused subscription cannot send notifications", async () => {
  const {mock,updates}=makeDb({subEnabled:false});let calls=0;
  await processAlertDeliveries(mock as never,config,async()=>{
    calls++;throw Error("Should not send");
  });
  assert.equal(calls,0);assert.equal(updates.at(-1)?.data.status,"CANCELED");
});
test("a selected monitoring source cannot be used as the alert destination", async () => {
  const {mock,updates}=makeDb({sourceExists:true});let calls=0;
  await processAlertDeliveries(mock as never,config,async()=>{calls++;throw Error("should not send");});
  assert.equal(calls,0);assert.equal(updates.at(-1)?.data.status,"CANCELED");
});
test("unknown gateway outcome never auto-retries to avoid duplicate notifications", async () => {
  const {mock,updates}=makeDb();
  await processAlertDeliveries(mock as never,config,async()=>{throw Error("timeout after send");});
  assert.equal(updates.at(-1)?.data.status,"UNCERTAIN");
});
test("disabled dry run does not send messages", async () => {
  const {mock}=makeDb();let calls=0;
  const dry=loadConfig({
    DATABASE_URL:"mysql://user:pass@localhost:3306/wbot",
    ADMIN_API_KEY:"a".repeat(64),WHATSAPP_VERIFY_TOKEN:"b".repeat(32),
    BYON_GATEWAY_ENABLED:"true",BYON_GATEWAY_TOKEN:"c".repeat(64)
  });
  assert.equal(await processAlertDeliveries(mock as never,dry,async()=>{calls++;throw Error("no");}),0);
  assert.equal(calls,0);
});
