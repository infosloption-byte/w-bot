import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createTranslationProvider } from "../src/translation.js";
import { GeminiApiError } from "../src/gemini.js";
import { DEFAULT_TARGET_LANGUAGES } from "../src/languages.js";

function geminiConfig() {
  return loadConfig({
    DATABASE_URL: "mysql://user:password@localhost:3306/wbot",
    ADMIN_API_KEY: "x".repeat(64),
    WHATSAPP_VERIFY_TOKEN: "y".repeat(32),
    TRANSLATION_PROVIDER: "gemini",
    GEMINI_API_KEY: "fake-gemini-key",
    GEMINI_MODEL: "gemini-3.5-flash-lite",
    DRY_RUN: "true"
  });
}

const sampleTranslations = {
  he: "שלום לכולם",
  en: "Hello everyone",
  fil: "Kamusta sa lahat",
  si: "සැමට ආයුබෝවන්",
  ta: "அனைவருக்கும் வணக்கம்"
};

test("Gemini sends one structured request and normalizes Hebrew; no key in URL", async () => {
  const originalFetch = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async (input, init) => {
    count++;
    const url = String(input);
    assert.equal(new URL(url).search, "");
    assert.equal(url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-goog-api-key"), "fake-gemini-key");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(body.generationConfig.responseSchema.properties.translations.required,
      [...DEFAULT_TARGET_LANGUAGES]);
    assert.equal(body.contents[0].parts[0].text.includes("שלום לכולם"), true);
    return new Response(JSON.stringify({
      candidates: [{
        finishReason: "STOP",
        content: { parts: [{
          text: JSON.stringify({ sourceLanguage: "iw", translations: sampleTranslations })
        }] }
      }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const provider = createTranslationProvider(geminiConfig());
    assert.ok(provider.translateBatch);
    const batch = await provider.translateBatch("שלום לכולם", [...DEFAULT_TARGET_LANGUAGES]);
    assert.equal(batch.sourceLanguage, "he");
    assert.equal(batch.translations.en, "Hello everyone");
    assert.equal(batch.translations.fil, "Kamusta sa lahat");
    assert.equal(count, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("Gemini normalizes Tagalog detection to fil", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{ finishReason: "STOP", content: { parts: [{
      text: JSON.stringify({
        sourceLanguage: "tl",
        translations: { en: "Hello", fil: "Kumusta" }
      })
    }] } }]
  }), { status: 200 });
  try {
    const provider = createTranslationProvider(geminiConfig());
    const batch = await provider.translateBatch!("Kumusta", ["en", "fil"]);
    assert.equal(batch.sourceLanguage, "fil");
    assert.equal(batch.translations.en, "Hello");
  } finally { globalThis.fetch = original; }
});

test("Gemini rejects missing target translations instead of sending partial messages", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{ finishReason: "STOP", content: { parts: [{
      text: JSON.stringify({ sourceLanguage: "en", translations: { en: "Hello" } })
    }] } }]
  }), { status: 200 });
  try {
    const provider = createTranslationProvider(geminiConfig());
    await assert.rejects(provider.translateBatch!("Hello", ["en", "si"]),
      /translation missing or invalid for si/);
  } finally { globalThis.fetch = original; }
});

test("Gemini sanitizes 401 errors and treats 429 as retryable", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { status: "UNAUTHENTICATED", message: "Key fake-gemini-key invalid" }
  }), { status: 401 });
  try {
    const provider = createTranslationProvider(geminiConfig());
    await assert.rejects(provider.translateBatch!("Hello", ["en"]), (error: unknown) => {
      assert.ok(error instanceof GeminiApiError);
      assert.equal(error.httpStatus, 401);
      assert.equal(error.isPermanentConfigurationError, true);
      assert.doesNotMatch(error.message, /fake-gemini-key/);
      return true;
    });
    assert.equal(new GeminiApiError(429, "RESOURCE_EXHAUSTED").isPermanentConfigurationError, false);
  } finally { globalThis.fetch = original; }
});

test("Gemini config requires a key and validates model ID", () => {
  assert.throws(() => loadConfig({
    DATABASE_URL: "mysql://user:pass@localhost:3306/wbot",
    ADMIN_API_KEY: "x".repeat(64),
    WHATSAPP_VERIFY_TOKEN: "y".repeat(32),
    TRANSLATION_PROVIDER: "gemini",
    DRY_RUN: "true"
  }), /GEMINI_API_KEY required/);
  assert.throws(() => loadConfig({
    DATABASE_URL: "mysql://user:pass@localhost:3306/wbot",
    ADMIN_API_KEY: "x".repeat(64),
    WHATSAPP_VERIFY_TOKEN: "y".repeat(32),
    TRANSLATION_PROVIDER: "gemini",
    GEMINI_API_KEY: "dummy",
    GEMINI_MODEL: "http://evil.example",
    DRY_RUN: "true"
  }));
});
