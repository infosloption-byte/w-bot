# Smart Alerts — universal AI search and multi-group monitoring

## Independent pipelines
- Shared customer account, portal, and already linked WhatsApp sessions.
- Translation: authenticated group message -> existing Group/Message queue -> translation -> reply, unchanged.
- Smart Alerts: authenticated customer gateway event -> explicitly opted-in WatchGroup(s) -> WatchEvent queue -> standalone AI classifier -> AlertMatch -> private inbox. It never sends group replies or affects translation quota, provider, or subscription.
- Customers can buy/use the two features independently. Smart Alerts still has no Paddle checkout; only Platform Admin can provision an Alerts pilot.

## Current development status
Feature branch: `feature/smart-alerts-universal-ai-rules-multigroup-20261101`.
This change requires `20261101000400_universal_ai_alerts` database migration and **has not been deployed**.

## Customer experience
1. Open Smart Alerts and select one of the active customer-owned WhatsApp sessions (no new pairing).
2. List its joined groups. Search, select multiple groups, confirm authority and participant notice, and activate all selected groups atomically. An active group cannot be selected a second time. Group counts are workspace-wide; pauses and removals remain independent per group.
3. Create a search with a name plus 1–12 unique user-defined label/value criteria; add/remove rows dynamically. No industry categories, fixed location/price fields, or keyword requirements.
4. Existing old keyword rules continue working, and can be converted by editing; arbitrary new labels support travel, property, recruitment, retail, logistics, professional services, and other use cases.
5. Every new message is interpreted in its original language in isolation. Model output must satisfy **all** labeled requirements, confidence >= 0.8, and give a verbatim supporting excerpt for every field. Missing or ambiguous information is rejected rather than fabricated. This is probabilistic classification, not guaranteed accuracy.
6. Matching alerts appear only in the private inbox; no group posts, automatic messaging, cold outreach, or outbound notifications.

## Data protection and limits
- ONLY an opted-in selected group attached to a connected authorized customer session is monitored, subject to per-tenant and group/connection policy checks.
- Inform group participants and obtain appropriate permissions before enabling third-party Gemini analysis. The original message text is sent to Gemini only after explicit opt-in. Do not use for confidential or restricted messages without authorization.
- Raw source messages are removed from the WatchEvent queue after processing; saved alert excerpts/contacts are purged by the existing 14-day event retention.
- New `AlertUsage.analyses` is independent of `AlertUsage.matches`. The `AlertSubscription.maxAnalysesPerMonth` default is 500 API requests (not 500 total messages when a message has many rule batches). Every attempted AI call reserves an atomic monthly allowance first; retries are billable analyses for cost control. When exhausted, no more AI analysis is performed. Workspace admins can review both counts in the portal.
- Prompt-injection-resistant system instruction, strict JSON response validation, verbatim evidence checks, no model-created contact numbers, isolated failure handling, tenant-scoped database queries, and idempotent event/rule matches. Nonetheless AI can misclassify; confirm original messages before taking action.
- Existing linked-device integration uses unofficial Baileys and can disconnect or be restricted.

## Enable only after build/test and approved group consent

Environment settings for the W-Bot API's `.env`:

```env
# Separate AI classifier, OFF unless explicitly enabled
ALERTS_AI_ENABLED=true
# Uses GEMINI_API_KEY if a dedicated key is omitted
# ALERTS_GEMINI_API_KEY=<dedicated key>
# Optional; defaults to GEMINI_MODEL
# ALERTS_GEMINI_MODEL=gemini-3.5-flash-lite
```

Do **not** share API keys or private group content in logs. Setting `ALERTS_AI_ENABLED=true` requires a valid Gemini key. The classifier is independently configured from TRANSLATION_PROVIDER, so changing this flag does not change translation settings.

Deployment procedure:
1. On Lightsail, back up MySQL and preserve both WhatsApp gateway authorization volumes.
2. Build both API and portal; Docker API builder executes TypeScript compilation and all backend tests before export. Do not deploy if any test fails.
3. Apply migration in order via `docker compose run --rm --no-deps api npx prisma migrate deploy` and verify status.
4. Configure `ALERTS_AI_ENABLED=true` for an authorized pilot; rebuild if needed, then recreate only `api` and `portal` with `--no-deps --no-build`. No need to recreate/re-pair gateway containers.
5. Verify /healthz, /readyz, existing translation regression, and a consenting test group with two new messages (formatted/unformatted) against generic label/value rules. Verify private inbox, no automatic group replies and independent AI usage counts.
6. Scale gradually and monitor API spend, latency, retries, false positives and privacy feedback.

Planned future work: source-linked preview, confidence feedback, improved language/date/quantity normalization, queue/notification observability, opt-in email and push delivery, per-group custom rules, customer checkout/billing, and production-scale AI-cost governance.
