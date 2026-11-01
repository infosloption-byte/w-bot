import type { PrismaClient } from "@prisma/client";

/** Original defaults retained so the working pilot keeps the same language
 * choices. Platform Admin can add more target languages to the database.
 */
export const DEFAULT_TARGET_LANGUAGES = ["he", "en", "si", "uz", "ru"] as const;
export const MAX_GROUP_LANGUAGES = 10;

export const LANGUAGE_NAMES: Record<string, string> = {
  he: "Hebrew", en: "English", si: "Sinhala", uz: "Uzbek", ru: "Russian"
};

export type EnabledLanguage = { code: string; name: string };
export const isValidLanguageCode = (value: string): boolean =>
  /^[a-z]{2,3}$/.test(value) && !["iw", "tl"].includes(value);

export function normalizeLanguageCode(value: string): string {
  const primary = value.trim().toLowerCase().replaceAll("_", "-").split("-")[0];
  if (primary === "iw") return "he";
  if (primary === "tl") return "fil";
  return primary ?? "";
}

/** Optional catalog for runtime use; no catalog means the five historical
 * defaults (used by legacy standalone checks/tests).
 */
export function isLanguage(code: string, enabled?: ReadonlySet<string>): boolean {
  return enabled ? enabled.has(code) : Object.hasOwn(LANGUAGE_NAMES, code);
}

export function configuredLanguages(value: unknown, enabled?: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return [];
  const result = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const code = normalizeLanguageCode(item);
    if (isLanguage(code, enabled)) result.add(code);
    if (result.size >= MAX_GROUP_LANGUAGES) break;
  }
  return [...result];
}

export function translationTargets(
  groupLanguages: unknown, source: string, enabled?: ReadonlySet<string>
): string[] {
  const sourceCode = normalizeLanguageCode(source);
  return configuredLanguages(groupLanguages, enabled).filter(code => code !== sourceCode);
}

/** Read the authoritative active catalog; no silent fallback if the database
 * is unavailable or the migration has not been applied.
 */
export async function loadEnabledLanguages(prisma: PrismaClient): Promise<EnabledLanguage[]> {
  return prisma.languageCatalog.findMany({
    where: { enabled: true },
    select: { code: true, name: true },
    orderBy: [{ name: "asc" }, { code: "asc" }]
  });
}

export function defaultGroupLanguages(enabled: EnabledLanguage[]): string[] {
  const codes = new Set(enabled.map(x => x.code));
  const defaults = DEFAULT_TARGET_LANGUAGES.filter(code => codes.has(code));
  return defaults.length ? [...defaults] : enabled.slice(0, 5).map(x => x.code);
}

export function validateTargetLanguages(value: string[], enabled: EnabledLanguage[]): boolean {
  const allowed = new Set(enabled.map(x => x.code));
  return value.length > 0 && value.length <= MAX_GROUP_LANGUAGES &&
    value.every(code => isValidLanguageCode(code) && allowed.has(code)) &&
    new Set(value).size === value.length;
}
