#!/usr/bin/env node
/**
 * Offline migration/verification tool.
 * Never prints session IDs, auth content, Signal keys or decrypted bytes.
 * Invoke only after stopping the customer-owned gateway.
 */
import { readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { createKmsProvider, migrateSession, verifyMigratedSession } from "./auth-vault.mjs";

process.umask(0o077);
const args = process.argv.slice(2);
const command = args.length === 1 ? args[0] : null;
if (!["--inventory","--migrate","--verify"].includes(command)) {
  console.error("Usage: node migrate-vault.mjs --inventory | --migrate | --verify");
  process.exit(2);
}
const legacyRoot = process.env.BYON_LEGACY_AUTH_DIR || "/data/legacy-auth";
const vaultRoot = process.env.BYON_VAULT_DIR || "/data/vault";
const isConnectionId = value => /^c[a-z0-9]{18,35}$/.test(value);
async function inventory() {
  const base = await lstat(legacyRoot);
  if (!base.isDirectory() || base.isSymbolicLink())
    throw Error("Legacy auth directory is unsafe");
  const dirs = await readdir(legacyRoot, { withFileTypes: true });
  const sessions = dirs.filter(item => isConnectionId(item.name));
  if (dirs.some(item => !item.isDirectory() || item.isSymbolicLink() ||
      !isConnectionId(item.name)))
    throw Error("Legacy volume contains unexpected entries; inspect offline");
  if (!sessions.length) throw Error("No sessions found in legacy volume");
  for (const entry of sessions) {
    const files = await readdir(join(legacyRoot, entry.name), { withFileTypes: true });
    if (!files.some(x => x.name === "creds.json") ||
        files.some(x => !x.isFile() || x.isSymbolicLink() ||
          !/^[a-zA-Z0-9_.@-]+\.json$/.test(x.name)))
      throw Error("Legacy session contains unsafe or incomplete records");
  }
  return sessions;
}
let provider;
try {
  const sessions = await inventory();
  if (command === "--inventory") {
    console.info("Legacy auth inventory completed; sessions:", sessions.length);
    process.exit(0);
  }
  provider = await createKmsProvider(process.env.BYON_KMS_KEY_ID);
  let totalRecords = 0, verified = 0, migrated = 0;
  for (const { name: id } of sessions) {
    if (command === "--migrate") {
      try {
        const result = await migrateSession({ legacyRoot, vaultRoot, id, provider });
        totalRecords += result.records; migrated++;
      } catch (error) {
        if (error?.message !== "Encrypted session already exists") throw error;
        // Idempotent retry: never overwrite a vault if it was already migrated.
      }
    }
    const result = await verifyMigratedSession({ legacyRoot, vaultRoot, id, provider });
    totalRecords += command === "--verify" ? result.records : 0;
    verified++;
  }
  console.info("Vault operation complete:", { mode: command, sessions: sessions.length,
    migrated, verified, ...(command === "--verify" ? { verifiedRecords: totalRecords } : {}) });
} catch {
  // Never expose filenames, encryption context values or AWS credential errors.
  console.error("Vault operation FAILED. Do not start the new gateway. Review secured logs and runbook.");
  process.exitCode = 1;
} finally {
  provider?.destroy?.();
}
