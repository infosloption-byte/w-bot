# Product research: Group Watch / Smart Alerts (proposal only)

## Example
A vehicle owner joins authorized WhatsApp travel/tour booking groups using their
own account. They choose which groups to monitor. Tour requests can include
departure date/time, origin, destination, vehicle class, offered fare and
contact details. The user configures a preference such as "pickup near Kandy,
destination anywhere, min LKR 20,000, departure within 7 days", and receives
an alert when the extracted request meets those criteria. No message is posted
to the source group by W-Bot in this mode.

This is a different workflow from translation. The current code **does not**
implement alert matching or personal delivery. It can serve as a foundation via
its tenant-scoped customer-owned WhatsApp sessions and group discovery.

## Proposed end-user flow
1. Link the user's authorized WhatsApp account, select explicit groups.
2. Choose **Monitor & alert** for those groups (translation off by default).
3. Create rules per group or across selected groups, with inclusion/exclusion
   keywords, locations and radii, vehicle type, dates, min/max prices,
   message language, quiet hours, and alert frequency.
4. Ingest *new* group messages, parse into structured fields and confidence
   scores using deterministic rules first; use a language model for ambiguous
   natural-language requests. Preserve the original context.
5. Apply rule predicates; deduplicate the same offer forwarded into many groups;
   create a private alert with explanation, source group and permitted message
   permalink. Mark missing price/date as unknown, not guessed.
6. Users can adjust saved searches, snooze, mute, mark irrelevant, and delete
   extracted content/history from their workspace.

## Source-agnostic architecture
`BYON group event -> tenant-authorized group allowlist -> ingest job -> intent
 classifier -> structured field extractor -> rule engine -> dedup + confidence
 -> alert queue -> authorized private delivery channel`

Potential tables: `WatchRule`, `WatchSourceGroup`, `WatchEvent`, `ExtractedOpportunity`,
`AlertDelivery`; index all by tenant and connection. Do not mix workspace data.
Use explicit source-groups selection, TTL, minimal retention, encryption at rest,
and audit logs. Avoid retaining full group chat streams when extracted fields
suffice. Use opt-in e-mail/push/app inbox delivery initially. WhatsApp private
notifications would require a separately permitted outbound messaging flow
and restrictions on contacting users.

## Important legal/technical limits
- Current Baileys linked-device automation is unofficial and can lead to
  WhatsApp restrictions or account bans. It is not an approved large-group
  monitoring API; no guaranteed access to every historical or live message.
- The official WhatsApp Business Groups API is designed for eligible small
  opt-in groups and is not a general reader for arbitrary existing travel groups.
- Monitoring and extracting other participants' phone numbers, itineraries and
  prices requires legitimate authority and appropriate transparency, consents,
  retention controls, and compliance with WhatsApp platform policy and local law.
  WhatsApp specifically warns against unauthorized harvesting of contact details.
- Do not scrape, expose or resell full contact lists; do not auto-message leads,
  evade restrictions or make claims of guaranteed message capture.
- Prefer explicit group-admin cooperation or authorized integrations for a
  commercial deployment; do a compliance review before exposing as a SaaS plan.

## Release strategy
Research with two consented test groups, a small finite set of opt-in users,
and manually annotated sample booking posts. Measure precision, recall, duplicate
alerts, notification delay, missed-message rate, privacy incidents and provider
cost. Launch an in-app/email alerts prototype only after consent and safeguards
are validated. Keep pricing, alert quotas and product mode independent from
the translation subscription until costs are benchmarked.
