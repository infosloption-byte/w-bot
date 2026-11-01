/** Read-only rule matching. No message from a group is an instruction. */
export type WatchRuleCriteria = {
  category: string; keywords: string; origin: string | null;
  destination: string | null; minPrice: number | null;
  maxPrice: number | null; requireContact: boolean;
};

export type WatchMatch = { summary: string; contactNumber: string | null; quotedPrice: number | null };

export function normalizeWatchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
}

export function extractContactNumber(text: string): string | null {
  // Explicit phone-like runs, not bare amounts, dates or short booking IDs.
  const candidates = text.match(/(?:\+?\d[\d\s().-]{7,24}\d)/g) ?? [];
  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length >= 9 && digits.length <= 15 &&
        !/^\d{4}[-/]?\d{2}[-/]?\d{2}$/.test(candidate)) return candidate.trim().slice(0,32);
  }
  return null;
}

export function extractQuotedPrice(text: string): number | null {
  const prefix = /\b(?:lkr|rs\.?|fare|price|budget|offer)\s*[:=\-]?\s*(\d{2,9}(?:,\d{3})*)/i.exec(text);
  const suffix = /\b(\d{2,9}(?:,\d{3})*)\s*(?:lkr|rs\.?)\b/i.exec(text);
  const captured = prefix?.[1] ?? suffix?.[1];
  if (!captured) return null;
  const value = Number(captured.replace(/,/g, ""));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function evaluateWatchRule(text: string, rule: WatchRuleCriteria): WatchMatch | null {
  if (!text.trim() || text.length > 2000) return null;
  const message = normalizeWatchText(text);
  const keywords = rule.keywords.split(",").map(normalizeWatchText).filter(Boolean);
  // An explicit search term is mandatory. Avoid catch-all surveillance rules.
  if (!keywords.length || !keywords.some(term => message.includes(term))) return null;
  if (rule.origin && !message.includes(normalizeWatchText(rule.origin))) return null;
  if (rule.destination && !message.includes(normalizeWatchText(rule.destination))) return null;
  const price = extractQuotedPrice(text);
  if ((rule.minPrice !== null && (price === null || price < rule.minPrice)) ||
      (rule.maxPrice !== null && (price === null || price > rule.maxPrice))) return null;
  const contact = extractContactNumber(text);
  if (rule.requireContact && !contact) return null;
  const summary = text.replace(/\s+/g, " ").trim().slice(0,500);
  return { summary, quotedPrice: price, contactNumber: contact };
}
