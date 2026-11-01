# Pricing consolidation and Smart Alerts integration

Consolidated: 2026-11-01. This document reconciles the older commercial pricing PR with the newer Model C subscription implementation and the separately licensed Smart Alerts MVP.

## Canonical translation subscriptions

| Plan | Monthly (USD) | Yearly (USD) | Customer-owned numbers | Translation group slots |
| --- | ---: | ---: | ---: | ---: |
| Starter | 69 | 690 | 1 | 10 |
| Team | 179 | 1790 | 2 | 30 |
| Business | 329 | 3290 | 5 | 50 |

Annual billing is priced at ten monthly installments. All commercial tiers offer unlimited text translation *message counts* subject to fair-use constraints, security and provider throughput. The existing Model C **src/plans.ts** is the single source of commercial prices and limits. Do not use the older src/plan-catalog.ts implementation from the superseded PR.

Subscription activation remains a Platform Admin assignment, not proof of a payment. Paddle and self-service checkout are **not** integrated. TenantSubscription.billingInterval is persisted by migration 20261101000100_commercial_plan_intervals. The historical monthlyMessages field is not used to enforce a translation message quota. Do not reintroduce the outdated monthlyMessages=0 sentinel approach from the old pricing branch.

## Separate Smart Alerts subscriptions

Smart Alerts is a separately licensed service with its own AlertSubscription, monitored-group limits, rule limits, monthly match limits, independent queue, and private inbox. One workspace login and customer-owned WhatsApp connections are shared, with independent entitlement checks for either service.

The currently merged Smart Alerts MVP uses deterministic keyword/location/price/contact matching. It is not a production AI extraction service and does not yet send email, push, or outbound WhatsApp alerts. Prices for Smart Alerts have **not** been finalized; do not silently bundle it into translation pricing or claim an automatic payment.

Monitor only explicitly selected authorized groups with appropriate participant notice/consent. No private chat scraping, automatic group joining, bulk contact export or lead outreach. Baileys is unofficial and is not a guaranteed WhatsApp commercial integration.

## Merge resolution

This document and frontend CI build are the useful non-conflicting contributions retained from the older PR #4. Current Model C and Smart Alerts API, database, UI, and entitlement implementations are preserved rather than overwritten by the earlier conflicting versions. All original PR commits remain reachable in Git ancestry.

## Before live deployment

- CI must actually execute and pass backend tests and both frontend builds. GitHub Actions previously returned startup_failure before running jobs.
- Back up MySQL and the Lightsail instance. Preserve WhatsApp linked-device auth volumes.
- Review and apply the ordered Prisma migrations in staging, including commercial plans and Smart Alerts.
- Test separate translation/alert entitlements, tenant isolation, group monitoring consent, customer session reconnects, and translation regression before deploying.
