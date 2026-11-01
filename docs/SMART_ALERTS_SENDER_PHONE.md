# Smart Alerts: original WhatsApp sender phone

## Customer request
Show the actual WhatsApp **sender** phone number for a matching group message in both
the private Smart Alerts inbox and dedicated WhatsApp alerts group.

This is NOT necessarily the same as a booking/contact number typed inside the message.
Preserve both independently:
- `Message sender (WhatsApp): +9477...` — derived solely from authenticated WhatsApp message key or verified PN/LID mapping.
- `Contact shared in the source: ...` — literal number extracted from message text, if present.

Do **not** infer a sender's phone from booking text, LID digits, group ID or the AI classifier.

## Processing pipeline
1. Customer-owned BYON gateway receives a live group message and retains the existing translation/Smart Alerts routing.
2. New `resolveSenderPhone` checks the linked owner's PN for `fromMe`, incoming PN JIDs, Baileys `participantAlt`, or an unambiguous LID mapping from WhatsApp group metadata. Metadata lookups have a bounded 1.5-second timeout. If no valid PN is provided, sender number is null, not guessed.
3. Existing authenticated internal BYON endpoint validates `senderPhone` as optional E.164-style digits with leading `+`.
4. Smart Alerts alone persists `WatchEvent.senderPhone`, separate from its raw message and from `AlertMatch.contactNumber`.
5. The tenant-scoped inbox list/detail endpoints expose `event.senderPhone` and display it separately from any contact typed in message text.
6. New dedicated WhatsApp notifications include the line `Message sender (WhatsApp)`, or `Number unavailable` when the PN identity is hidden. The message-text contact remains distinct.

## Privacy and retention
- The sender number is displayed only inside the customer's authenticated, tenant-scoped Smart Alerts inbox and the explicitly opted-in WhatsApp alert group. Members of the destination group can see it; customers should select participants accordingly.
- A privacy-preserving WhatsApp `@lid` is **not a phone number**. When WhatsApp doesn't disclose a verifiable PN, do not guess, reverse-engineer or substitute the contact number in the message.
- Source `WatchEvent` and matching alerts are already purged after 14 days using the existing retention worker. Do not log phone numbers, sender JIDs, message text, or metadata.
- Historic matches were created without the `senderPhone` column, so they remain unavailable. New fields apply **to new messages after deployment**.

## Deployment
This is a database + API + frontend + customer-owned gateway update, but there is no translation worker change. Do not deploy before a successful three-image build and tests.

1. Build the feature branch with `sudo docker compose -p wbot-sender-validation --profile portal --profile byon build api portal byon-gateway`. No running services are replaced.
2. After PR merge, take/verify a current MySQL backup and preserve the BYON gateway auth volume.
3. Pull main, build production images, apply Prisma migration `20261101000600_smart_alert_sender_phone`, then recreate only `api portal byon-gateway` with `--no-deps --no-build`. Connected BYON session may briefly reconnect.
4. Verify API health/readiness, original group Translation regression and current gateway session state.
5. Post new matching messages from two group participants (one with PN, one only LID if possible), including a message that contains a *different* contact number. Verify exact sender number or explicit unavailable text, separate contact, and correct tenant-only inbox/WhatsApp delivery.
