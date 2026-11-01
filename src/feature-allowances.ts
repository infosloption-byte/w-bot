import { commercialLimits } from "./plans.js";
import { planActive } from "./quotas.js";

type TranslationLicense = {
  planCode: string; groupLimit: number; whatsappConnectionLimit: number;
  status: string; periodEnd: Date | null
};
type AlertLicense = {
  maxConnections: number; status: string; periodEnd: Date | null
};
/** Shared connection capacity comes from either active feature license.
 * Zero in an existing translation pilot represents unlimited connections.
 */
export function sharedConnectionAllowance(
  translation: TranslationLicense | null, alerts: AlertLicense | null
): { eligible: boolean; limit: number } {
  const capacities: number[] = [];
  if (translation && planActive(translation)) {
    const limit = commercialLimits(translation.planCode, translation).whatsappConnections;
    capacities.push(limit === 0 ? Infinity : limit);
  }
  if (alerts && planActive(alerts)) capacities.push(alerts.maxConnections);
  if (!capacities.length) return { eligible: false, limit: 0 };
  const max = Math.max(...capacities);
  return { eligible: true, limit: Number.isFinite(max) ? max : 0 };
}
