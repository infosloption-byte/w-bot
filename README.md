# w-bot — Multilingual WhatsApp group translator

Node.js + Fastify + TypeScript + Prisma + MySQL. Receives signed WhatsApp Cloud API webhooks, detects the source language, translates to up to three group-configured languages, and posts one combined group reply **only if live sending is explicitly enabled**.

## Current MVP

- Secure GET verification and HMAC-SHA256 POST webhook on /webhooks/whatsapp.
- Explicit group allowlist; unknown groups and private messages are ignored.
- English, Sinhala, Tamil, Hindi, Chinese, Arabic, French, German, Japanese, and Spanish.
- Mock translation engine for offline tests; Google Cloud Translation API for actual translation.
- Persistent messages, duplicate-message protection, automatic retries, and recent-message visibility.
- Docker deployment suitable for Lightsail; API only bound to 127.0.0.1:9028.
- Admin API authenticated with Bearer token; dry-run simulation endpoint.
- Build and unit tests in GitHub Actions.

## Important WhatsApp limitation

The **official Meta WhatsApp Groups API** is not available to regular WhatsApp groups. It requires an eligible WhatsApp Official Business Account (OBA), a Cloud API number, and groups within Meta's published small-group limits. This project does **not** install an unauthorized WhatsApp Web bot, and cannot read arbitrary existing WhatsApp groups. Check current eligibility directly with Meta before enabling live mode.

The MVP is **group reply mode**. Private per-member translation, voice/audio, group creation/invite management, admin dashboard, data retention controls, and multi-tenant billing are future work. Only onboard participants who consent to group message processing. Translation sends message content to Google if that provider is enabled.

## Local development

1. Install Node.js 22+, MySQL 8+, and Docker/Compose if using containers.
2. Copy .env.example to .env and replace passwords and tokens with random values.
3. For Docker, run: **docker compose up -d --build**.
4. Check **curl http://127.0.0.1:9028/healthz** and **curl http://127.0.0.1:9028/readyz**.
5. See docs/DEPLOY_LIGHTSAIL.md for API examples and Nginx configuration.

Without Docker, install with npm install, generate the client with npx prisma generate, migrate with npx prisma migrate deploy and start with npm run dev. Set DATABASE_URL for the local MySQL instance.

## API

| Method | Endpoint | Auth | Purpose |
| --- | --- | --- | --- |
| GET | /healthz | Public | Process health |
| GET | /readyz | Public | Database readiness |
| GET | /webhooks/whatsapp | Meta verification token | Webhook challenge |
| POST | /webhooks/whatsapp | Meta HMAC signature | Ingest group text |
| GET | /api/groups | Bearer ADMIN_API_KEY | List groups |
| POST | /api/groups | Bearer ADMIN_API_KEY | Create/update group |
| PATCH | /api/groups/:groupId | Bearer ADMIN_API_KEY | Change group |
| GET | /api/messages | Bearer ADMIN_API_KEY | Last 50 message records |
| POST | /api/simulate | Bearer ADMIN_API_KEY | Test without WhatsApp (dry-run only) |

Each registered group sets its own targetLanguages array, e.g. ["en","si","ta"]. The worker skips translation into the detected source language and does not reply when no translation is needed. In mock mode results are prefixed MOCK and are *not actual translations*.

## Safety / operational notes

- Use DRY_RUN=true and TRANSLATION_PROVIDER=mock first. To test real language output **without WhatsApp posting**, use TRANSLATION_PROVIDER=google with DRY_RUN=true.
- App webhook secret is distinct from verification token.
- Never expose the admin API publicly without HTTPS, strong authentication and access restrictions; only the webhook needs a public route.
- Webhook deduplication uses WhatsApp message ID within a group.
- Worker provides **at-least-once**, not exactly-once, delivery: a crash after successful send but before acknowledgement storage may duplicate a reply. Stronger delivery tracking remains planned.
- Message text currently persists in MySQL. Configure retention/privacy policy before onboarding real groups.
- No dashboard or WhatsApp provisioning is included in this milestone.
