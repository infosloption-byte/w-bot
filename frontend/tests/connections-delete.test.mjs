import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("../src/ByonConnections.tsx", import.meta.url)), "utf8");

test("WhatsApp connection DELETE has mutation/CSRF header without unconditional JSON content-type", () => {
  assert.match(source, /"X-WBot-Request": "1"/);
  assert.match(source, /\.\.\.\(body === undefined \? \{\} : \{ "Content-Type": "application\/json" \}\)/);
  assert.doesNotMatch(source, /headers: method === "GET" \? \{\} : \{ "Content-Type": "application\/json", "X-WBot-Request": "1" \}/);
  assert.match(source, /request<\{ removed: boolean; pending\?: boolean; message\?: string \}>\([\s\S]*?"DELETE"/);
});
