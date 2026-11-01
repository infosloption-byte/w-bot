import { lstat, mkdir, readdir, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Archive top-level Baileys JSON credentials without deleting the Docker volume.
 * Run this ONLY while the web-gateway service is stopped.
 */
export async function archiveAuthState(directory) {
  const dir = resolve(directory);
  const entries = await readdir(dir, { withFileTypes: true });
  const candidates = entries
    .filter(item => item.isFile() && item.name.endsWith(".json"))
    .map(item => item.name);
  if (!candidates.length) return { count: 0, archive: null };

  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  const archive = resolve(dir, "rejected-session-" + stamp);
  await mkdir(archive, { mode: 0o700 });

  for (const name of candidates) {
    const source = resolve(dir, name);
    if (!(await lstat(source)).isFile()) continue;
    await rename(source, resolve(archive, name));
  }
  return { count: candidates.length, archive };
}

const invokedDirectly = Boolean(process.argv[1])
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  if (process.argv[2] !== "--confirm-reset") {
    console.error("Safety check: run node auth-reset.mjs --confirm-reset only while the Web gateway is stopped.");
    process.exitCode = 2;
  } else {
    const dir = process.env.WEB_AUTH_DIR || "/data/auth";
    try {
      const result = await archiveAuthState(dir);
      console.log(result.count
        ? "Archived " + result.count + " credential files within the private auth volume. Old credentials are no longer active."
        : "No top-level credential files found; a fresh pairing session may already be ready.");
    } catch {
      console.error("Could not archive Web authentication state. Check permissions and that the gateway is stopped.");
      process.exitCode = 1;
    }
  }
}
