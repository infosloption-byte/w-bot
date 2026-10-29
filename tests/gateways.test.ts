import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { isWebGroupId, sendGatewayText, GatewayUnavailableError } from "../src/gateways.js";

function cfg(overrides: Record<string, string> = {}) {
  return loadConfig({
    DATABASE_URL: "mysql://user:password@localhost:3306/wbot",
    ADMIN_API_KEY: "a".repeat(64),
    WHATSAPP_VERIFY_TOKEN: "b".repeat(32),
    WEB_GATEWAY_ENABLED: "true",
    WEB_GATEWAY_TOKEN: "c".repeat(64),
    DRY_RUN: "true",
    ...overrides
  });
}

test("web groups require @g.us JIDs", () => {
  assert.equal(isWebGroupId("120363123456789012@g.us"), true);
  assert.equal(isWebGroupId("120363123456789012@s.whatsapp.net"), false);
  assert.equal(isWebGroupId("https://example.com@g.us"), false);
});

test("dry-run never sends to either transport", async () => {
  const actual = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Network should not be used"); };
  try {
    assert.equal(await sendGatewayText(cfg(), "WEB", "120363123456789012@g.us", "Hello"), null);
    assert.equal(await sendGatewayText(cfg(), "OFFICIAL", "meta-group-id", "Hello"), null);
  } finally { globalThis.fetch = actual; }
});

test("web gateway sends to requested existing group with bearer token", async () => {
  const actual = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "http://web-gateway:9029/send");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer " + "c".repeat(64));
    const data = JSON.parse(String(init?.body));
    assert.equal(data.groupId, "120363123456789012@g.us");
    return new Response(JSON.stringify({ messageId: "ABCD" }), { status: 200 });
  };
  try {
    assert.equal(await sendGatewayText(cfg({ DRY_RUN: "false" }), "WEB",
      "120363123456789012@g.us", "Bonjour"), "ABCD");
  } finally { globalThis.fetch = actual; }
});

test("disconnected gateway is retryable and not silently routed through Meta", async () => {
  const actual = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "Disconnected" }), { status: 503 });
  try {
    await assert.rejects(
      sendGatewayText(cfg({ DRY_RUN: "false" }), "WEB", "120363123456789012@g.us", "Hello"),
      (error: unknown) => error instanceof GatewayUnavailableError && error.gateway === "WEB"
    );
  } finally { globalThis.fetch = actual; }
});

test("enabled Web gateway requires a strong shared token", () => {
  assert.throws(() => cfg({ WEB_GATEWAY_TOKEN: "short" }), /WEB_GATEWAY_TOKEN/);
});
