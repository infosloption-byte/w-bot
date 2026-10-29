import he from "he";
import type { Config } from "./config.js";

export interface TranslationProvider {
  detect(text: string): Promise<string>;
  translate(text: string, source: string, target: string): Promise<string>;
}

export function detectMockLanguage(text: string): string {
  if (/[\u0D80-\u0DFF]/u.test(text)) return "si";
  if (/[\u0B80-\u0BFF]/u.test(text)) return "ta";
  if (/[\u0900-\u097F]/u.test(text)) return "hi";
  if (/[\u4E00-\u9FFF]/u.test(text)) return "zh";
  if (/[\u0600-\u06FF]/u.test(text)) return "ar";
  return "en";
}

export function mockProvider(): TranslationProvider {
  return {
    async detect(text) { return detectMockLanguage(text); },
    async translate(text, _source, target) {
      return "[MOCK " + target.toUpperCase() + " — not translated] " + text;
    }
  };
}

function googleProvider(key: string): TranslationProvider {
  async function request(path: string, params: Record<string, string>): Promise<any> {
    const response = await fetch("https://translation.googleapis.com/language/translate/v2" + path + "?key=" + encodeURIComponent(key), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error("Google Translation HTTP " + response.status);
    return response.json();
  }
  return {
    async detect(text) {
      const json = await request("/detect", { q: text });
      const language = json?.data?.detections?.[0]?.[0]?.language;
      if (typeof language !== "string") throw new Error("Language detection returned no language");
      const primaryLanguage = language.toLowerCase().split("-")[0];
      if (!primaryLanguage) throw new Error("Detected language code is empty");
      return primaryLanguage;
    },
    async translate(text, source, target) {
      const json = await request("", { q: text, source, target, format: "text" });
      const translated = json?.data?.translations?.[0]?.translatedText;
      if (typeof translated !== "string") throw new Error("Translation returned no text");
      return he.decode(translated);
    }
  };
}

export function createTranslationProvider(config: Config): TranslationProvider {
  return config.TRANSLATION_PROVIDER === "google"
    ? googleProvider(config.GOOGLE_TRANSLATE_API_KEY!)
    : mockProvider();
}
