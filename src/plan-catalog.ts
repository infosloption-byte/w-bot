/**
 * Published commercial subscriptions. Prices are in USD. The payment provider
 * is not connected: a displayed price is not an active checkout product.
 * A monthlyMessages value of 0 explicitly means unlimited accepted source
 * text translations, while usage is still counted for fair-use monitoring.
 */
export type PlanOffer = {
  code: "STARTER" | "TEAM" | "BUSINESS";
  name: string;
  monthlyUsd: number;
  yearlyUsd: number;
  groupLimit: number;
  whatsappConnectionLimit: number;
  monthlyMessages: 0;
  unlimitedTextTranslations: true;
};

export const PAID_PLANS: readonly PlanOffer[] = Object.freeze([
  {
    code: "STARTER", name: "Starter", monthlyUsd: 69, yearlyUsd: 690,
    groupLimit: 10, whatsappConnectionLimit: 1,
    monthlyMessages: 0, unlimitedTextTranslations: true
  },
  {
    code: "TEAM", name: "Team", monthlyUsd: 179, yearlyUsd: 1790,
    groupLimit: 30, whatsappConnectionLimit: 2,
    monthlyMessages: 0, unlimitedTextTranslations: true
  },
  {
    code: "BUSINESS", name: "Business", monthlyUsd: 329, yearlyUsd: 3290,
    groupLimit: 50, whatsappConnectionLimit: 5,
    monthlyMessages: 0, unlimitedTextTranslations: true
  }
]);

export function paidPlanFor(code: string): PlanOffer | undefined {
  return PAID_PLANS.find(plan => plan.code === code);
}
