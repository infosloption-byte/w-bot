# w-bot — Multilingual WhatsApp group translator

Node.js + Fastify + TypeScript + Prisma + MySQL. Receives signed WhatsApp Cloud API webhooks, detects the source language, translates to up to five group-configured languages, and posts one combined group reply **only if live sending is explicitly enabled**.

## Current MVP

- Secure GET verification and HMAC-SHA256 POST webhook on /webhooks/whatsapp.
- Explicit group allowlist; unknown groups and private messages are ignored.
- Five configured languages: Hebrew (`he`), English (`en`), Filipino/Tagalog (`fil`), Sinhala (`si`), and Tamil (`ta`).
- **Gemini API** for language detection and five-language translation in **one** structured-output API call. Default model: `gemini-3.5-flash-lite`. See [Gemini setup and test](docs/GEMINI_LIGHTSAIL.md). Existing Google Cloud Translation API remains optional via `TRANSLATION_PROVIDER=google` (see [Google guide](docs/GOOGLE_TRANSLATION.md)). Mock provider is retained for offline tests.
- Persistent messages, duplicate-message protection, automatic retries, and recent-message visibility.
- Docker deployment suitable for Lightsail; API only bound to 127.0.0.1:9028.
- Admin API authenticated with Bearer token; dry-run simulation endpoint.
- Docker build runs TypeScript compilation and unit tests before image publication. GitHub Actions is also configured (verify CI is enabled for the repository).

## Important WhatsApp limitation

The **official Meta WhatsApp Groups API** is not available to regular WhatsApp groups. It requires an eligible WhatsApp Official Business Account (OBA), a Cloud API number, and groups within Meta's published small-group limits. This project does **not** install an unauthorized WhatsApp Web bot, and cannot read arbitrary existing WhatsApp groups. Check current eligibility directly with Meta before enabling live mode.

The MVP is **group reply mode**. Private per-member translation, voice/audio, group creation/invite management, admin dashboard, data retention controls, and multi-tenant billing are future work. Only onboard participants who consent to group message processing. Gemini and Google Cloud Translation send translated message content to the selected Google service. Use only with appropriate group consent and data-handling policies.

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
| GET | /api/languages | Bearer ADMIN_API_KEY | Supported languages and defaults |
| GET | /api/groups | Bearer ADMIN_API_KEY | List groups |
| POST | /api/groups | Bearer ADMIN_API_KEY | Create/update group |
| PATCH | /api/groups/:groupId | Bearer ADMIN_API_KEY | Change group |
| GET | /api/messages | Bearer ADMIN_API_KEY | Last 50 message records |
| POST | /api/simulate | Bearer ADMIN_API_KEY | Test without WhatsApp (dry-run only) |

Every new group defaults to the five target languages: `["he","en","fil","si","ta"]`. An admin can configure any subset of one to five supported languages through `targetLanguages`. Older Google response codes `iw` and `tl` are normalized to `he` and `fil` respectively. The worker skips translation into the detected source language and does not reply when no translation is needed. In mock mode results are prefixed MOCK and are *not actual translations*.

## Safety / operational notes

- Mock language detection recognizes Hebrew, Sinhala, Tamil and other distinct scripts, but **cannot reliably distinguish Filipino from English**, both written using Latin letters. Gemini (or Google Cloud Translation) is required for real detection and translations.
- Four translations of a long message can exceed WhatsApp's single-text limit. This MVP currently fails such messages rather than silently truncating them; splitting replies is future work.
- For real Gemini output **without WhatsApp posting**, use `TRANSLATION_PROVIDER=gemini`, `GEMINI_API_KEY` and `DRY_RUN=true`. Existing messages are not reprocessed automatically after provider switches; send a new simulated message.
- App webhook secret is distinct from verification token.
- Never expose the admin API publicly without HTTPS, strong authentication and access restrictions; only the webhook needs a public route.
- Webhook deduplication uses WhatsApp message ID within a group.
- Worker provides **at-least-once**, not exactly-once, delivery: a crash after successful send but before acknowledgement storage may duplicate a reply. Stronger delivery tracking remains planned.
- Message text currently persists in MySQL. Configure retention/privacy policy before onboarding real groups.
- No dashboard or WhatsApp provisioning is included in this milestone.
