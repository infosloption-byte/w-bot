# W-Bot commercial tier catalog and Smart Alerts proposal

Status (2026-11-01): commercial catalog and admin-assigned plan enforcement implemented on the pricing feature branch; **Smart Alerts is a design proposal only, not an implemented or deployed feature**. No self-service billing provider is integrated.

## Agreed plans (USD)

| Plan | Monthly | Annually | Linked WhatsApp numbers | Monitored/translated groups |
| --- | ---: | ---: | ---: | ---: |
| Starter | $69 | $690 | 1 | 10 |
| Team | $179 | $1,790 | 2 | 30 |
| Business | $329 | $3,290 | 5 | 50 |

Annual pricing is equivalent to ten paid months. All commercial tiers have unlimited **text translations** (no monthly inbound text-message quota); abusive usage, unusually large content, provider costs and delivery throughput still require fair-use protection. No audio/video promises are included.

The API and UI use the canonical catalog. In TenantSubscription, `monthlyMessages = 0` represents unlimited text message *count*. Even for unlimited plans, TenantUsage records message volumes. The commercial group and linked-number limits are enforced by the existing tenant-scoped group/connection flows. Custom PILOT subscriptions keep their previous finite allowances. Assigning a paid plan is currently a Platform Admin operation and does not charge customers. Future checkout/webhooks must bind validated payment status and billing period to entitlement changes; do not activate subscriptions from a frontend success redirect.

### Deployment and verification
1. Review and build the feature branch, run `npx prisma generate`, `npm run build`, `npm test`, and `cd frontend && npm install && npm run build`.
2. No Prisma migration is required for the pricing update; the existing signed integer fields support the new sentinel and positive limits.
3. Take a MySQL backup and a Lightsail snapshot; preserve every linked-device auth volume.
4. Deploy API and portal together, then check a pilot tenant remains quota-limited and a new paid-tier tenant counts unlimited messages correctly.
5. Verify the customer Activity page and Platform Admin tenant plan modal show the published catalog. Confirm no checkout appears while billing is disabled.

## Smart Alerts — product concept

### Example
A driver opts into monitoring three existing tour-booking WhatsApp groups. They configure a rule: departure from Kandy, destination Ella or Nuwara Eliya, within a user-specified date range, minimum offered fare LKR 12,000, and vehicle type van. A group member posts a new tour request with origin, destination, date, fare and contact information. The engine extracts fields, evaluates the rule and sends the driver a private alert with a concise summary and a link/reference back to the matching source message where supported. If no phone number is in the content, the alert must not fabricate one.

### Reusable pipeline
```text
Customer's opted-in WhatsApp connection → selected allowlisted groups
 → authenticated incoming event → sender/group/tenant validation
 → deduplication → cheap keyword/location/date prefilter
 → structured AI extraction (only where needed)
 → deterministic per-tenant matching → confidence threshold
 → short-lived result record → private notification channel
 → user opens original WhatsApp conversation
```

Extraction schema for the tours example: `intent`, `departureLocation`, `destination`, `dateTime`, `timezone`, `quotedPrice`, `currency`, `vehicleType`, `contactNumber`, `sourceGroupId`, `messageId`, `confidence`, `extractionWarnings`. Treat absent or uncertain values as null. Date interpretation must distinguish message time, requested departure time, and 'tomorrow'/relative terms in the source's timezone.

Generic `AlertRule` should specify a saved natural-language query and optional filters: topic/category, include/exclude terms, location, distance (where reliable), date/time window, numeric min/max, currency, required fields, language, selected group IDs, confidence threshold and notification method. Support multiple rules per customer and multiple customer-owned WhatsApp connections. Rule matching must not cross tenant boundaries.

### Security and consent
- Monitor only groups the linked account already belongs to **and** the customer explicitly selects. Do not automatically enroll every chat, access unrelated DMs, or scrape contacts.
- Obtain informed permission appropriate to group participants and local privacy law. Show group-monitoring state, allow pause/disconnect/erase, minimize stored excerpts and contact details, encrypt linked-device credentials, use strict tenant isolation and short retention.
- Treat incoming text as untrusted data; never allow messages to change search rules, request credentials, or trigger automatic outbound replies.
- Suppress duplicate opportunities across groups, cap alerts per rule, offer quiet hours and easy opt-out. Alert messages must be private and not posted to the watched group.
- Set clear terms: Baileys is an unofficial linked-device integration, may violate WhatsApp terms, and may be blocked or disconnected. No guaranteed reliable commercial service or blanket access to groups should be advertised.
- Meta's official Groups API is a restricted, invite-based small-group API and does **not** let a customer read arbitrary pre-existing large personal WhatsApp groups.

### Implementation stages (not yet done)
1. Tenant-scoped `AlertRule`, `AlertMatch`, `AlertDelivery`, `GroupMonitor` data models, roles and quotas; opt-in group UI.
2. Read-only monitored-group ingest on the existing Model C customer gateway; keep it **separate** from the translation and group-reply workflow.
3. Typed extraction and deterministic rule engine; multilingual parsing and tests using synthetic tour messages, fake phone numbers and time zones.
4. Notification dispatcher (email and browser/push first, then opt-in compliant WhatsApp notifications if supported), retry/idempotency, quiet hours, opt-out.
5. Platform-level fair-use, cost controls, audit/privacy review, load tests and pilot with consenting group owners.

Smart Alerts message-processing and notification volume must receive their own entitlement/usage model. The above translation prices do **not** promise unlimited AI monitoring or free alerts.
