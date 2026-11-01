import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createTranslationProvider } from "../src/translation.js";

test("Google v2 detection and translation use a header key, normalize legacy codes and decode text", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ path: string; body: URLSearchParams }> = [];

  globalThis.fetch = async (input, init) => {
    const path = String(input);
    const headers = new Headers(init?.headers);
    const body = new URLSearchParams(init?.body as URLSearchParams);

    assert.equal(headers.get("x-goog-api-key"), "test-secret-key");
    assert.equal(headers.get("content-type"), "application/x-www-form-urlencoded");
    assert.equal(new URL(path).search, "", "API key must never appear in the URL");
    requests.push({ path, body });

    if (path.endsWith("/detect")) {
      const language = body.get("q") === "שלום" ? "iw" : "tl";
      return new Response(JSON.stringify({
        data: { detections: [[{ language, confidence: 0.99, isReliable: true }]] }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    return new Response(JSON.stringify({
      data: { translations: [{ translatedText: "Hello &amp; welcome" }] }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const provider = createTranslationProvider(loadConfig({
      DATABASE_URL: "mysql://test:test@localhost:3306/test",
      ADMIN_API_KEY: "a".repeat(64),
      WHATSAPP_VERIFY_TOKEN: "b".repeat(32),
      TRANSLATION_PROVIDER: "google",
      GOOGLE_TRANSLATE_API_KEY: "test-secret-key",
      DRY_RUN: "true"
    }));

    assert.equal(await provider.detect("שלום"), "he");
    assert.equal(await provider.detect("Kumusta"), "fil");
    assert.equal(await provider.translate("שלום", "he", "ru"), "Hello & welcome");
    assert.equal(requests.length, 3);
    assert.equal(requests[2]?.body.get("source"), "he");
    assert.equal(requests[2]?.body.get("target"), "ru");
    assert.equal(requests[2]?.body.get("format"), "text");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
