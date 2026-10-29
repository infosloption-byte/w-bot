export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", si: "Sinhala", ta: "Tamil", hi: "Hindi",
  zh: "Chinese (Simplified)", ar: "Arabic", fr: "French",
  de: "German", ja: "Japanese", es: "Spanish"
};
export const isLanguage = (code: string) => Object.hasOwn(LANGUAGE_NAMES, code);
export function configuredLanguages(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((s): s is string => typeof s === "string" && isLanguage(s)).slice(0, 3)
    : [];
}
