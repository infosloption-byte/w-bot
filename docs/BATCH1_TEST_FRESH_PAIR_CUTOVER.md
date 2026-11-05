# Batch 1 — Disposable test session: fresh encrypted pairing

**Scope:** W-Bot's existing BYON connection is a disposable TEST connection (operator confirmed 2026-11-05). This is an alternative to the full production migration described in [BATCH1_SESSION_VAULT_RUNBOOK.md](./BATCH1_SESSION_VAULT_RUNBOOK.md).

**State:** Instructions prepared. NOT executed against production. No backups, migrations, revocations, or service restarts have been performed by the repository changes.

## Why this is shorter

The current legacy auth volume contains 1 test session and 475 JSON records (~2.1 MiB). The owner accepts losing this disposable linked-device session. It is therefore unnecessary to:
- make a recoverable off-server copy of its 475 plaintext Signal/auth records;
- run `byon-vault-migrate --inventory/--migrate/--verify`;
- preserve the test linked-device session or avoid re-pairing the WhatsApp account.

**Do not confuse this waiver with a production security control.** For REAL customers, encrypted vault backup/restore testing, IAM review, operational recovery, and migrating sessions when continuity is needed remain mandatory release gates. Skipping migration of the test session also means **the migration utility has only been unit-tested**, not exercised against the actual 475 records.

## Hard requirements (even for test accounts)

1. KMS GenerateDataKey/Decrypt round-trip must pass with the intended restricted identity (PASSED 2026-11-05).
2. Both Compose files and vault-only mount override must be used for the new gateway; no `/data/auth` mount in KMS mode (mount preflight PASSED 2026-11-05; production activation untested).
3. Delete the disposable test connection in the **customer portal while the OLD gateway is still running**; do not bypass the API or delete database rows manually. The portal removal command tries WhatsApp logout, revokes the connection, and removes group associations.
4. Confirm the portal reports **permanently removed**, not `pending`. An inconclusive unlink is a STOP condition. Independently remove the corresponding linked device from WhatsApp on the phone; a server-side credential deletion cannot guarantee revocation of a copied token.
5. Only THEN stop the existing customer-owned `byon-gateway`; don't stop API, MySQL, customer portal, or shared WhatsApp gateway.
6. Start the rebuilt gateway with the encrypted vault overlay. Only then create and pair a NEW customer connection (a new connection ID, not reuse stale database state).
7. Verify vault-only mount, encrypted records, reconnection after restart, Translation, Smart Alerts monitored groups, alert destination, and sending permissions.

**Data loss expected:** deleting the test connection also deletes its registered Translation groups and their stored messages; Smart Alerts monitored-group rows/events are cascaded by the database. Smart Alerts rules may remain but must be checked; notification channel configuration tied to the former connection may require resetting. This is NOT a non-disruptive customer migration.

## Step A — Non-disruptive preparation; safe while old gateway runs

```bash
cd /opt/apps/w-bot || exit 1
git switch main && git pull --ff-only origin main

# Print no resolved environment values or secrets.
sudo docker compose -f docker-compose.yml -f docker-compose.byon-vault.yml config -q

# Rebuild the same BYON service with the KMS-capable code and Compose overlay.
# This BUILD does not restart/stop a running container.
sudo docker compose -f docker-compose.yml -f docker-compose.byon-vault.yml \
  --profile byon build byon-gateway

sudo docker compose --profile byon ps byon-gateway
```

Expected: encrypted-image build passes its tests and legacy gateway is still running.

## Step B — Deliberately revoke and remove the OLD test connection via customer portal

Open **WhatsApp Connections → Connected Accounts** in the W-Bot customer portal. For the one disposable TEST connection, click **Remove** → **Remove permanently**.

**STOP** unless the portal confirms the connection is permanently removed. If it reports `pending`, resolve cleanup before proceeding; the API deliberately leaves revoked records for retry when gateway access fails. A connected account flagged CONNECTED in the database will otherwise be bootstrapped by the encrypted gateway and fail to open because no migrated vault exists. Avoid `DELETE` or `UPDATE` SQL on the database.

Also open the *official WhatsApp application* on the test phone → **Linked devices**, find the W-Bot linked device, and log it out. This is account-level revocation; do NOT delete your WhatsApp account.

Expected: no active old test connection in W-Bot and no associated linked device in WhatsApp. You will need to recreate opted-in groups and Smart Alerts sources/destination afterward.

## Step C — Switch ONLY the BYON gateway to KMS mode

This step temporarily interrupts test Translation / Smart Alerts on this customer-owned connection.

```bash
cd /opt/apps/w-bot || exit 1

# Stop only the customer-owned gateway; other platform services remain running.
sudo docker compose --profile byon stop byon-gateway

# Confirm .env still has valid BYON_KMS_KEY_ID and
# BYON_KMS_CREDENTIALS_FILE; do not display or share their values.
# Persist the mode in .env so starting WITHOUT the overlay fails closed.
sudo nano .env
```

Set the following (replace an existing BYON_AUTH_MODE entry rather than duplicating it):

```dotenv
BYON_AUTH_MODE=kms
```

Do NOT modify DATABASE_URL, BYON_GATEWAY_TOKEN or other services.

```bash
sudo docker compose -f docker-compose.yml -f docker-compose.byon-vault.yml config -q

sudo docker compose -f docker-compose.yml -f docker-compose.byon-vault.yml \
  --profile byon up -d --no-deps --no-build --force-recreate byon-gateway

sudo docker compose -f docker-compose.yml -f docker-compose.byon-vault.yml \
  --profile byon ps byon-gateway

# Verify actual mounts: /data/vault and the KMS file secret should exist.
# /data/auth or /data/legacy-auth MUST NOT be present.
sudo docker inspect w-bot-byon-gateway-1 \
  --format '{{range .Mounts}}{{println .Destination}}{{end}}'
```

If the gateway fails to start, STOP. Do not automatically switch back to plaintext auth. Inspect redacted gateway logs and Compose config first. A fresh pairing is authorized, but migration, plaintext fallback and live-session export are not.

## Step D — Create a fresh encrypted TEST WhatsApp connection

In the customer portal, use **WhatsApp Connections → Add Account**, create a new connection, then go to **Pairing & Reconnection**. Pair through QR or phone pairing code using your test WhatsApp account.

Do not reuse a deleted connection ID or directly edit database status. Check the new connection becomes **Connected** and that the desired group(s) can be discovered.

Re-activate Translation groups with consent and recreate Smart Alerts monitored groups and notification destination as needed.

## Step E — Verify encrypted persistence and reconnect

Check counts and file naming **without displaying credential contents or connection IDs**:

```bash
sudo docker compose -f docker-compose.yml -f docker-compose.byon-vault.yml \
  --profile vault-migrate run --rm --no-deps --entrypoint sh byon-vault-migrate \
  -c 'set -eu
    echo "Encrypted auth record count:"
    find /data/vault -type f -name "r-*.enc" | wc -l
    echo "Unexpected legacy credential files in encrypted vault:"
    find /data/vault -type f -name "creds.json" | wc -l'
```

Expected: at least one encrypted record and **zero** legacy `creds.json` files.

With the test number paired and connected, restart ONLY the vault gateway:

```bash
sudo docker compose -f docker-compose.yml -f docker-compose.byon-vault.yml \
  --profile byon restart byon-gateway

sudo docker compose -f docker-compose.yml -f docker-compose.byon-vault.yml \
  --profile byon ps byon-gateway
```

Verify the WhatsApp connection automatically returns to Connected **without another QR scan**. Then test:
- authorized group discovery and consenting Translation;
- sample multilingual group messages, translated replies, and no duplicate replies;
- Smart Alerts rules and monitored groups, inbox matches and the configured notification destination;
- portal visibility and continued tenant isolation.

## Step F — Follow-up security gates

- **DO NOT delete the legacy auth volume during this test switch.** After the encrypted test has worked and the old WhatsApp linked device is confirmed logged out, inspect/retire the old plaintext volume separately. The old volume remains sensitive even when the test is disposable.
- Validate IAM and KMS key-policy least privilege, denial of unrelated keys/contexts, and monitoring BEFORE real customer onboarding.
- Test encrypted vault backup + restore in isolation BEFORE onboarding real customer sessions.
- The legacy migration procedure stays unverified on real records; require a full, reviewed migration if existing customer auth state is ever preserved during a future cutover.
- Keep `BYON_AUTH_MODE=kms` and always use BOTH Compose files for future BYON gateway operations.
- Update GitHub security Issue #19 with confirmed outputs and results; do not post QR codes, secrets, phone numbers, connection IDs, or private messages.

**Completion criterion:** new test WhatsApp connection pairs into the encrypted vault, survives a gateway restart, works with Translation and Smart Alerts, and no plaintext auth credentials are mounted/written by the KMS gateway.
