import he from "he";
import type { Config } from "./config.js";
import { normalizeLanguageCode } from "./languages.js";
import { createGeminiProvider } from "./gemini.js";

export class GoogleTranslationError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly reason: string
  ) {
    super("Google Translation HTTP " + httpStatus + " (" + reason + ")");
    this.name = "GoogleTranslationError";
  }

  get isPermanentConfigurationError(): boolean {
    return this.httpStatus === 401
      || ["API_KEY_INVALID", "API_KEY_SERVICE_BLOCKED", "API_KEY_IP_ADDRESS_BLOCKED",
          "API_KEY_HTTP_REFERRER_BLOCKED", "SERVICE_DISABLED", "BILLING_DISABLED"].includes(this.reason);
  }
}

export interface TranslationBatch {
  sourceLanguage: string;
  translations: Record<string, string>;
}

export interface TranslationProvider {
  translateBatch?(text: string, targets: string[]): Promise<TranslationBatch>;
  detect(text: string): Promise<string>;
  translate(text: string, source: string, target: string): Promise<string>;
}

export function detectMockLanguage(text: string): string {
  if (/[\u0590-\u05FF]/u.test(text)) return "he";
  if (/[\u0400-\u04FF]/u.test(text)) return "ru";
  if (/[\u0D80-\u0DFF]/u.test(text)) return "si";
  if (/[\u0B80-\u0BFF]/u.test(text)) return "ta";
  if (/[\u0900-\u097F]/u.test(text)) return "hi";
  if (/[\u4E00-\u9FFF]/u.test(text)) return "zh";
  if (/[\u0600-\u06FF]/u.test(text)) return "ar";
  // Latin-script Uzbek vs English, and Cyrillic Uzbek vs Russian, are ambiguous.
  // Enable Gemini for reliable multilingual detection.
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
    const response = await fetch("https://translation.googleapis.com/language/translate/v2" + path, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-goog-api-key": key
      },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) {
      // Google returns machine-readable error status/reason. Never store its full
      // response body: it may contain request or credential information.
      let reason = "UNKNOWN";
      try {
        const result = await response.json() as {
          error?: {
            status?: string;
            details?: Array<{ reason?: string }>;
          };
        };
        const detailReason = result.error?.details?.find(
          detail => typeof detail.reason === "string"
        )?.reason;
        const rawReason = detailReason || result.error?.status;
        if (rawReason && /^[A-Z0-9_]{3,80}$/.test(rawReason)) reason = rawReason;
      } catch {
        // Malformed error responses must not hide the original HTTP status.
      }
      throw new GoogleTranslationError(response.status, reason);
    }
    return response.json();
  }
  return {
    async detect(text) {
      const json = await request("/detect", { q: text });
      const language = json?.data?.detections?.[0]?.[0]?.language;
      if (typeof language !== "string") throw new Error("Language detection returned no language");
      const primaryLanguage = language.toLowerCase().split("-")[0];
      if (!primaryLanguage) throw new Error("Detected language code is empty");
      return normalizeLanguageCode(primaryLanguage);
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
  if (config.TRANSLATION_PROVIDER === "gemini") {
    return createGeminiProvider(config.GEMINI_API_KEY!, config.GEMINI_MODEL, config.GEMINI_THINKING_LEVEL);
  }
  return config.TRANSLATION_PROVIDER === "google"
    ? googleProvider(config.GOOGLE_TRANSLATE_API_KEY!)
    : mockProvider();
}
