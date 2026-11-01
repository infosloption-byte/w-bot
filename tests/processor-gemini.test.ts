import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../src/config.js";
import { processPending } from "../src/processor.js";
import type { TranslationProvider } from "../src/translation.js";

test("worker makes one Gemini batch call and includes all five languages in dry-run", async () => {
  let called = 0;
  let detectCalled = 0;
  let translateCalled = 0;
  const messages: Array<Record<string, unknown>> = [];
  const record = {
    id: "msg1",
    attempts: 0,
    status: "PENDING",
    sourceLanguage: null,
    outputText: null,
    originalText: "שלום לכולם",
    createdAt: new Date(Date.now() - 20),
    externalMessageId: "ABC123",
    senderId: "99106504601758@lid",
    group: {
      enabled: true, gateway: "WEB", whatsappGroupId: "120363412606399130@g.us",
      targetLanguages: ["he", "en", "si", "uz", "ru"]
    }
  };
  const db = {
    languageCatalog: { findMany: async () => [
      { code: "he", name: "Hebrew" }, { code: "en", name: "English" },
      { code: "si", name: "Sinhala" }, { code: "uz", name: "Uzbek" },
      { code: "ru", name: "Russian" }
    ] },
    message: {
      updateMany: async () => ({ count: 1 }),
      findMany: async () => [record],
      update: async (args: { data: Record<string, unknown> }) => {
        messages.push(args.data);
        return args.data;
      }
    }
  } as unknown as PrismaClient;
  const provider: TranslationProvider = {
    async detect() { detectCalled++; throw new Error("detect must not be called"); },
    async translate() { translateCalled++; throw new Error("translate must not be called"); },
    async translateBatch(_text, targets) {
      called++;
      assert.deepEqual(targets, ["he", "en", "si", "uz", "ru"]);
      return {
        sourceLanguage: "he",
        translations: {
          he: "MODEL_SHOULD_NOT_OVERRIDE_ORIGINAL",
          en: "Hello everyone",
          si: "සැමට ආයුබෝවන්",
          uz: "Hammaga salom",
          ru: "Всем привет"
        }
      };
    }
  };
  const cfg = loadConfig({
    DATABASE_URL: "mysql://user:pass@localhost:3306/wbot",
    ADMIN_API_KEY: "a".repeat(64),
    WHATSAPP_VERIFY_TOKEN: "b".repeat(32),
    TRANSLATION_PROVIDER: "mock",
    DRY_RUN: "true"
  });
  assert.equal(await processPending(db, provider, cfg), 1);
  assert.equal(called, 1);
  assert.equal(detectCalled, 0);
  assert.equal(translateCalled, 0);
  const saved = messages.find(data => typeof data.outputText === "string");
  assert.ok(saved);
  assert.equal(saved.sourceLanguage, "he");
  const output = String(saved.outputText);
  assert.ok(output.includes("🌐 Hebrew\nשלום לכולם"));
  for (const label of ["English", "Sinhala", "Uzbek", "Russian"])
    assert.match(output, new RegExp("🌐 " + label.replace(/[()]/g, "\\$&")));
  assert.equal(messages.at(-1)?.status, "COMPLETED");
  assert.equal(messages.at(-1)?.outboundMessageId, null);
});

test("Russian input appears verbatim in the Russian section along with four translations", async () => {
  const original = "Привет всем! Встречаемся завтра в 9 утра.";
  const writes: Array<Record<string, unknown>> = [];
  const record = {
    id: "msg-russian", attempts: 0, status: "PENDING",
    sourceLanguage: null, outputText: null, originalText: original,
    createdAt: new Date(),
    externalMessageId: "3EB0F75D24828D089F1AF2",
    senderId: "99106504601758@lid",
    group: {
      enabled: true, gateway: "WEB",
      whatsappGroupId: "120363412606399130@g.us",
      targetLanguages: ["he", "en", "si", "uz", "ru"]
    }
  };
  const db = {
    languageCatalog: { findMany: async () => [
      { code: "he", name: "Hebrew" }, { code: "en", name: "English" },
      { code: "si", name: "Sinhala" }, { code: "uz", name: "Uzbek" },
      { code: "ru", name: "Russian" }
    ] },
    message: {
      updateMany: async () => ({ count: 1 }),
      findMany: async () => [record],
      update: async (args: { data: Record<string, unknown> }) => {
        writes.push(args.data);
        return args.data;
      }
    }
  } as unknown as PrismaClient;
  let batchCalls = 0;
  const provider: TranslationProvider = {
    async detect() { throw new Error("Unexpected separate detection"); },
    async translate() { throw new Error("Unexpected separate translation"); },
    async translateBatch() {
      batchCalls++;
      return {
        sourceLanguage: "ru",
        translations: {
          he: "שלום לכולם!",
          en: "Hello everyone!",
          si: "හැමෝටම ආයුබෝවන්!",
          uz: "Hammaga salom!",
          ru: "MODEL_REPHRASED_RUSSIAN"
        }
      };
    }
  };
  const cfg = loadConfig({
    DATABASE_URL: "mysql://user:pass@localhost:3306/wbot",
    ADMIN_API_KEY: "a".repeat(64),
    WHATSAPP_VERIFY_TOKEN: "b".repeat(32),
    TRANSLATION_PROVIDER: "mock",
    DRY_RUN: "true"
  });
  assert.equal(await processPending(db, provider, cfg), 1);
  assert.equal(batchCalls, 1);
  const output = String(writes.find(data => typeof data.outputText === "string")?.outputText);
  for (const name of ["Hebrew", "English", "Sinhala", "Uzbek", "Russian"]) {
    assert.ok(output.includes("🌐 " + name + "\n"), name + " missing");
  }
  assert.ok(output.includes("🌐 Russian\n" + original));
  assert.ok(!output.includes("MODEL_REPHRASED_RUSSIAN"));
  assert.equal(writes.at(-1)?.status, "COMPLETED");
});
