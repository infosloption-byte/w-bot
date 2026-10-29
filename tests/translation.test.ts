import test from "node:test";
import assert from "node:assert/strict";
import { detectMockLanguage, mockProvider } from "../src/translation.js";
import {
  configuredLanguages, DEFAULT_TARGET_LANGUAGES,
  isLanguage, normalizeLanguageCode, translationTargets
} from "../src/languages.js";

test("all five required languages are supported and set as defaults", () => {
  assert.deepEqual(DEFAULT_TARGET_LANGUAGES, ["he", "en", "fil", "si", "ta"]);
  for (const language of DEFAULT_TARGET_LANGUAGES) assert.equal(isLanguage(language), true);
  assert.equal(isLanguage("hi"), false);
});

test("mock detector recognizes Hebrew, Sinhala, Tamil and English", () => {
  assert.equal(detectMockLanguage("שלום לכולם"), "he");
  assert.equal(detectMockLanguage("ආයුබෝවන්"), "si");
  assert.equal(detectMockLanguage("வணக்கம்"), "ta");
  assert.equal(detectMockLanguage("Hello everybody"), "en");
});

test("mock mode cannot distinguish English and Filipino using Latin script alone", () => {
  assert.equal(detectMockLanguage("Kumusta po kayo"), "en");
});

test("normalize legacy Google and regional language codes", () => {
  assert.equal(normalizeLanguageCode("iw"), "he");
  assert.equal(normalizeLanguageCode("he-IL"), "he");
  assert.equal(normalizeLanguageCode("tl"), "fil");
  assert.equal(normalizeLanguageCode("fil-PH"), "fil");
  assert.equal(normalizeLanguageCode("en-US"), "en");
});

test("up to five supported targets are retained, normalized, and deduplicated", () => {
  assert.deepEqual(configuredLanguages(["iw", "en", "tl", "si", "ta", "fil", "zz"]),
    ["he", "en", "fil", "si", "ta"]);
});

test("translate to four other languages without echoing source", () => {
  assert.deepEqual(translationTargets(DEFAULT_TARGET_LANGUAGES, "iw"),
    ["en", "fil", "si", "ta"]);
  assert.deepEqual(translationTargets(DEFAULT_TARGET_LANGUAGES, "tl"),
    ["he", "en", "si", "ta"]);
  assert.deepEqual(translationTargets(DEFAULT_TARGET_LANGUAGES, "si"),
    ["he", "en", "fil", "ta"]);
});

test("mock output is clearly labeled as not actually translated", async () => {
  assert.match(await mockProvider().translate("hello", "en", "he"), /^\[MOCK HE — not translated\]/);
});
