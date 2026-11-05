/**
 * Encrypted Baileys auth store for customer-owned connections (Node 22).
 * Only ciphertext is persisted. Each connection receives a different 256-bit
 * data key wrapped by AWS KMS; auth record filenames are SHA-256 digests.
 *
 * Deployment requires the separate vault-only Compose override. Never mount
 * the legacy plaintext volume into the production vault gateway container.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { open, readFile, readdir, lstat, mkdir, rename, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { initAuthCreds, BufferJSON, proto } from "@whiskeysockets/baileys";

const ID = /^c[a-z0-9]{18,35}$/;
const ARN = /^arn:aws(-[a-z]+)?:kms:[a-z0-9-]+:[0-9]{12}:key\/[0-9a-f-]{36}$/;
const VERSION = 1;
const MAX_RECORD = 8 * 1024 * 1024;
const HASH = value => createHash("sha256").update(value).digest("hex");
const context = id => ({ app: "wbot", purpose: "customer-whatsapp-auth", connectionId: id });
const assertId = id => { if (!ID.test(id || "")) throw Error("Invalid vault connection identifier"); };
const parseBase64 = value => {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw Error("Corrupt vault encoding");
  return Buffer.from(value, "base64");
};
const json = value => Buffer.from(JSON.stringify(value, BufferJSON.replacer), "utf8");
const parsed = input => JSON.parse(input.toString("utf8"), BufferJSON.reviver);

async function regularFile(path) {
  const st = await lstat(path);
  if (!st.isFile() || st.isSymbolicLink()) throw Error("Unsafe vault file type");
  if (st.size > MAX_RECORD * 2) throw Error("Vault record too large");
}

async function secureDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const st = await lstat(path);
  if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077))
    throw Error("Vault directory permissions must be private");
}

async function syncDirectory(dir) {
  const fd = await open(dir, "r");
  try { await fd.sync(); } finally { await fd.close(); }
}

async function atomicWrite(path, data) {
  const dir = path.slice(0, path.lastIndexOf("/"));
  const tmp = path + "." + randomBytes(12).toString("hex") + ".tmp";
  let fd;
  try {
    fd = await open(tmp, "wx", 0o600);
    await fd.writeFile(data);
    await fd.sync();
    await fd.close();
    fd = null;
    await rename(tmp, path);
    await syncDirectory(dir);
  } catch (error) {
    if (fd) await fd.close().catch(() => {});
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

function aesEncrypt(key, connectionId, file, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("wbot-auth-v1:" + connectionId + ":" + file));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return json({ v: VERSION, iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"), ciphertext: ct.toString("base64") });
}
function aesDecrypt(key, connectionId, file, record) {
  const data = JSON.parse(record.toString("utf8"));
  if (data.v !== VERSION) throw Error("Unsupported vault record version");
  const iv = parseBase64(data.iv), tag = parseBase64(data.tag), ciphertext = parseBase64(data.ciphertext);
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_RECORD)
    throw Error("Invalid encrypted record size");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from("wbot-auth-v1:" + connectionId + ":" + file));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
function fileName(type, id) {
  if (typeof type !== "string" || !/^[a-z][a-z0-9-]{0,60}$/.test(type) ||
      typeof id !== "string" || !id || id.length > 512)
    throw Error("Invalid Signal key identity");
  // Preserve the exact name transformation used by Baileys multi-file state.
  return (type + "-" + id + ".json").replace(/\//g, "__").replace(/:/g, "-");
}
function recordPath(dir, name) { return join(dir, "r-" + HASH(name) + ".enc"); }

/** AWS SDK v3 credential chain is used; never persist AWS credentials inside the auth vault. */
export async function createKmsProvider(keyArn) {
  if (!ARN.test(keyArn || "")) throw Error("BYON_KMS_KEY_ID must be a full KMS key ARN");
  const { KMSClient, GenerateDataKeyCommand, DecryptCommand } = await import("@aws-sdk/client-kms");
  const client = new KMSClient({ region: keyArn.split(":")[3] });
  return {
    keyId: keyArn,
    async generate(id) {
      assertId(id);
      const res = await client.send(new GenerateDataKeyCommand({
        KeyId: keyArn, KeySpec: "AES_256", EncryptionContext: context(id)
      }));
      if (res.KeyId !== keyArn || !res.Plaintext || !res.CiphertextBlob ||
          res.Plaintext.length !== 32) throw Error("KMS data key generation failed");
      return { plaintext: Buffer.from(res.Plaintext), wrapped: Buffer.from(res.CiphertextBlob) };
    },
    async unwrap(id, wrapped) {
      assertId(id);
      const res = await client.send(new DecryptCommand({
        KeyId: keyArn, CiphertextBlob: wrapped, EncryptionContext: context(id)
      }));
      if (res.KeyId !== keyArn || !res.Plaintext || res.Plaintext.length !== 32)
        throw Error("KMS could not unlock auth session");
      return Buffer.from(res.Plaintext);
    },
    destroy() { client.destroy(); }
  };
}

/**
 * The store deliberately fails closed on invalid metadata, missing credentials,
 * wrong KMS context, and corrupted encrypted records. There is no plaintext
 * fallback when encrypted mode is enabled.
 */
export async function openSessionVault(root, id, provider, { allowCreate = false } = {}) {
  assertId(id);
  if (!provider?.keyId || typeof provider.generate !== "function" || typeof provider.unwrap !== "function")
    throw Error("Vault key provider unavailable");
  await secureDirectory(root);
  const dir = join(root, id);
  if (!allowCreate) {
    try {
      const existing = await lstat(dir);
      if (!existing.isDirectory() || existing.isSymbolicLink())
        throw Error("Unsafe vault directory");
    } catch (error) {
      if (error.code === "ENOENT") throw Error("Required encrypted session is missing");
      throw error;
    }
  }
  await secureDirectory(dir);
  const metaPath = join(dir, "vault.json");
  let meta, key, created = false;
  try {
    await regularFile(metaPath);
    meta = JSON.parse((await readFile(metaPath)).toString("utf8"));
    if (meta.version !== VERSION || meta.connectionId !== id ||
        meta.keyId !== provider.keyId || typeof meta.wrappedKey !== "string")
      throw Error("Vault metadata does not match connection and key");
    key = await provider.unwrap(id, parseBase64(meta.wrappedKey));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    // An incomplete/corrupt existing vault must never be treated as a new login.
    if (!allowCreate) throw Error("Encrypted vault metadata is missing");
    if ((await readdir(dir)).length) throw Error("Existing vault is missing its key metadata");
    const generated = await provider.generate(id);
    key = generated.plaintext;
    if (key.length !== 32) throw Error("Invalid 256-bit data key");
    meta = { version: VERSION, connectionId: id, keyId: provider.keyId,
      wrappedKey: generated.wrapped.toString("base64") };
    await atomicWrite(metaPath, json(meta));
    created = true;
  }
  const inflight = new Map();
  let closed = false;
  const requireOpen = () => { if (closed) throw Error("Auth vault closed"); };
  const queued = (name, action) => {
    requireOpen();
    const prior = inflight.get(name) || Promise.resolve();
    const promise = prior.catch(() => {}).then(() => {
      requireOpen();
      return action();
    });
    inflight.set(name, promise);
    void promise.finally(() => { if (inflight.get(name) === promise) inflight.delete(name); }).catch(() => {});
    return promise;
  };
  async function readRaw(name) {
    requireOpen();
    await (inflight.get(name) || Promise.resolve());
    const path = recordPath(dir, name);
    try {
      await regularFile(path);
      return aesDecrypt(key, id, name, await readFile(path));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }
  async function writeRaw(name, value) {
    if (typeof name !== "string" || !name.endsWith(".json") || name.length > 800)
      throw Error("Invalid vault record identity");
    if (value !== null && (!Buffer.isBuffer(value) || value.length > MAX_RECORD))
      throw Error("Invalid vault plaintext record");
    return queued(name, async () => {
      const path = recordPath(dir, name);
      if (value === null) {
        await unlink(path).catch(err => { if (err.code !== "ENOENT") throw err; });
        await syncDirectory(dir);
      } else {
        await atomicWrite(path, aesEncrypt(key, id, name, value));
      }
    });
  }
  async function importRecord(name, bytes) {
    if (!name.endsWith(".json") || name.includes("/") || name.includes("\\") ||
        name.length > 800 || name === "vault.json")
      throw Error("Invalid legacy auth filename");
    parsed(bytes); // Reject malformed JSON before making any encrypted record.
    await writeRaw(name, bytes);
    const verify = await readRaw(name);
    if (!verify?.equals(bytes)) throw Error("Session vault round-trip verification failed");
  }
  if (created) {
    // A new session starts with encrypted initial credentials. Migration replaces
    // them before staging is atomically published.
    await writeRaw("creds.json", json(initAuthCreds()));
  }
  let credsBytes = await readRaw("creds.json");
  if (!credsBytes) throw Error("Vault credentials missing; refusing to re-pair");
  const creds = parsed(credsBytes);
  if (!creds || typeof creds !== "object" || !creds.noiseKey || !creds.signedIdentityKey)
    throw Error("Vault credentials invalid");
  return {
    directory: dir,
    state: {
      creds,
      keys: {
        async get(type, ids) {
          const data = Object.create(null);
          for (const keyId of ids) {
            const bytes = await readRaw(fileName(type, keyId));
            let value = bytes === null ? null : parsed(bytes);
            if (type === "app-state-sync-key" && value)
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            data[keyId] = value;
          }
          return data;
        },
        async set(records) {
          const tasks = [];
          for (const [type, ids] of Object.entries(records)) {
            if (!ids) continue;
            for (const [keyId, value] of Object.entries(ids))
              tasks.push(writeRaw(fileName(type, keyId), value == null ? null : json(value)));
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => writeRaw("creds.json", json(creds)),
    importRecord,
    readRecord: readRaw,
    async close() {
      if (closed) return;
      await Promise.allSettled([...inflight.values()]);
      closed = true;
      key.fill(0);
    }
  };
}

/**
 * Offline migration: rejects symlinks and unexpected legacy files, encrypts
 * every record into a private temporary directory, verifies round-trips and
 * atomically publishes the complete session. Never deletes the old session.
 */
export async function migrateSession({ legacyRoot, vaultRoot, id, provider }) {
  assertId(id);
  const source = join(legacyRoot, id);
  const st = await lstat(source);
  if (!st.isDirectory() || st.isSymbolicLink()) throw Error("Unsafe legacy auth directory");
  const records = (await readdir(source, { withFileTypes: true }));
  if (!records.length || !records.some(entry => entry.name === "creds.json"))
    throw Error("Legacy credentials missing");
  if (records.some(entry => !entry.isFile() || entry.isSymbolicLink() ||
      !/^[a-zA-Z0-9_.@-]+\.json$/.test(entry.name)))
    throw Error("Unsafe legacy auth file");
  await secureDirectory(vaultRoot);
  // Skip existing vaults rather than replace potentially newer Signal keys.
  const published = join(vaultRoot, id);
  try { await lstat(published); throw Error("Encrypted session already exists"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const stage = join(vaultRoot, ".staging-" + randomBytes(12).toString("hex"));
  let vault;
  try {
    await secureDirectory(stage);
    vault = await openSessionVault(stage, id, provider, { allowCreate: true });
    for (const entry of records) {
      const path = join(source, entry.name);
      await regularFile(path);
      const bytes = await readFile(path);
      if (bytes.length > MAX_RECORD) throw Error("Legacy record too large");
      await vault.importRecord(entry.name, bytes);
    }
    await vault.close();
    vault = null;
    // Atomic publication within the same named Docker volume.
    await rename(join(stage, id), published);
    await syncDirectory(vaultRoot);
    return { records: records.length };
  } finally {
    if (vault) await vault.close().catch(() => {});
    await rm(stage, { recursive: true, force: true });
  }
}

export async function verifyMigratedSession({ legacyRoot, vaultRoot, id, provider }) {
  assertId(id);
  const source = join(legacyRoot, id);
  const entries = await readdir(source, { withFileTypes: true });
  if (!entries.length || entries.some(x => !x.isFile() || x.isSymbolicLink() ||
      !/^[a-zA-Z0-9_.@-]+\.json$/.test(x.name)))
    throw Error("Invalid legacy session records");
  const vault = await openSessionVault(vaultRoot, id, provider);
  try {
    for (const entry of entries) {
      await regularFile(join(source, entry.name));
      const original = await readFile(join(source, entry.name));
      const encrypted = await vault.readRecord(entry.name);
      if (!encrypted || !encrypted.equals(original)) throw Error("Encrypted migration verification failed");
    }
    return { records: entries.length };
  } finally { await vault.close(); }
}
