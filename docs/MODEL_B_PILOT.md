
# W-Bot Model B — shared-number customer pilot

**Scope:** Invite-only multi-tenant technical pilot. Baileys is unofficial and may trigger account restrictions. This is not approved as a public or commercial WhatsApp SaaS.

## Workflow

1. A customer signs up in the W-Bot portal using an invitation code, email and password. The system creates an isolated workspace.
2. The customer selects Add Group and generates a 16-character, one-time group activation code. The code expires after 15 minutes and is stored as a SHA-256 digest, not as plaintext.
3. A WhatsApp **group administrator** adds the shared W-Bot number to their group, then posts /wbot connect CODE in that group.
4. The Web gateway checks live WhatsApp group metadata. Only a matching admin or superadmin JID, including LID identifiers when supplied by Baileys, can activate the group.
5. The backend validates the one-time code and binds the group to precisely one tenant. A group already assigned to a different customer cannot be claimed.
6. The customer manages five-language settings, group status and usage through the dashboard. Replies still quote original messages.

The same shared linked-device WhatsApp Business number continues to serve all verified groups. New customers do **not** link their own numbers. Groups must already include the bot and participants must be informed of translation, AI processing and data retention.

## Pilot features

- Salted scrypt passwords, server-side sessions with hashed tokens, HttpOnly strict SameSite cookies
- Tenant-scoped workspace and group APIs with server-side role checks; no cross-tenant group management
- Temporary group activation codes and verified group-admin commands
- Existing unclaimed test groups retained, including their previous messages and settings
- New tenant usage excludes messages created before group activation
- Pilot limits: 3 groups and 1,000 incoming messages per month per tenant by default (configurable)
- Responsive React dashboard and separate localhost-bound Docker service
- Existing Gemini, MySQL, Meta adapter and Baileys session preserved

## Deploy on Lightsail — no data volume reset

First take a Lightsail snapshot or MySQL backup. Never run docker compose down -v or delete the Web gateway auth volume.

    cd /opt/apps/w-bot
    git fetch origin
    git switch -c feature/model-b-shared-number-saas --track origin/feature/model-b-shared-number-saas

Edit the **existing** .env, retaining all working values. Add:

    SAAS_ENABLED=true
    SAAS_SIGNUP_CODE=<a new random secret from openssl rand -hex 24>
    SAAS_BOT_NUMBER=+<your dedicated business account phone>
    SAAS_COOKIE_SECURE=false
    SAAS_MAX_GROUPS=3
    SAAS_MONTHLY_MESSAGES=1000

Keep DRY_RUN=false only for your consenting test group. The signup code is an invite-only secret: don't share publicly. SAAS_COOKIE_SECURE=false is allowed only for **private localhost testing over SSH**. Set it true behind public HTTPS.

Build and launch the existing services and the optional dashboard:

    sudo docker compose --profile web --profile portal up -d --build
    sudo docker compose --profile web --profile portal ps
    curl -fsS http://127.0.0.1:9028/readyz
    curl -fsS http://127.0.0.1:9031/healthz

The API applies a forward-only Prisma migration. Existing group records stay unclaimed; the original Web session uses the persistent wbot_web_auth volume. Access the portal using SSH port forwarding from your desktop:

    ssh -L 9031:127.0.0.1:9031 ubuntu@YOUR_LIGHTSAIL_PUBLIC_IP

Then open http://localhost:9031/portal/ in a browser. Signup uses the secret invitation code. Group activation is done through WhatsApp by a verified group admin, then the group appears under My Groups.

## Security and isolation

- Customer APIs live under /portal/api and require a secure session cookie. Mutations require the custom X-WBot-Request header.
- Existing global /api administrator endpoints remain server-private; do not expose them in an internet-facing proxy.
- Web gateway /internal/web/activate requires the existing service token and is private to Docker.
- Tenant group update queries require the tenant ID and internal group ID.
- Activation code consumption and group assignment are wrapped in a database transaction.
- Customer reports only include data from after each group was claimed.
- The shared WhatsApp account remains one operational failure domain. More bot accounts alone do not resolve WhatsApp authorization restrictions.

## Outstanding before public / paid rollout

Meta permission for the intended service, supported API eligibility, account recovery, email verification and password reset, terms/consent notices, automated retention/deletion, durable inbound queue and outbound idempotency, strict concurrency-safe quota accounting, abuse prevention, audit logs, billing and monitoring. Current rate limiting and quota checks are suitable for a small private pilot, **not** scaled public registration.

## Rollback

If necessary switch back to feature/translation-mvp-lightsail and rebuild the Web and API services. Keep the MySQL data and authentication volume intact. The additional nullable Group columns and new SaaS tables are designed to coexist with the earlier app version.
