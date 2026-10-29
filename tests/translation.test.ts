import test from "node:test";
import assert from "node:assert/strict";
import { detectMockLanguage, mockProvider } from "../src/translation.js";
import {
  configuredLanguages, DEFAULT_TARGET_LANGUAGES,
  isLanguage, normalizeLanguageCode, translationTargets
} from "../src/languages.js";

test("Hebrew, English, Sinhala, Uzbek, Russian are five default target languages", () => {
  assert.deepEqual(DEFAULT_TARGET_LANGUAGES, ["he", "en", "si", "uz", "ru"]);
  for (const language of DEFAULT_TARGET_LANGUAGES) assert.equal(isLanguage(language), true);
  for (const retired of ["fil", "ta"]) assert.equal(isLanguage(retired), false);
});

test("mock detection identifies distinctive scripts, but not Uzbek Latin", () => {
  assert.equal(detectMockLanguage("שלום לכולם"), "he");
  assert.equal(detectMockLanguage("ආයුබෝවන්"), "si");
  assert.equal(detectMockLanguage("Привет всем"), "ru");
  assert.equal(detectMockLanguage("Hello everybody"), "en");
  assert.equal(detectMockLanguage("Assalomu alaykum"), "en");
});

test("legacy source language codes still normalize for detection", () => {
  assert.equal(normalizeLanguageCode("iw"), "he");
  assert.equal(normalizeLanguageCode("he-IL"), "he");
  assert.equal(normalizeLanguageCode("tl"), "fil");
  assert.equal(normalizeLanguageCode("uz-UZ"), "uz");
  assert.equal(normalizeLanguageCode("ru-RU"), "ru");
});

test("supported target sets deduplicate and exclude retired translations", () => {
  assert.deepEqual(configuredLanguages(["iw", "en", "tl", "si", "ru", "uz", "ta", "zz"]),
    ["he", "en", "si", "ru", "uz"]);
});

test("translate to four other languages without echoing source", () => {
  assert.deepEqual(translationTargets(DEFAULT_TARGET_LANGUAGES, "iw"),
    ["en", "si", "uz", "ru"]);
  assert.deepEqual(translationTargets(DEFAULT_TARGET_LANGUAGES, "ru"),
    ["he", "en", "si", "uz"]);
  assert.deepEqual(translationTargets(DEFAULT_TARGET_LANGUAGES, "uz"),
    ["he", "en", "si", "ru"]);
});

test("mock output is visibly labeled as not translated", async () => {
  assert.match(await mockProvider().translate("hello", "en", "ru"),
    /^\[MOCK RU — not translated\]/);
});
