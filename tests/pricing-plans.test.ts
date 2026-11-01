import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../src/config.js";
import { registerPortalRoutes } from "../src/portal.js";
import { registerPlatformRoutes } from "../src/platform.js";

const config = loadConfig({
  DATABASE_URL: "mysql://u:p@localhost:3306/wbot", SAAS_ENABLED: "true",
  SAAS_SIGNUP_CODE: "a".repeat(48), ADMIN_API_KEY: "b".repeat(64),
  WHATSAPP_VERIFY_TOKEN: "c".repeat(32), SAAS_COOKIE_SECURE: "false"
});
const headers = { cookie: "wbot_platform_session=" + "x".repeat(43),
  "x-wbot-request": "1" };
const session = () => ({
  expiresAt: new Date(Date.now() + 120000),
  admin: { id: "operator", role: "SUPER_ADMIN", active: true,
    displayName: "Operator", email: "operator@example.com", lastLoginAt: null }
});
const payload = (planCode: string) => ({
  planCode, billingInterval: "YEARLY", status: "ACTIVE",
  groupLimit: 999, whatsappConnectionLimit: 999, periodEnd: null
});

test("catalog publicly displays precisely three plans, USD cents, without a checkout",async()=>{
  const app=Fastify();registerPortalRoutes(app,{} as PrismaClient,config);
  const result=await app.inject({method:"GET",url:"/portal/api/plans"});
  assert.equal(result.statusCode,200);
  assert.equal(result.json().billingEnabled,false);
  assert.equal(result.json().unlimitedTextTranslations,true);
  assert.deepEqual(result.json().plans.map((p:{code:string;monthlyCents:number;yearlyCents:number;groups:number;whatsappConnections:number})=>
    [p.code,p.monthlyCents,p.yearlyCents,p.groups,p.whatsappConnections]),[
    ["STARTER",6900,69000,10,1],
    ["TEAM",17900,179000,30,2],
    ["BUSINESS",32900,329000,50,5]
  ]);
  await app.close();
});

test("platform ignores forged paid plan limits and persists catalog-defined annual allowance",async()=>{
  let persisted:Record<string,unknown>={};
  const db={
    platformSession:{findUnique:async()=>session()},
    tenant:{findUnique:async()=>({id:"workspace-1"})},
    tenantSubscription:{findUnique:async()=>({groupLimit:3,whatsappConnectionLimit:0})},
    group:{count:async()=>0},
    customerWhatsAppConnection:{count:async()=>0},
    $transaction:async (run:(tx:unknown)=>Promise<unknown>)=>run({
      $queryRaw:async()=>[],
      group:{count:async()=>0},
      customerWhatsAppConnection:{count:async()=>0},
      tenantSubscription:{upsert:async({create}:{create:Record<string,unknown>})=>{
        persisted=create;return create;
      }},
      platformAudit:{create:async()=>({id:"audit-1"})}
    })
  } as unknown as PrismaClient;
  const app=Fastify();registerPlatformRoutes(app,db,config);
  const result=await app.inject({method:"PATCH",
    url:"/portal/api/platform/tenants/workspace-1/subscription",
    headers,payload:payload("TEAM")});
  assert.equal(result.statusCode,200,result.body);
  assert.equal(persisted?.groupLimit,30);
  assert.equal(persisted?.whatsappConnectionLimit,2);
  assert.equal(persisted?.billingInterval,"YEARLY");
  assert.equal(persisted?.monthlyMessages,0);
  assert.equal(result.json().plan.priceCents,179000);
  await app.close();
});
test("platform rejects downgrades requiring forced removal of existing groups",async()=>{
  let changed=false;
  const db={
    platformSession:{findUnique:async()=>session()},
    tenant:{findUnique:async()=>({id:"workspace-1"})},
    tenantSubscription:{findUnique:async()=>({groupLimit:30,whatsappConnectionLimit:2})},
    group:{count:async()=>11},
    customerWhatsAppConnection:{count:async()=>1},
    $transaction:async (run:(tx:unknown)=>Promise<unknown>)=>run({
      $queryRaw:async()=>[],
      group:{count:async()=>11},
      customerWhatsAppConnection:{count:async()=>1},
      tenantSubscription:{upsert:async()=>{changed=true;}}
    })
  } as unknown as PrismaClient;
  const app=Fastify();registerPlatformRoutes(app,db,config);
  const result=await app.inject({method:"PATCH",
    url:"/portal/api/platform/tenants/workspace-1/subscription",
    headers,payload:payload("STARTER")});
  assert.equal(result.statusCode,409,result.body);
  assert.equal(result.json().allowedGroups,10);
  assert.equal(changed,false);
  await app.close();
});
