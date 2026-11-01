import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createTranslationProvider, GoogleTranslationError } from "../src/translation.js";

function config() {
  return loadConfig({
    DATABASE_URL: "mysql://tester:test@localhost:3306/wbot",
    ADMIN_API_KEY: "a".repeat(64),
    WHATSAPP_VERIFY_TOKEN: "b".repeat(32),
    TRANSLATION_PROVIDER: "google",
    GOOGLE_TRANSLATE_API_KEY: "test-key-do-not-log",
    DRY_RUN: "true"
  });
}

test("Google authorization failure retains safe status/reason, not private error body", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: {
      code: 401,
      status: "UNAUTHENTICATED",
      message: "Invalid API key: test-key-do-not-log",
      details: [{ reason: "API_KEY_INVALID", domain: "googleapis.com" }]
    }
  }), { status: 401, headers: { "content-type": "application/json" } });

  try {
    const provider = createTranslationProvider(config());
    await assert.rejects(provider.detect("Kumusta"), (error: unknown) => {
      assert.ok(error instanceof GoogleTranslationError);
      assert.equal(error.httpStatus, 401);
      assert.equal(error.reason, "API_KEY_INVALID");
      assert.equal(error.isPermanentConfigurationError, true);
      assert.doesNotMatch(error.message, /test-key-do-not-log/);
      return true;
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("Google temporary server failures can be retried", () => {
  const error = new GoogleTranslationError(503, "UNAVAILABLE");
  assert.equal(error.isPermanentConfigurationError, false);
});

test("Malformed error bodies provide safe fallback", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html>bad gateway</html>", { status: 502 });
  try {
    const provider = createTranslationProvider(config());
    await assert.rejects(provider.detect("Hello"), (error: unknown) => {
      assert.ok(error instanceof GoogleTranslationError);
      assert.equal(error.httpStatus, 502);
      assert.equal(error.reason, "UNKNOWN");
      return true;
    });
  } finally {
    globalThis.fetch = original;
  }
});
