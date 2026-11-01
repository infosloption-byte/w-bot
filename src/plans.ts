/** Commercial plan catalog. USD cents, no payment collection in this module.
 * Single source of truth for customer-facing prices and enforced limits.
 */
export const W_BOT_PLANS = [
  { code: "STARTER", name: "Starter", monthlyCents: 6900, yearlyCents: 69000,
    whatsappConnections: 1, groups: 10 },
  { code: "TEAM", name: "Team", monthlyCents: 17900, yearlyCents: 179000,
    whatsappConnections: 2, groups: 30 },
  { code: "BUSINESS", name: "Business", monthlyCents: 32900, yearlyCents: 329000,
    whatsappConnections: 5, groups: 50 }
] as const;
export type CommercialPlanCode = typeof W_BOT_PLANS[number]["code"];
export type BillingInterval = "MONTHLY" | "YEARLY";
export function getCommercialPlan(code: string) {
  return W_BOT_PLANS.find(plan => plan.code === code) ?? null;
}
export function commercialLimits(code: string, legacy: {
  groupLimit: number; whatsappConnectionLimit: number
}) {
  const plan = getCommercialPlan(code);
  return plan
    ? { groups: plan.groups, whatsappConnections: plan.whatsappConnections }
    : { groups: legacy.groupLimit, whatsappConnections: legacy.whatsappConnectionLimit };
}
export function getCatalog() {
  return { currency: "USD", billingEnabled: false, unlimitedTextTranslations: true,
    annualDiscount: "Two months equivalent",
    plans: W_BOT_PLANS.map(plan => ({ ...plan,
      monthlyEquivalentAnnualCents: Math.round(plan.yearlyCents / 12) })) };
}
