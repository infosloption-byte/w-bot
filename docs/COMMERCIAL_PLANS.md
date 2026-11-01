# W-Bot subscription catalog (effective proposal 2026-11-01)

## Published commercial tiers (USD)
| Plan | Monthly | Annually prepaid | Linked WhatsApp numbers | Registered group slots | Text translations |
| --- | ---: | ---: | ---: | ---: | --- |
| STARTER | $69 | $690 | 1 | 10 | Unlimited |
| TEAM | $179 | $1,790 | 2 | 30 | Unlimited |
| BUSINESS | $329 | $3,290 | 5 | 50 | Unlimited |

Annual billing gives the equivalent of two months free (10 monthly payments for 12 months).
All plans can use all platform-enabled target languages subject to the per-group
language UI ceiling. Audio/STT/TTS is not included in these tiers.

## Behavior and source of truth
- `src/plans.ts` is the single source of commercial plan prices/limits.
- Public `GET /portal/api/plans` returns the catalog, USD cents, and
  `billingEnabled:false`. This is a price **display**, not payment checkout.
- Platform Admin > Customers > Manage plan offers catalog choices plus MONTHLY
  / YEARLY and status. Selecting a commercial plan applies canonical server limits,
  ignoring client-supplied quota overrides. No Paddle products/webhooks are present.
- Existing `PILOT` workspaces retain their manually configured groups/numbers until
  explicitly assigned a commercial plan. No existing paid charges are inferred.
- Activating or creating new groups counts registered workspace groups, including
  paused ones, toward slots. To reclaim a group slot, disconnect the group.
- New customer-owned numbers count only active connection records; revoked/pending
  removal records do not consume slots. Global platform policy may further restrict
  number counts or types. Gateway runtime capacity `BYON_MAX_SESSIONS` is separate.
- To avoid silently interrupting existing groups/accounts, plan assignment is
  rejected (HTTP 409) when the workspace currently exceeds the candidate limits.
- Ingest no longer enforces a paid `monthlyMessages` threshold. Existing message
  deduplication, subscription ACTIVE/TRIAL checks, group/tenant allowlists, per-message
  size limits, and monthly **usage metering** remain.
- Legacy `TenantSubscription.monthlyMessages` is retained for schema compatibility
  and existing data but ignored in translation quota enforcement.

## Rollout
1. Commit remains on Draft Model C PR. Keep the public payment actions disabled.
2. Back up MySQL and take an instance snapshot.
3. Review `20261101000100_commercial_plan_intervals`, rebuild API and portal images;
   run Prisma migration status and verify regression tests in disposable images.
4. Update only the API and portal services. No shared/BYON WhatsApp gateway image
   changes are required for these plan/catalog changes; preserve auth volumes.
5. Log in to Platform Admin, inspect plans and choose a test workspace.
6. Verify price and month/year in customer Activity & Plan, 10/30/50 group
   limits and 1/2/5 number allowances, and unlimited text usage beyond the prior
   monthly message allowance. Confirm other PILOT workspace remains operational.
7. Benchmark provider spend, group behavior and per-number gateway resources
   before advertising unlimited text as commercially guaranteed.

**No automated billing is wired here.** A product price in the catalog does not
create Paddle items, checkout links, payments, renewals, receipts or billing status.
