# Model C — Customer-owned WhatsApp numbers (personal and business)

Status: **Feature branch only. Not deployed. New customer-number functionality is OFF by default.**
Depends on the existing Model B shared-number work. Do not merge or deploy without database backups, passing Docker builds/tests, and two independent authorized WhatsApp test numbers.

## Scope

Model B: the existing shared W-Bot number and unchanged `wbot_web_auth` volume.
Model C: an additional, isolated `byon-gateway` service and `wbot_byon_auth` volume. Each customer account has its own Baileys linked-device credential directory under a validated connection ID. This is an **unofficial linked-device implementation**, not a Meta-authorized WhatsApp group automation API. Only use for a private, informed pilot.

Customer Portal > **WhatsApp Numbers**:
- Add a personal or dedicated business WhatsApp connection (types can be allowed independently).
- Link through a time-limited QR code or phone-number pairing code, approved on the actual WhatsApp account. Merely entering a phone number never establishes ownership.
- View connection status, a masked phone suffix, and participating groups.
- Request a scoped one-time group activation code. A verified WhatsApp group administrator must send the code in that group; the gateway checks live group metadata, including commands sent from another linked device of the same number.
- Revoke the connection, which immediately disables its group translations and attempts to log out/delete only its dedicated credential directory.

Platform Admin > **WhatsApp Numbers**:
- Master customer-owned numbers switch starts **OFF**.
- Independent Personal and Business switches start ON but do not activate anything until the master switch and gateway are enabled.
- Per-workspace connection count defaults to 1 (range 1–10).
- Monitor workspace, connection type, status, masked phone suffix and group count. Do not display login credentials, QR secrets, full numbers or private message contents.

## Data and message isolation

`CustomerWhatsAppConnection` belongs to a tenant, with role-guarded customer endpoints and a per-tenant connection quota. `Group` now has a `connectionKey` and a composite unique index `(connectionKey, whatsappGroupId)`. All preexisting Model B groups get `connectionKey='shared'` automatically during the migration, and the original shared gateway continues to use that scope. Model C groups use `connectionKey='byon:<connection id>'`. This allows the same WhatsApp group to be present under distinct authorized connections without colliding, while preventing routing across tenants.

Inbound events enter a separate bearer-authenticated private API and are checked against the authenticated connection's active status, tenant, group, and current platform policy before a message counts toward quota. Outgoing translations use the stored connectionId, not a browser-provided destination or number. The processor rechecks connection and policy immediately before sending. Group activations are bound to a tenant **and** a connection, then consumed once in a transaction with the tenant's group limit lock. Shared group activation refuses a connection-bound code.

## Safe rollout

1. **Backup MySQL and Lightsail snapshot.** Do not restart or delete the existing `web-gateway`, `wbot_web_auth`, or `wbot_mysql` volumes. Never use `docker compose down -v`.
2. Pull the feature branch and build **without restarting**:

       cd /opt/apps/w-bot
       git fetch origin
       git switch feature/model-c-customer-whatsapp-connections
       sudo docker compose --profile byon --profile web --profile portal build api byon-gateway portal

   Stop if any build fails. The API build regenerates Prisma Client and runs tests; the gateway tests run as part of the gateway Docker image build.

3. Generate a **unique** secret (do not paste it into chat):

       openssl rand -hex 32

   In `.env` set:

       BYON_GATEWAY_ENABLED=true
       BYON_GATEWAY_TOKEN=<unique 64-hex secret>
       BYON_GATEWAY_URL=http://byon-gateway:9039

   Keep the shared `WEB_GATEWAY_TOKEN` unchanged and never expose internal ports 9028, 9029, 9039, MySQL 3306, or the customer portal's loopback port to the public internet. The BYON gateway has no public host port.

4. **Only after verified backups and passing builds:** apply the forward-only migration `20261030000400_model_c_connections` by recreating the API during a maintenance window. This changes the group's unique index. Verify all existing groups and Model B translations before enabling Model C.

       sudo docker compose --profile byon --profile web --profile portal up -d --no-build api byon-gateway portal

   Do not recreate `web-gateway`: it continues using its original connected session.
   Confirm API and portal health, and inspect API/gateway logs for health without exposing credentials.

5. Open Platform Admin > WhatsApp Numbers. Confirm all customer types are disabled by the **master switch**. Enable only after a controlled test, and consider starting with dedicated business numbers.
6. Customer signs in, opens WhatsApp Numbers, selects Personal or Business, creates a connection, and links it from their phone in WhatsApp > Linked devices.
7. Check a group-admin activation code, a six-language translation, and a subsequent message. Verify Customer A and B with distinct numbers cannot see each other's pairing state or groups.

## Acceptance checklist

- Model B shared number and existing group IDs continue to work after migration.
- Two customer workspaces can connect different numbers simultaneously without auth overlap.
- A customer cannot read a foreign tenant's QR, request pairing, modify policy, claim group, or revoke connection.
- A customer must control the WhatsApp account through QR/pairing approval; a typed number alone cannot activate it.
- Group admin validation is based on fresh metadata, not a self-asserted client property.
- A group appearing in two linked accounts is scoped by `connectionKey` and outbound replies use the same account that ingested its message.
- Switch **Personal OFF**: existing personal connections stop accepting and sending translations; Business remains allowed. Reverse the switch and verify Personal works again. Master OFF blocks both; shared Model B remains unaffected.
- Revoke a customer session and confirm its group translations stop immediately. Verify the shared auth volume is unchanged.
- The portal never exposes auth file contents, logs never contain QR or pairing codes, and browser responses are no-store.
- Observe app memory/CPU with multiple Baileys sockets. Limit active sessions and ensure enough server resources.

## Limitations

Personal accounts may expose broader conversations to the linked client even if W-Bot only chooses configured group messages. **Use a dedicated account wherever possible** and disclose this access to participants. Baileys is unofficial; linking may lead to instability, restrictions or loss of access. Group automation through Meta's official platform is a separate integration with different eligibility and functionality. This pilot has a per-process socket manager rather than distributed orchestration, and no guarantee of exactly-once inbound delivery. Commercial use requires consent, retention, monitoring, recovery, queue scaling and independent security review.

## Customer-owned account translation and responsive onboarding fixes (2026-10-31)

A successful Model C user pilot revealed three UX/behavior gaps, now addressed in the feature branch:

1. **Messages sent by the linked account:** BYON must not blindly ignore \`fromMe=true\` because the customer's WhatsApp account is also used by a human. New live \`notify\` text messages posted by that account to authorized groups now enter the tenant-scoped translation pipeline. Message history, DMs, old "append" events, bot-generated "🌐" translation replies, known activation responses, and cached outbound bot message IDs remain excluded to prevent loops. No change to the shared Model B gateway, which still excludes its own messages.
2. **My Groups:** Customer Portal loads groups again when opening Overview or My Groups and refreshes automatically while the page is visible (15-second cadence). A manual Refresh groups button is provided. Each group displays whether it uses Shared W-Bot, a Personal number, or a Business number, with connection label and masked phone suffix. BYON group activation already persists tenant membership; its historical omission from the UI was stale frontend state.
3. **Pairing usability:** WhatsApp Numbers now provides a three-step flow; separate QR and phone-number code tabs; code/QR expiry guidance; account cards and connection statuses; group discovery and activation copy action; and a shortcut to My Groups. CSS has mobile, tablet and desktop breakpoints, plus improved Platform Admin control/table responsiveness.

**Rollout note:** Update all three images \`api\`, \`byon-gateway\` and \`portal\` and deploy with unchanged environment variables and DB volumes. This is a code-only update: no new Prisma migration. The connected account's Baileys auth directory must be preserved; do not remove or reset \`wbot_byon_auth\`. Validate on a test account: another member's message translates, owner's ordinary group message translates once, W-Bot does not translate its own generated reply, a newly activated group appears on My Groups within 15 seconds and on manual refresh, QR/code switching works, and 375px/768px/1024px layouts do not horizontally overflow.

**Build gate:** Gateway routing and web contract tests were added, but Docker builds and actual WhatsApp verification still need to pass on Lightsail before considering PR merge.
