import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveAuthState } from "../auth-reset.mjs";

test("archiving invalid auth files preserves them and does not touch unrelated files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wbot-web-auth-"));
  try {
    await writeFile(join(directory, "creds.json"), '{"registered":false}');
    await writeFile(join(directory, "session-key.json"), '{"key":"private"}');
    await writeFile(join(directory, "README.txt"), "keep");
    await mkdir(join(directory, "other-state"));
    const first = await archiveAuthState(directory);
    assert.equal(first.count, 2);
    assert.ok(first.archive);
    assert.deepEqual((await readdir(directory)).sort(), ["README.txt", "other-state", first.archive.split("/").pop()].sort());
    assert.equal(await readFile(join(first.archive, "creds.json"), "utf8"), '{"registered":false}');
    assert.equal(await readFile(join(first.archive, "session-key.json"), "utf8"), '{"key":"private"}');
    const second = await archiveAuthState(directory);
    assert.deepEqual(second, { count: 0, archive: null });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
