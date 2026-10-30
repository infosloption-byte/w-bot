import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../src/config.js";
import { registerByonPortalRoutes } from "../src/byon-portal.js";
import { registerByonPlatformRoutes } from "../src/byon-platform.js";
import { byonAuthorized, connectionKey, connectionTypeAllowed, isConnectionId } from "../src/byon-shared.js";

const cfg = loadConfig({
  DATABASE_URL: "mysql://u:p@127.0.0.1:3306/wbot",
  SAAS_ENABLED: "true", SAAS_SIGNUP_CODE: "a".repeat(48),
  ADMIN_API_KEY: "b".repeat(64), WHATSAPP_VERIFY_TOKEN: "c".repeat(32),
  WEB_GATEWAY_ENABLED: "true", WEB_GATEWAY_TOKEN: "d".repeat(64),
  BYON_GATEWAY_ENABLED: "true", BYON_GATEWAY_TOKEN: "e".repeat(64)
});
const token="x".repeat(43);
const user = {
  userId: "owner", tenantId: "tenant-a", role: "OWNER",
  email: "owner@example.com", tenantName: "Test"
};
const session = {
  expiresAt: new Date(Date.now()+120_000),
  user: { email: user.email, displayName:"Owner", memberships:[
    { tenantId: user.tenantId, role: "OWNER", tenant: { name: user.tenantName } }
  ] }
};
const userHeaders={cookie:"wbot_portal_session="+token,"x-wbot-request":"1"};
const platformHeaders={cookie:"wbot_platform_session="+token,"x-wbot-request":"1"};

test("connection routing keys cannot collide with shared W-Bot group", () => {
  const id="cktb92lxp000007n3qux1329d";
  assert.equal(connectionKey(id), "byon:"+id);
  assert.ok(isConnectionId(id));
  assert.equal(isConnectionId("../../etc/passwd"), false);
  assert.notEqual(connectionKey(id), "shared");
});
test("admin can independently disable personal numbers while keeping business available", () => {
  const policy={customerNumbersEnabled:true,personalEnabled:false,businessEnabled:true};
  assert.equal(connectionTypeAllowed(policy,"PERSONAL"),false);
  assert.equal(connectionTypeAllowed(policy,"BUSINESS"),true);
  assert.equal(connectionTypeAllowed({...policy,customerNumbersEnabled:false},"BUSINESS"),false);
});
test("internal gateway callback rejects missing and incorrect tokens", () => {
  assert.equal(byonAuthorized(undefined,cfg),false);
  assert.equal(byonAuthorized("Bearer "+"f".repeat(64),cfg),false);
  assert.equal(byonAuthorized("Bearer "+"e".repeat(64),cfg),true);
  assert.equal(byonAuthorized("Bearer "+"d".repeat(64),cfg),false);
});
test("customer session cannot use platform WhatsApp policy API",async()=>{
  const app=Fastify();
  registerByonPlatformRoutes(app,{} as PrismaClient,cfg);
  const response=await app.inject({method:"GET",url:"/portal/api/platform/whatsapp-policy",
    headers:{cookie:"wbot_portal_session="+token}});
  assert.equal(response.statusCode,401);
  await app.close();
});
test("unauthenticated users cannot access customer connection listing",async()=>{
  const app=Fastify();
  registerByonPortalRoutes(app,{} as PrismaClient,cfg);
  const response=await app.inject({method:"GET",url:"/portal/api/connections"});
  assert.equal(response.statusCode,401);
  await app.close();
});
test("customer A cannot poll customer B pairing QR or code",async()=>{
  const db={
    portalSession:{findUnique:async()=>session},
    customerWhatsAppConnection:{
      findFirst:async(args:{where:{tenantId:string}})=>{
        assert.equal(args.where.tenantId,"tenant-a");
        return null;
      }
    }
  } as unknown as PrismaClient;
  const app=Fastify();registerByonPortalRoutes(app,db,cfg);
  const response=await app.inject({method:"GET",
    url:"/portal/api/connections/cktb92lxp000007n3qux1329d/status",headers:userHeaders});
  assert.equal(response.statusCode,404);
  await app.close();
});
test("customer B cannot generate a pairing session belonging to customer A",async()=>{
  const db={
    portalSession:{findUnique:async()=>session},
    customerWhatsAppConnection:{
      findFirst:async(args:{where:{tenantId:string}})=>{
        assert.equal(args.where.tenantId,"tenant-a");return null;
      }
    }
  } as unknown as PrismaClient;
  const app=Fastify();registerByonPortalRoutes(app,db,cfg);
  const response=await app.inject({method:"POST",
    url:"/portal/api/connections/cktb92lxp000007n3qux1329d/pair",
    headers:userHeaders,payload:{phoneNumber:"94771234567"}});
  assert.equal(response.statusCode,404);
  await app.close();
});
test("gateway cannot activate another tenant group without trusted bearer token",async()=>{
  const app=Fastify();registerByonPortalRoutes(app,{} as PrismaClient,cfg);
  const response=await app.inject({method:"POST",url:"/internal/byon/activate",
    headers:{authorization:"Bearer "+"d".repeat(64)},
    payload:{connectionId:"cktb92lxp000007n3qux1329d",groupId:"1234567890@g.us",
      groupName:"Test",code:"ABCDEF1234567890",adminVerified:true}});
  assert.equal(response.statusCode,401);
  await app.close();
});
test("platform viewer cannot enable customer-owned number models",async()=>{
  const db={
    platformSession:{findUnique:async()=>({
      expiresAt:new Date(Date.now()+100000),
      admin:{id:"admin1",active:true,role:"VIEWER"}
    })}
  } as unknown as PrismaClient;
  const app=Fastify();registerByonPlatformRoutes(app,db,cfg);
  const response=await app.inject({method:"PATCH",url:"/portal/api/platform/whatsapp-policy",
    headers:platformHeaders,payload:{
      customerNumbersEnabled:true,personalEnabled:true,businessEnabled:true,maxConnectionsPerTenant:5
    }});
  assert.equal(response.statusCode,403);
  await app.close();
});
test("customer-owned connection policy defaults to disabled in a fresh database",async()=>{
  const db={
    portalSession:{findUnique:async()=>session},
    whatsAppConnectionPolicy:{findUnique:async()=>null},
    customerWhatsAppConnection:{findMany:async()=>[]}
  } as unknown as PrismaClient;
  const app=Fastify();registerByonPortalRoutes(app,db,cfg);
  const response=await app.inject({method:"GET",url:"/portal/api/connections",headers:userHeaders});
  assert.equal(response.statusCode,200);
  assert.equal(response.json().policy.enabled,false);
  assert.equal(response.json().connections.length,0);
  await app.close();
});

test("valid gateway token still cannot claim a connection for a different tenant", async () => {
  let created = false;
  const db = {
    customerWhatsAppConnection: { findUnique: async () => ({
      id: "cktb92lxp000007n3qux1329d",tenantId:"tenant-a",active:true,
      status:"CONNECTED",kind:"BUSINESS"
    }) },
    whatsAppConnectionPolicy: { findUnique: async () => ({
      customerNumbersEnabled:true,businessEnabled:true,personalEnabled:true
    }) },
    languageCatalog: { findMany: async () => [
      { code:"en",name:"English" }
    ] },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({
      groupActivation: { findUnique: async () => ({
        id:"claim-b",connectionId:"cktb92lxp000007n3qux1329d",
        tenantId:"tenant-b",consumedAt:null,expiresAt:new Date(Date.now()+30000)
      }) },
      group: { create: async () => { created = true; } }
    })
  } as unknown as PrismaClient;
  const app=Fastify();registerByonPortalRoutes(app,db,cfg);
  const response=await app.inject({
    method:"POST",url:"/internal/byon/activate",
    headers:{authorization:"Bearer "+"e".repeat(64)},
    payload:{connectionId:"cktb92lxp000007n3qux1329d",
      groupId:"12345678901@g.us",groupName:"Foreign Group",
      code:"ABCDEF1234567890",adminVerified:true}
  });
  assert.equal(response.statusCode,403);
  assert.equal(created,false);
  await app.close();
});
