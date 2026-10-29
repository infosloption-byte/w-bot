import test from "node:test";
import assert from "node:assert/strict";
import { detectMockLanguage, mockProvider } from "../src/translation.js";
import { configuredLanguages } from "../src/languages.js";

test("mock detector recognizes Sinhala, Tamil, English", () => {
  assert.equal(detectMockLanguage("ආයුබෝවන්"), "si");
  assert.equal(detectMockLanguage("வணக்கம்"), "ta");
  assert.equal(detectMockLanguage("hello"), "en");
});
test("mock output is labeled as not actually translated", async () => {
  assert.match(await mockProvider().translate("hello", "en", "si"), /^\[MOCK SI — not translated\]/);
});
test("unknown languages dropped; maximum three", () => {
  assert.deepEqual(configuredLanguages(["si","xx","ta","en","ja"]), ["si","ta","en"]);
});
