import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../src/config.js";
import { createGeminiProvider } from "../src/gemini.js";
import {
  DEFAULT_TARGET_LANGUAGES, MAX_GROUP_LANGUAGES, isLanguage,
  configuredLanguages, defaultGroupLanguages, validateTargetLanguages
} from "../src/languages.js";
import { processPending } from "../src/processor.js";
import { registerPlatformRoutes } from "../src/platform.js";
import { registerPortalRoutes } from "../src/portal.js";
import { digest, SESSION_COOKIE } from "../src/portal-auth.js";

const defaultLanguages = [
  { code: "he", name: "Hebrew" }, { code: "en", name: "English" },
  { code: "si", name: "Sinhala" }, { code: "uz", name: "Uzbek" },
  { code: "ru", name: "Russian" }
];
const allLanguages = [...defaultLanguages,
  { code: "fr", name: "French" }, { code: "es", name: "Spanish" }];
const allowed = new Set(allLanguages.map(x => x.code));

const cfg = loadConfig({
  DATABASE_URL: "mysql://user:pass@localhost:3306/wbot",
  SAAS_ENABLED: "true", SAAS_SIGNUP_CODE: "a".repeat(40),
  ADMIN_API_KEY: "b".repeat(64), WHATSAPP_VERIFY_TOKEN: "c".repeat(32)
});
const session = "x".repeat(43);
const customer = {
  userId: "owner", expiresAt: new Date(Date.now() + 100000),
  user: { email: "customer@example.com", displayName: "Customer",
    memberships: [{ tenantId: "tenant-a", role: "OWNER",
      tenant: { name: "Workspace A" } }]
  }
};
const platformAdmin = {
  expiresAt: new Date(Date.now() + 100000),
  admin: { id: "platform-admin", role: "SUPER_ADMIN",
    active: true, displayName: "Operator", email: "operator@example.com" }
};
const mutationHeaders = {
  cookie: "wbot_platform_session=" + session, "x-wbot-request": "1"
};

test("original five defaults survive catalog migration and customers can choose more", () => {
  assert.deepEqual([...DEFAULT_TARGET_LANGUAGES], ["he","en","si","uz","ru"]);
  assert.deepEqual(defaultGroupLanguages(allLanguages), ["he","en","si","uz","ru"]);
  assert.equal(isLanguage("fr"), false); // no unrestricted legacy fallback
  assert.deepEqual(configuredLanguages(["fr","en","es","fr"], allowed), ["fr","en","es"]);
  assert.equal(validateTargetLanguages(["he","fr","es"], allLanguages), true);
  assert.equal(validateTargetLanguages(["fr","fr"], allLanguages), false);
  assert.equal(validateTargetLanguages(["fr","de"], allLanguages), false);
  assert.equal(MAX_GROUP_LANGUAGES, 10);
  assert.equal(validateTargetLanguages(Array(11).fill("fr"), allLanguages), false);
});

test("disabled language is filtered even if saved in a group's JSON settings", () => {
  const enabled = new Set(["he","en","si","uz","ru","fr"]);
  assert.deepEqual(configuredLanguages(["en","fr","es"], enabled), ["en","fr"]);
  assert.deepEqual(defaultGroupLanguages([{ code:"fr",name:"French" }]), ["fr"]);
});

test("customer cannot submit globally disabled language via direct tenant API", async () => {
  let writes = 0;
  const db = {
    portalSession: { findUnique: async () => customer },
    languageCatalog: { findMany: async () => defaultLanguages },
    group: { updateMany: async () => { writes++; return { count: 1 }; } }
  } as unknown as PrismaClient;
  const app = Fastify(); registerPortalRoutes(app, db, cfg);
  const res = await app.inject({
    method:"PATCH",url:"/portal/api/groups/real-group",
    headers:{cookie:SESSION_COOKIE+"="+session,"x-wbot-request":"1"},
    payload:{targetLanguages:["en","fr"]}
  });
  assert.equal(res.statusCode,400);
  assert.equal(writes,0);
  await app.close();
});

test("platform language catalog is inaccessible with customer session", async () => {
  const app = Fastify(); registerPlatformRoutes(app, {} as PrismaClient, cfg);
  const res = await app.inject({
    method:"GET",url:"/portal/api/platform/languages",
    headers:{cookie:SESSION_COOKIE+"="+session}
  });
  assert.equal(res.statusCode,401); await app.close();
});

test("super admin can add an enabled language and records audit event", async () => {
  let createdCode = "";
  let auditAction = "";
  const db = {
    platformSession: { findUnique: async (arg: {where: {tokenHash:string}}) => {
      assert.equal(arg.where.tokenHash,digest(session));
      return platformAdmin;
    } },
    languageCatalog: { findUnique: async () => null },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({
      languageCatalog: { create: async (arg: {data: {code:string}}) => {
        createdCode=arg.data.code; return arg.data;
      } },
      platformAudit: { create: async (arg:{data:{action:string}}) => {
        auditAction=arg.data.action;
      } }
    })
  } as unknown as PrismaClient;
  const app=Fastify();registerPlatformRoutes(app,db,cfg);
  const response=await app.inject({
    method:"POST",url:"/portal/api/platform/languages",
    headers:mutationHeaders,payload:{code:"FR",name:"French",enabled:true}
  });
  assert.equal(response.statusCode,201);
  assert.equal(createdCode,"fr");
  assert.equal(auditAction,"LANGUAGE_ADDED");
  await app.close();
});

test("disabling the only enabled language is blocked", async () => {
  let mutated=false;
  const db = {
    platformSession:{findUnique:async()=>platformAdmin},
    $transaction:async (cb:(tx:unknown)=>Promise<unknown>)=>cb({
      $queryRaw:async()=>[],
      languageCatalog:{
        findUnique:async()=>({code:"en",name:"English",enabled:true}),
        count:async()=>1,
        update:async()=>{mutated=true;}
      }
    })
  } as unknown as PrismaClient;
  const app=Fastify();registerPlatformRoutes(app,db,cfg);
  const res=await app.inject({method:"PATCH",
    url:"/portal/api/platform/languages/en",headers:mutationHeaders,
    payload:{enabled:false}
  });
  assert.equal(res.statusCode,409);
  assert.equal(mutated,false);
  await app.close();
});

test("Gemini accepts newly enabled targets with names provided by the catalog", async () => {
  const previous=globalThis.fetch;
  globalThis.fetch=async (_input,init)=>{
    const body=JSON.parse(String(init?.body));
    assert.equal(body.contents[0].parts[0].text.includes('"fr":"French"'),true);
    assert.deepEqual(body.generationConfig.responseSchema.properties.translations.required,["en","fr","es"]);
    return new Response(JSON.stringify({candidates:[{
      finishReason:"STOP",content:{parts:[{text:JSON.stringify({
        sourceLanguage:"en",
        translations:{en:"Hello",fr:"Bonjour",es:"Hola"}
      })}]}
    }]}),{status:200});
  };
  try{
    const gemini=createGeminiProvider("not-real","gemini-3.5-flash-lite");
    const result=await gemini.translateBatch!("Hello",["en","fr","es"],
      {en:"English",fr:"French",es:"Spanish"});
    assert.equal(result.translations.fr,"Bonjour");
    assert.equal(result.translations.es,"Hola");
  }finally{globalThis.fetch=previous;}
});

test("worker renders a sixth enabled language and skips disabled targets", async () => {
  const record={
    id:"msg-6",attempts:0,status:"PENDING",sourceLanguage:null,
    outputText:null,originalText:"Hello",
    createdAt:new Date(Date.now()-100),
    externalMessageId:"whats-6",senderId:"fake@lid",groupId:"group-6",
    group:{ enabled:true,gateway:"WEB",targetLanguages:["he","en","si","uz","ru","fr","es"],
      whatsappGroupId:"1234567890@g.us", tenantId:null }
  };
  const updates:Array<Record<string,unknown>>=[];
  const db={
    languageCatalog:{findMany:async()=>allLanguages.filter(x=>x.code!=="es")},
    message:{updateMany:async()=>({count:1}),findMany:async()=>[record],
      update:async (args:{data:Record<string,unknown>})=>{updates.push(args.data);return args.data;}}
  } as unknown as PrismaClient;
  let requested:string[]=[];
  const provider={
    async detect(){throw Error("Should use batch");},
    async translate(){throw Error("Should use batch");},
    async translateBatch(_text:string,targets:string[],names?:Record<string,string>){
      requested=targets;
      assert.equal(names?.fr,"French");
      return { sourceLanguage:"en", translations:{
        he:"שלום",en:"Hello",si:"හෙලෝ",uz:"Salom",ru:"Привет",fr:"Bonjour"
      }};
    }
  };
  assert.equal(await processPending(db,provider,loadConfig({
    DATABASE_URL:"mysql://u:p@localhost:3306/wbot",
    ADMIN_API_KEY:"b".repeat(64), WHATSAPP_VERIFY_TOKEN:"c".repeat(32),
    DRY_RUN:"true"
  })),1);
  assert.deepEqual(requested,["he","en","si","uz","ru","fr"]);
  const output=String(updates.find(x=>typeof x.outputText==="string")?.outputText);
  assert.ok(output.includes("🌐 French\nBonjour"));
  assert.equal(output.includes("🌐 Spanish"),false);
});

test("read-only platform staff cannot add or enable languages", async () => {
  const db = {
    platformSession: { findUnique: async () => ({
      ...platformAdmin, admin: { ...platformAdmin.admin, role: "VIEWER" }
    }) }
  } as unknown as PrismaClient;
  const app = Fastify(); registerPlatformRoutes(app, db, cfg);
  const post = await app.inject({
    method: "POST", url: "/portal/api/platform/languages",
    headers: mutationHeaders, payload: { code: "fa", name: "Persian", enabled: true }
  });
  const patch = await app.inject({
    method: "PATCH", url: "/portal/api/platform/languages/fr",
    headers: mutationHeaders, payload: { enabled: true }
  });
  assert.equal(post.statusCode, 403);
  assert.equal(patch.statusCode, 403);
  await app.close();
});

test("catalog migration preserves original defaults and adds disabled presets", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const sql = readFileSync(fileURLToPath(new URL(
    "../prisma/migrations/20261030000300_language_catalog/migration.sql",
    import.meta.url)), "utf8");
  for (const entry of [
    "('he','Hebrew',TRUE", "('en','English',TRUE",
    "('si','Sinhala',TRUE", "('uz','Uzbek',TRUE",
    "('ru','Russian',TRUE"
  ]) assert.ok(sql.includes(entry), entry);
  assert.ok(sql.includes("('fr','French',FALSE"));
  assert.ok(sql.includes("CREATE TABLE"));
  assert.ok(!sql.includes("DROP TABLE"));
});
