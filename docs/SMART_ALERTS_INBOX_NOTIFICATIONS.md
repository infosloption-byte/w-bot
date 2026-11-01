# Smart Alerts — detailed inbox and optional WhatsApp delivery

## Scope and safety

- No changes to translation group handlers, quotas, subscriptions, or translation delivery.
- All matches continue to be stored in the customer-specific in-app inbox first.
- Customers can filter matches by group, saved search, read/unread state or message text; list is paginated (50 per page).
- Detail view contains source group, timestamps, source-message excerpt (500 chars), contact, stored search conditions, read status and notification delivery state. Older matches predate criteria snapshots and cannot recover original text already deleted.
- Original group-message content is never permanently retained beyond existing retention. Match summaries/contacts and notification logs are deleted when their parent WatchEvent expires after 14 days.

## Opt-in WhatsApp destination

This feature **does not automatically create a WhatsApp group or add any contacts**.
The customer creates a separate private group using the linked account in the WhatsApp application (with other authorized participants), then selects it under **Smart Alerts → Overview → WhatsApp alert group**.
The customer must confirm that every destination-group participant is authorized to see alerts, excerpts, and phone numbers.

The selected group:
- Must be present in the customer-owned connected account's live WhatsApp joined-group list.
- Cannot be a Translation or monitored-group source anywhere within the same W-Bot workspace.
- Must be backed by an active Smart Alerts subscription, enabled feature, allowed WhatsApp connection and an enabled BYON gateway.
- Defaults to OFF for existing/new customers. Enabling sends **new** matches only; no historical bulk replay.
- Can be changed or disabled. Old queued destinations are canceled, not redirected.
- Receives a short notification: search name, original source group, match time, saved excerpt, optional extracted contact and a direction to open the private inbox.
- Does not receive raw session credentials or hidden WhatsApp message metadata.

## Delivery reliability

A new AlertDelivery record is written transactionally with a successful new match when a channel is enabled. A separate 4-second worker checks entitlements and channel policy again, then calls an authenticated isolated BYON `/connections/:id/notify` action.

The outgoing message is rate-limited to at most two per cycle by this worker. A gateway success records its outbound message ID. A timeout, lost acknowledgement, API failure, or process crash during sending is deliberately labeled UNCERTAIN and **not retried automatically**, because WhatsApp may already have posted the message. Both SENT and UNCERTAIN are visible in the inbox detail. The inbox remains the source of truth for every match.

Caveats: This uses a customer-owned Baileys linked-device session, **not** the official Meta group API. WhatsApp may disconnect or restrict unofficial automation. Only authorized, informed groups should be used, and a dedicated account is recommended.

## Database and deployment

Migration: `20261101000500_alert_delivery_and_inbox_details` adds a nullable AlertMatch.criteriaSnapshot, a nullable-by-default customer notification channel, and an independent AlertDelivery queue. Translation and existing Smart Alerts data are not modified by DML.

On Lightsail:

1. Build and validate **API, portal, and byon-gateway** on the feature branch, without recreating running services.
2. Back up MySQL (verify gzip) and preserve BYON auth volumes. Optional Lightsail instance snapshot.
3. After build passes and the PR is merged, pull main and rebuild three images.
4. Apply `docker compose run --rm --no-deps api npx prisma migrate deploy`.
5. Recreate **api portal byon-gateway only** with `--no-deps --no-build` and the required `--profile portal --profile byon`. The BYON linked session may briefly reconnect, but its auth volume must be preserved. Do not restart the shared translation web-gateway.
6. Check `/healthz`, `/readyz`, API/gateway logs and one translation regression.
7. In customer portal, create the dedicated group manually from WhatsApp, choose it in Smart Alerts, accept the destination sharing notice, and enable notifications.
8. Post two matching test messages and one nonmatch to a **different, authorized monitored group**, verify the in-app inbox results, notifications for the two matches only, delivery state, filters and detail drawer.
9. Pause Smart Alerts and confirm no further notifications. Change or disable destination and verify queued unsent notifications are canceled.

No payment checkout is implemented by this change.
