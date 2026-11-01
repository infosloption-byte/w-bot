import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { loadConfig } from "../src/config.js";
import { ingestTenantMessage, monthKey, planActive, getTenantLimits } from "../src/quotas.js";
import { W_BOT_PLANS, getCatalog, getCommercialPlan, commercialLimits } from "../src/plans.js";

const config = loadConfig({
  DATABASE_URL: "mysql://u:p@localhost:3306/wbot",
  ADMIN_API_KEY: "a".repeat(64), WHATSAPP_VERIFY_TOKEN: "b".repeat(32),
  DRY_RUN: "true", SAAS_MONTHLY_MESSAGES: "10"
});

test("prices and limits are canonical, annual bills two months less", () => {
  assert.deepEqual(W_BOT_PLANS.map(p => [p.monthlyCents,p.yearlyCents,
    p.whatsappConnections,p.groups]), [
    [6900,69000,1,10],[17900,179000,2,30],[32900,329000,5,50]
  ]);
  for (const plan of W_BOT_PLANS) {
    assert.equal(plan.yearlyCents, plan.monthlyCents * 10);
    assert.deepEqual(commercialLimits(plan.code, {
      groupLimit: 999, whatsappConnectionLimit: 999
    }), {groups:plan.groups,whatsappConnections:plan.whatsappConnections});
  }
  assert.equal(getCommercialPlan("FAKE"),null);
  assert.equal(getCatalog().billingEnabled,false);
  assert.equal(getCatalog().unlimitedTextTranslations,true);
});
test("PILOT allocations remain untouched", () => {
  assert.deepEqual(commercialLimits("PILOT", {
    groupLimit: 3, whatsappConnectionLimit: 0
  }), {groups:3,whatsappConnections:0});
});
test("month keys and subscription status protection remain", () => {
  assert.equal(monthKey(new Date("2026-10-31T23:59:59Z")),"2026-10");
  assert.equal(monthKey(new Date("2026-11-01T00:00:01Z")),"2026-11");
  assert.equal(planActive({status:"CANCELED",periodEnd:null}),false);
  assert.equal(planActive({status:"TRIAL",periodEnd:null}),true);
  assert.equal(planActive({status:"ACTIVE",periodEnd:new Date("2000-01-01")}),false);
});
test("read-only effective commercial limits ignore old database overrides", async () => {
  const db={tenantSubscription:{findUnique:async()=>({
    planCode:"BUSINESS",groupLimit:1,whatsappConnectionLimit:0,
    status:"ACTIVE",monthlyMessages:1,billingInterval:"YEARLY",periodEnd:null
  })}};
  const limit=await getTenantLimits(db as never,config,"tenant-a");
  assert.equal(limit.groups,50);
  assert.equal(limit.whatsappConnections,5);
  assert.equal(limit.billingInterval,"YEARLY");
  assert.equal(limit.unlimitedTextTranslations,true);
});
test("unlimited messages still deduplicate and meter monthly usage", async () => {
  const seen=new Set<string>();let stored=0,used=0;
  const db={$transaction:async(cb:(tx:unknown)=>Promise<boolean>)=>cb({
    tenantSubscription:{findUnique:async()=>({
      status:"ACTIVE",periodEnd:null,monthlyMessages:1
    })},
    group:{findFirst:async()=>({id:"group-a"})},
    message:{create:async({data}:{data:{externalMessageId:string}})=>{
      if(seen.has(data.externalMessageId)) throw new Prisma.PrismaClientKnownRequestError(
        "duplicate",{code:"P2002",clientVersion:"6.19.0"});
      seen.add(data.externalMessageId);stored++;
    }},
    $executeRaw:async()=>1,
    tenantUsage:{update:async()=>{used++;return {messages:used};}}
  })};
  const record=(id:string)=>ingestTenantMessage(db as never,config,{
    tenantId:"tenant-a",groupId:"group-a",messageId:id,senderId:"sender",text:"Hello"
  });
  assert.equal(await record("msg-1"),true);
  assert.equal(await record("msg-1"),false);
  assert.equal(await record("msg-2"),true);
  assert.equal(await record("msg-3"),true);
  assert.equal(stored,3);assert.equal(used,3);
});
test("inactive plans and unowned groups never ingest", async () => {
  for(const [status,group] of [["CANCELED",{id:"owned"}],["ACTIVE",null]] as const){
    let inserted=false;
    const db={$transaction:async(cb:(tx:unknown)=>Promise<boolean>)=>cb({
      tenantSubscription:{findUnique:async()=>({status,periodEnd:null})},
      group:{findFirst:async()=>group},
      message:{create:async()=>{inserted=true;}}
    })};
    assert.equal(await ingestTenantMessage(db as never,config,{
      tenantId:"tenant-a",groupId:"unowned",messageId:"id",senderId:"x",text:"text"
    }),false);
    assert.equal(inserted,false);
  }
});
