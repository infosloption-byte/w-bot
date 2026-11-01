/**
 * W-Bot's supported languages and their canonical codes.
 * Legacy source-language codes "iw" (Hebrew) and "tl" (Tagalog) are normalized for detection only.
 */
export const DEFAULT_TARGET_LANGUAGES = ["he", "en", "si", "uz", "ru"] as const;

export const LANGUAGE_NAMES: Record<string, string> = {
  he: "Hebrew",
  en: "English",
  si: "Sinhala",
  uz: "Uzbek",
  ru: "Russian"
};

export function normalizeLanguageCode(value: string): string {
  const primary = value.trim().toLowerCase().replaceAll("_", "-").split("-")[0];
  if (primary === "iw") return "he";
  if (primary === "tl") return "fil";
  return primary ?? "";
}

export const isLanguage = (code: string): boolean =>
  Object.hasOwn(LANGUAGE_NAMES, code);

export function configuredLanguages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const result = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const code = normalizeLanguageCode(item);
    if (isLanguage(code)) result.add(code);
    if (result.size === DEFAULT_TARGET_LANGUAGES.length) break;
  }
  return [...result];
}

export function translationTargets(groupLanguages: unknown, source: string): string[] {
  const sourceCode = normalizeLanguageCode(source);
  return configuredLanguages(groupLanguages).filter(code => code !== sourceCode);
}
