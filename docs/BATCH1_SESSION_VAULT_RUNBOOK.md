# Batch 1 — Encrypted WhatsApp Session Vault

**Status: code in review (PR #18); migration and live deployment not yet performed.**
Master tracker: https://github.com/infosloption-byte/w-bot/issues/19
Do not mark production complete until the acceptance checklist below is satisfied.

## Security architecture

This batch replaces the plaintext Baileys multi-file auth state with an encrypted, fail-closed storage adapter:

- Independent random 256-bit AES-GCM data key for EACH customer connection.
- AWS KMS GenerateDataKey wraps each key; only the KMS ciphertext is written. Key ARN is pinned. KMS encryption context is: app=wbot, purpose=customer-whatsapp-auth, connectionId=the opaque connection ID.
- Every auth record (including credentials and Signal keys) is encrypted with a fresh 96-bit nonce, 128-bit tag, and authenticated associated data bound to its connection and record name.
- Hashed record filenames; 0700 directories; 0600 files; atomic writes and fsync.
- Corrupted, missing, swapped, or otherwise undecryptable auth state FAILS CLOSED. Bootstrap cannot create a new session on an existing connection.
- OFFLINE migration copies and verifies every original JSON record into staging and atomically publishes a complete vault. Original source is never modified.
- New gateway mounts only encrypted vault, never the old plaintext volume. Old auth is read-only in the one-off migration container.
- KMS credentials are provided as a file secret, not through the gateway environment or repository.

This implementation is a single-worker, file-backed session vault. It is not yet a horizontally scalable database-backed key store; multiple simultaneous gateways for the same connection are unsupported. Baileys recommends a persistent SQL/NoSQL store for larger deployments. This is encryption at rest, NOT an assurance against compromise of the authorized gateway process, host Docker administrator, or KMS credentials. Those require further security batches.

## AWS KMS preflight (must be done by operator)

1. Create a customer-managed symmetric KMS encryption key in the selected AWS region and record the FULL key ARN, not a movable alias. Enable key rotation. Monitor AWS CloudTrail KMS calls and protect the key from deletion.
2. Create a dedicated least-privilege principal permitting only kms:GenerateDataKey and kms:Decrypt for that key. Add IAM/key-policy conditions for kms:EncryptionContext:app=wbot and kms:EncryptionContext:purpose=customer-whatsapp-auth. Never put a phone number/email in KMS context.
3. Prefer short-lived role-based credentials where supported. For this Lightsail Docker deployment, a restricted AWS shared-credentials file may be used. Avoid admin credentials.
4. Store credentials outside the repo, under a root-only host directory. Compose local-file secrets are bind mounts: file uid/gid/mode are those of the HOST file, not automatically remapped for the container user.

Example IAM permissions (replace every placeholder, and authorize the principal in the KMS key policy):

~~~json
{
  "Version":"2012-10-17",
  "Statement":[{
    "Effect":"Allow",
    "Action":["kms:GenerateDataKey","kms:Decrypt"],
    "Resource":"arn:aws:kms:REGION:ACCOUNT:key/KEY-UUID",
    "Condition":{"StringEquals":{
      "kms:EncryptionContext:app":"wbot",
      "kms:EncryptionContext:purpose":"customer-whatsapp-auth"
    }}
  }]
}
~~~

Recommended Lightsail credential location: /root/wbot-secrets/kms-credentials (AWS shared-credentials format). Use a root-owned 0700 directory, file ownership root:1000 and mode 0440 so the non-root container node user (1000:1000) can read it after bind-mounting, while normal host users cannot traverse the root-owned parent. Provision this file securely; NEVER paste or commit credential values.

~~~bash
sudo install -d -m 0700 -o root -g root /root/wbot-secrets
# Provision /root/wbot-secrets/kms-credentials securely, then:
sudo chown root:1000 /root/wbot-secrets/kms-credentials
sudo chmod 0440 /root/wbot-secrets/kms-credentials
~~~

In .env add these AFTER provisioning key and credentials:

~~~dotenv
BYON_KMS_KEY_ID=arn:aws:kms:REGION:ACCOUNT:key/KEY-UUID
BYON_KMS_CREDENTIALS_FILE=/root/wbot-secrets/kms-credentials
# DO NOT set BYON_AUTH_MODE=kms before migration succeeds.
~~~

## 1 — Isolated build validation (before merge)

~~~bash
cd /opt/apps/w-bot || exit 1
git fetch origin
git switch --detach origin/security/batch1-encrypted-whatsapp-session-vault-20261104
sudo docker compose -p wbot-vault-validation --profile byon build byon-gateway
git switch main
~~~

The build executes all gateway tests, including encryption/decryption, data corruption, cross-connection isolation, and migration. Stop if it fails. Docker Compose v2.24+ is required for the !override volume directive in docker-compose.byon-vault.yml.

## Non-disruptive KMS credential-mount preflight

Before any migration or gateway stop, validate the **actual Docker runtime mount** using the
same migration image and vault Compose overlay. On 2026-11-05, Docker Compose v5.6.0
accepted the older short-form `tmpfs: [/tmp:rw,noexec,nosuid,size=16m]` during
`config -q`, but container creation failed with
`invalid mount path: 'noexec' mount path must be absolute`.

The corrected override uses **long-form type: tmpfs volume mounts** for both services
with `tmpfs.size: 16777216` (16 MiB) and default Docker noexec/nosuid options.
This avoids the unsupported comma-separated mount syntax without dropping the
size limit.

These commands are **preflight only**. They mount legacy auth read-only and do not
start, stop, or recreate the production BYON gateway:

~~~bash
cd /opt/apps/w-bot || exit 1
sudo docker compose -f docker-compose.yml -f docker-compose.byon-vault.yml config -q

sudo docker compose -f docker-compose.yml -f docker-compose.byon-vault.yml \
  --profile vault-migrate run --rm --no-deps --entrypoint sh byon-vault-migrate \
  -c 'set -e; test -r /run/secrets/kms_credentials; \
      echo "KMS credential file readable"; \
      grep " /tmp " /proc/mounts | cut -d" " -f2-4'
~~~

Confirm that `/tmp` is a tmpfs mount and that the credential file is readable
without printing the file contents. **Do not run --inventory, --migrate, or --verify
until the cutover maintenance window and encrypted backup are approved.**

## 2 — Production cutover (ONLY after PR merge and AWS setup)

Plan a maintenance window: BYON Translation and Smart Alerts will briefly stop. The shared W-Bot Translation gateway and API should remain running.

- Confirm a restricted encrypted OFF-HOST backup of the legacy plaintext auth volume. Do not create an unencrypted tar archive in a shared directory.
- Confirm no second gateway replica is running.
- Do NOT use the normal Compose file alone after switching to KMS mode. Use both Compose files for ALL subsequent BYON gateway start, build, up, stop and inspect commands.

~~~bash
cd /opt/apps/w-bot || exit 1
git switch main && git pull --ff-only origin main
sudo docker compose version
sudo docker compose --profile byon build byon-gateway

# Stop legacy BYON only before reading any source files.
sudo docker compose --profile byon stop byon-gateway

# Build the separate one-off migration image.
sudo docker compose -f docker-compose.yml -f docker-compose.byon-vault.yml \
  --profile vault-migrate build byon-vault-migrate

# Validate Compose config silently (NEVER print resolved tokens).
sudo docker compose -f docker-compose.yml -f docker-compose.byon-vault.yml config -q

# Test that node in the migration container can read KMS credentials without displaying them.
sudo docker compose -f docker-compose.yml -f docker-compose.byon-vault.yml \
  --profile vault-migrate run --rm --no-deps --entrypoint sh byon-vault-migrate \
  -c 'test -r /run/secrets/kms_credentials && echo "KMS credential file readable"'
~~~

If preflight fails, leave KMS mode disabled, restart the original legacy gateway and resolve the issue before retrying.

## 3 — Offline inventory, migrate and verify

~~~bash
sudo docker compose -f docker-compose.yml -f docker-compose.byon-vault.yml \
  --profile vault-migrate run --rm --no-deps byon-vault-migrate --inventory

sudo docker compose -f docker-compose.yml -f docker-compose.byon-vault.yml \
  --profile vault-migrate run --rm --no-deps byon-vault-migrate --migrate

sudo docker compose -f docker-compose.yml -f docker-compose.byon-vault.yml \
  --profile vault-migrate run --rm --no-deps byon-vault-migrate --verify
~~~

All records must pass. Only counts are printed, NEVER phone numbers, JIDs, auth content, or connection IDs. Missing/unsafe source auth fails closed. Existing encrypted sessions are checked but never overwritten with older source records. On failure, do NOT start the KMS gateway.

## 4 — Enable encryption and start ONLY vault-mounted gateway

After successful verify, persist this in .env:

~~~dotenv
BYON_AUTH_MODE=kms
~~~

Then start with BOTH files:

~~~bash
sudo docker compose -f docker-compose.yml -f docker-compose.byon-vault.yml \
  --profile byon up -d --no-deps --no-build --force-recreate byon-gateway

sudo docker compose -f docker-compose.yml -f docker-compose.byon-vault.yml \
  --profile byon ps byon-gateway

sudo docker inspect w-bot-byon-gateway-1 \
  --format '{{range .Mounts}}{{println .Destination}}{{end}}'
~~~

Expected mounts: /data/vault and /run/secrets/kms_credentials. NEVER /data/auth or /data/legacy-auth. Gateway startup also checks for an actual persistent vault mount and refuses legacy mounts while encrypted mode is selected.

Verify each migrated customer connection reconnects, group listing still works, Translation replies work, Smart Alerts private inbox matches arrive, and optional notification delivery works. Do not show private keys, QR codes, or personal data in logs.

## 5 — Secure backups, rollback and source retirement

- Keep an encrypted backup of the NEW wbot_byon_vault named volume (ciphertext + wrapped DEKs) with restricted access and retention. Test an isolated restoration with the correct AWS key. If KMS is deleted, recovery is impossible.
- The legacy volume remains plaintext and sensitive until separately approved for retirement. Never mount it on the KMS gateway.
- BEFORE the FIRST encrypted live Signal-key update, an offline rollback to legacy may be possible while the old session has not become stale.
- AFTER the encrypted gateway processes live messages, DO NOT switch back to the unchanged plaintext legacy volume: Signal state will be stale and reconnect/decryption can fail. Fix the KMS failure or restore from the latest encrypted vault. An emergency decrypt-to-legacy procedure must be separately approved and executed offline; there is no public/admin key-export endpoint.
- Securely retire the old volume and plaintext snapshots after a verified encrypted backup/restore drill and written operator approval. Deleting cloud blocks is not a guaranteed secure wipe.

## Go / no-go checklist

- [ ] KMS key, least-privilege IAM key policy, monitoring and retention configured.
- [ ] Non-root gateway can read the KMS secret file without exposing credentials.
- [ ] Isolated Docker build and tests pass.
- [ ] Docker Compose overlay validates and does not mount legacy auth into gateway.
- [ ] Encrypted rollback backup of legacy volume verified.
- [ ] Legacy gateway stopped before migration.
- [ ] Offline inventory, migration and verify pass for ALL connections/records.
- [ ] Live BYON gateway reconnect and Translation/Smart Alerts smoke tests pass.
- [ ] Encrypted vault backup and isolated recovery drill pass.
- [ ] Legacy plaintext volume retirement authorized and completed separately.

**Never claim Batch 1 is operationally complete or W-Bot is fully secure until the checks have passed.**
