import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm, cp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initAuthCreds, BufferJSON } from "@whiskeysockets/baileys";
import { openSessionVault, migrateSession, verifyMigratedSession } from "../auth-vault.mjs";

const A = "c" + "a".repeat(22);
const B = "c" + "b".repeat(22);
const metaKey = "arn:aws:kms:ap-southeast-1:123456789012:key/12345678-1234-1234-1234-123456789012";
function fakeKms() {
  const keys = new Map();
  return {
    keyId: metaKey,
    async generate(id) {
      const plaintext = randomBytes(32);
      const wrapped = randomBytes(48);
      keys.set(wrapped.toString("hex"), { id, plaintext });
      return { plaintext: Buffer.from(plaintext), wrapped };
    },
    async unwrap(id, wrapped) {
      const found = keys.get(wrapped.toString("hex"));
      if (!found || found.id !== id) throw Error("KMS encryption context mismatch");
      return Buffer.from(found.plaintext);
    }
  };
}
const sha = value => createHash("sha256").update(value).digest("hex");
const record = (root, id, name) => join(root, id, "r-" + sha(name) + ".enc");
const fixture = async t => {
  const root = await mkdtemp(join(tmpdir(), "wbot-encrypted-auth-test-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  return { root, legacy: join(root, "legacy"), vault: join(root, "vault"), kms: fakeKms() };
};
const j = value => JSON.stringify(value, BufferJSON.replacer);

test("new session stores only AES-GCM ciphertext and preserves Baileys credentials and Signal keys", async t => {
  const { vault, kms } = await fixture(t);
  const first = await openSessionVault(vault, A, kms, { allowCreate: true });
  assert.ok(first.state.creds.noiseKey);
  first.state.creds.me = { id: "9999911111@s.whatsapp.net", name: "Example" };
  await first.saveCreds();
  const buffer = Buffer.from([0,1,2,253,255]);
  await first.state.keys.set({ session: { "recipient:2": { secret: buffer, count: 7 } } });
  const files = await readdir(join(vault, A));
  assert.ok(files.includes("vault.json"));
  assert.ok(files.includes("r-" + sha("creds.json") + ".enc"));
  assert.ok(files.every(x => x === "vault.json" || /^r-[a-f0-9]{64}\.enc$/.test(x)));
  const stored = await readFile(record(vault,A,"creds.json"),"utf8");
  assert.ok(!stored.includes("9999911111"), "auth plaintext must not appear in ciphertext");
  assert.ok(!stored.includes("noiseKey"));
  await first.close();
  const second = await openSessionVault(vault, A, kms);
  assert.equal(second.state.creds.me.id, "9999911111@s.whatsapp.net");
  const keys = await second.state.keys.get("session",["recipient:2"]);
  assert.equal(keys["recipient:2"].count,7);
  assert.deepEqual(Buffer.from(keys["recipient:2"].secret),buffer);
  await second.state.keys.set({ session: { "recipient:2": null } });
  assert.equal((await second.state.keys.get("session",["recipient:2"]))["recipient:2"],null);
  await second.close();
});

test("missing, invalid and swapped ciphertext fail closed without fresh pairing or plaintext fallback", async t => {
  const {vault,kms} = await fixture(t);
  await assert.rejects(openSessionVault(vault,A,kms),/missing/);
  const first = await openSessionVault(vault,A,kms,{allowCreate:true});
  await first.state.keys.set({ session: { "some-key": { value:"confidential" } } });
  await first.close();
  const other = await openSessionVault(vault,B,kms,{allowCreate:true});
  await other.close();
  await cp(record(vault,A,"session-some-key.json"),record(vault,B,"session-some-key.json"));
  const b = await openSessionVault(vault,B,kms);
  await assert.rejects(b.state.keys.get("session",["some-key"]),/authenticate|Unsupported|Invalid/i);
  await b.close();
  const path = record(vault,A,"creds.json");
  const data = JSON.parse(await readFile(path,"utf8"));
  data.tag = Buffer.alloc(16).toString("base64");
  await writeFile(path, JSON.stringify(data));
  await assert.rejects(openSessionVault(vault,A,kms),/authenticate|Unsupported|Invalid/i);
});

test("KMS encryption context and key identity prevent another connection from unlocking a session", async t => {
  const {vault,kms} = await fixture(t);
  const first=await openSessionVault(vault,A,kms,{allowCreate:true});
  await first.close();
  const foreign=join(vault,B);
  await cp(join(vault,A),foreign,{recursive:true});
  await assert.rejects(openSessionVault(vault,B,kms),/metadata does not match/);
  const wrongKey = { ...kms, keyId:"arn:aws:kms:ap-southeast-1:123456789012:key/23456789-1234-1234-1234-123456789012" };
  await assert.rejects(openSessionVault(vault,A,wrongKey),/metadata does not match/);
});

test("offline migration copies, encrypts, verifies and atomically publishes all legacy auth files", async t => {
  const {legacy,vault,kms}=await fixture(t);
  await mkdir(join(legacy,A),{recursive:true});
  const creds=initAuthCreds();
  creds.me={id:"7777777777@s.whatsapp.net",name:"Legacy Example"};
  await writeFile(join(legacy,A,"creds.json"),j(creds));
  await writeFile(join(legacy,A,"session-123@c.us.json"),j({session:"legacy-secret"}));
  await writeFile(join(legacy,A,"app-state-sync-key-sync.json"),j({keyData:Buffer.from([1,2,3])}));
  const result=await migrateSession({legacyRoot:legacy,vaultRoot:vault,id:A,provider:kms});
  assert.equal(result.records,3);
  assert.equal((await verifyMigratedSession({legacyRoot:legacy,vaultRoot:vault,id:A,provider:kms})).records,3);
  assert.ok((await readFile(join(legacy,A,"creds.json"),"utf8")).includes("7777777777"),
    "originals remain available for restricted rollback");
  const files=await readdir(join(vault,A));
  assert.ok(files.length===4);
  assert.ok(files.every(x=>x==="vault.json"||/^r-[a-f0-9]{64}\.enc$/.test(x)));
  assert.equal((await readdir(vault)).length,1,"staging must be removed after publish");
  await assert.rejects(migrateSession({legacyRoot:legacy,vaultRoot:vault,id:A,provider:kms}),/already exists/);
  await writeFile(join(legacy,A,"session-123@c.us.json"),j({session:"changed"}));
  await assert.rejects(verifyMigratedSession({legacyRoot:legacy,vaultRoot:vault,id:A,provider:kms}),/verification failed/);
});

test("migration refuses unsafe records and never publishes a partially encrypted session", async t => {
  const {legacy,vault,kms}=await fixture(t);
  await mkdir(join(legacy,A),{recursive:true});
  await writeFile(join(legacy,A,"creds.json"),j(initAuthCreds()));
  await writeFile(join(legacy,A,"unknown_file.json"),"{invalid json");
  await assert.rejects(migrateSession({legacyRoot:legacy,vaultRoot:vault,id:A,provider:kms}),/Unexpected|JSON|position|token|end/i);
  const dirs=await readdir(vault);
  assert.equal(dirs.length,0,"failed stage must not be published");
});
