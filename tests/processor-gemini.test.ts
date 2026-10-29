import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../src/config.js";
import { processPending } from "../src/processor.js";
import type { TranslationProvider } from "../src/translation.js";

test("worker makes one Gemini batch call and posts only four translations in dry-run", async () => {
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
          he: "שלום לכולם",
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
  assert.doesNotMatch(output, /🌐 Hebrew/);
  for (const label of ["English", "Sinhala", "Uzbek", "Russian"])
    assert.match(output, new RegExp("🌐 " + label.replace(/[()]/g, "\\$&")));
  assert.equal(messages.at(-1)?.status, "COMPLETED");
  assert.equal(messages.at(-1)?.outboundMessageId, null);
});
