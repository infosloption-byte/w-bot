# W-Bot Security Hardening — Master Tracker

GitHub tracking issue: https://github.com/infosloption-byte/w-bot/issues/19
Batch 1 implementation PR: https://github.com/infosloption-byte/w-bot/pull/18

Owner: W-Bot / SL Options
Started: 2026-11-04
Status: ACTIVE. This tracker is the source of truth for security work across branches, PRs, production checks and future releases.

## Rules for all batches

1. Work on a dedicated security feature branch; do not auto-merge.
2. Keep production and real customer auth data unchanged until builds and live migration are explicitly reviewed.
3. Tests must include negative authorization/failure scenarios, not only happy paths.
4. Never commit, export, log or paste real WhatsApp Signal keys, pairing QR codes, API tokens or customer message content.
5. Production rollout requires backups, verified rollback or recovery, health checks and an audit trail.
6. Do not advertise security certifications or claim complete protection without independent evidence.

## Batch 1 — WhatsApp Authentication Vault (P0)

Branch: security/batch1-encrypted-whatsapp-session-vault-20261104
Release state: IMPLEMENTATION IN REVIEW; PRODUCTION PENDING

### Code deliverables

- [x] Threat model, retention and key-management design
- [x] AES-256-GCM encryption with fresh per-record nonce and authenticated connection/record binding
- [x] One AWS KMS-wrapped data key per connection with full key ARN and KMS EncryptionContext
- [x] Opaque session record paths and file permissions
- [x] Atomic credential/Signal-key persistence, serialized writes and failure-closed reads
- [x] Prevent automatic bootstrap from silently regenerating lost sessions
- [x] One-off offline legacy migration with record-by-record ciphertext verification
- [x] Separate vault-only production Compose overlay (old plaintext auth volume only in migration job)
- [x] Offline migration runbook with source volume retention and secure recovery requirements
- [x] Regression tests: round-trip, restart, key deletion, corruption, wrong connection and migration failure
- [ ] Full isolated Docker build and runtime tests on Lightsail
- [ ] Independent security review of migration and AWS KMS permissions
- [ ] Production AWS KMS key and restricted credential identity provisioned
- [ ] Verified encrypted off-host pre-migration backup
- [ ] Live offline migration and connection-by-connection smoke verification
- [ ] Encrypted vault backup/restore drill and written cutover acceptance
- [ ] Legacy plaintext volume/snapshot retirement and incident-response readiness

Important: Batch 1 is not finished until operations are verified; deployment is deliberately deferred.

## Batch 2 — Identity, MFA & Access Authorization (P0, NOT STARTED)

- [ ] Require phishing-resistant MFA/passkeys where available, TOTP fallback
- [ ] Enforce recent reauthentication for pairing QR, new links, unlink and security changes
- [ ] Block VIEWER access to pairing secrets and sensitive connection state
- [ ] Harden role-based tenant ownership for every connection, group and rule endpoint
- [ ] Replace shared all-connections gateway bearer authority with scoped, short-lived commands
- [ ] Authorize outbound sends and notification destinations against tenant-selected, consented groups
- [ ] Customer and Platform Admin security session management / revoke all
- [ ] Server-side abuse controls and negative cross-tenant regression tests

## Batch 3 — Infrastructure and Customer Data (P1, NOT STARTED)

- [ ] Harden Docker networks, egress, Linux capabilities and runtime secret access
- [ ] Split per-tenant gateway workers and least-privilege decryption ability (single gateway currently has all sessions)
- [ ] Review encrypted data retention, deletion, vault backups and sensitive data logging
- [ ] Shared persistent rate limits for API login, pairing, invitation and password resets
- [ ] Security headers, CSRF and OAuth callback reviews
- [ ] Secret rotation and managed ephemeral IAM credential plan
- [ ] Scale out to a DB-backed encrypted Signal-key store with safe locking and HA when needed

## Batch 4 — Monitoring, Response & Independent Validation (P1/P2, NOT STARTED)

- [ ] Customer security center and WhatsApp emergency unlink
- [ ] Suspicious pairing/login alerts and immutable audit trails
- [ ] Security scanning (dependencies, containers, leaked secrets) in CI
- [ ] Encrypted backup restore and incident-response simulations
- [ ] OWASP ASVS-based application security verification
- [ ] Independent penetration test, risk register and remediation sign-off
- [ ] Legally reviewed privacy, retention and data-processing disclosures before wide release

## Rollout gates / status history

| Date | Milestone | State |
| --- | --- | --- |
| 2026-11-04 | Code-level Batch 1 implementation on isolated branch | In progress |
| Pending | Lightsail isolated Docker build including vault tests | Not run |
| Pending | AWS KMS key and IAM principal creation | Not done |
| Pending | Live migration and decrypt-by-record verification | Not done |
| Pending | Encrypted-vault runtime cutover | Not done |
| Pending | Backups, restore tests and plaintext retirement | Not done |

After each completed milestone, update THIS file and the corresponding GitHub tracking issue/PR with the evidence, without disclosing secrets.
