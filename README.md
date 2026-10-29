# w-bot — Multilingual WhatsApp group translator

Node.js + Fastify + TypeScript + Prisma + MySQL. Receives signed WhatsApp Cloud API webhooks, detects the source language, translates to up to five group-configured languages, and posts one combined group reply **only if live sending is explicitly enabled**.

## Current MVP

- Secure GET verification and HMAC-SHA256 POST webhook on /webhooks/whatsapp for the official Meta Groups API.
- Optional opt-in linked-device Web gateway for ordinary groups, deployed as an isolated Docker service using Baileys. See [dual gateway guide](docs/DUAL_GATEWAYS.md).
- Group gateway pinning (`OFFICIAL` or `WEB`), strict group allowlist, inbound authentication and duplicate-message protection; no private messages are translated.
- Five configured languages: Hebrew (`he`), English (`en`), Sinhala (`si`), Uzbek (`uz`), and Russian (`ru`).
- **Gemini API** for language detection and five-language translation in **one** structured-output API call. Default model: `gemini-3.5-flash-lite`. See [Gemini setup and test](docs/GEMINI_LIGHTSAIL.md). Existing Google Cloud Translation API remains optional via `TRANSLATION_PROVIDER=google` (see [Google guide](docs/GOOGLE_TRANSLATION.md)). Mock provider is retained for offline tests.
- Persistent messages, duplicate-message protection, automatic retries, and recent-message visibility.
- Docker deployment suitable for Lightsail; API only bound to 127.0.0.1:9028.
- Admin API authenticated with Bearer token; dry-run simulation endpoint.
- Docker build runs TypeScript compilation and unit tests before image publication. GitHub Actions is also configured (verify CI is enabled for the repository).

## Important WhatsApp limitation

The **official Meta WhatsApp Groups API** is not available to regular WhatsApp groups. It requires an eligible WhatsApp Official Business Account (OBA), a Cloud API number, and groups within Meta's published small-group limits. For ordinary groups, an optional Baileys Web gateway can be enabled explicitly. Baileys is **unofficial**, is not endorsed by Meta, and can violate WhatsApp terms or lead to account restrictions. We do not attempt stealth, evasion, spam, or automatic joining. A connected, opted-in WhatsApp account can only read groups it already belongs to. Test with a dedicated number and explicit member consent. See [dual gateway guide](docs/DUAL_GATEWAYS.md).

The MVP is **group reply mode**, with independently configured official and Web transports. Private per-member translation, voice/audio, group creation/invite management, admin dashboard, data retention controls, and multi-tenant billing are future work. Only onboard participants who consent to group message processing. Gemini and Google Cloud Translation send translated message content to the selected Google service. Use only with appropriate group consent and data-handling policies.

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
| GET | /api/gateways | Bearer ADMIN_API_KEY | Check gateway configuration and Web connection state |
| GET | /api/web/groups | Bearer ADMIN_API_KEY | List joined Web groups and their IDs |
| GET | /api/groups | Bearer ADMIN_API_KEY | List groups |
| POST | /api/groups | Bearer ADMIN_API_KEY | Create/update group |
| PATCH | /api/groups/:groupId | Bearer ADMIN_API_KEY | Change group |
| GET | /api/messages | Bearer ADMIN_API_KEY | Last 50 message records |
| POST | /api/simulate | Bearer ADMIN_API_KEY | Test without WhatsApp (dry-run only) |

Every new group defaults to the five target languages: `["he","en","si","uz","ru"]`. An admin can configure any subset of one to five supported languages through `targetLanguages`. Older Google detection codes `iw` and `tl` still normalize to `he` and `fil` for source-language identification, but Filipino is no longer an output target. The worker includes every configured language. When the source language is configured, it copies the original text exactly into that section without retranslating it. In mock mode results are prefixed MOCK and are *not actual translations*.

## Safety / operational notes

- Mock language detection recognizes Hebrew, Sinhala and Russian scripts, but **cannot reliably distinguish Uzbek Latin from English** or Uzbek Cyrillic from Russian. Gemini (or Google Cloud Translation) is required for real detection and translations.
- Four translations of a long message can exceed WhatsApp's single-text limit. This MVP currently fails such messages rather than silently truncating them; splitting replies is future work.
- For real Gemini output **without WhatsApp posting**, use `TRANSLATION_PROVIDER=gemini`, `GEMINI_API_KEY` and `DRY_RUN=true`. Existing messages are not reprocessed automatically after provider switches; send a new simulated message.
- App webhook secret is distinct from verification token.
- Never expose the admin API publicly without HTTPS, strong authentication and access restrictions; only the webhook needs a public route.
- Webhook deduplication uses WhatsApp message ID within a group.
- Worker provides **at-least-once**, not exactly-once, delivery: a crash after successful send but before acknowledgement storage may duplicate a reply. Stronger delivery tracking remains planned.
- Message text currently persists in MySQL. Configure retention/privacy policy before onboarding real groups.
- No React dashboard or automated group joining is included in this milestone.
- **Failover limits:** transport outages are isolated; queued messages for a disconnected Web group retry when the Web gateway reconnects. The official API cannot read an ordinary group's messages, so no automatic cross-gateway takeover exists. Groups never silently switch destinations. An administrative explicit group mapping would need verification before any future cross-transport fallback.

## Faster replies and original-message threading

The worker checks for new messages every **500ms** (previously 2000ms). Gemini 3.x requests use `GEMINI_THINKING_LEVEL=minimal` by default to reduce unnecessary reasoning for short messages. AI/network latency still varies; structured batch detection and all translations remain a single Gemini request. The worker logs queue, translation, send and total durations without logging chat text or credentials.

Outgoing messages now use WhatsApp's native **Reply** functionality, quoting the source message on both the Web gateway and the eligible official Meta group gateway. A WhatsApp Web reply uses the original message ID, sender JID (including `@lid`) and source text from MySQL; official replies use a `context.message_id` object.

A database migration updates existing groups using exactly the previous five-language default to `["he","en","si","uz","ru"]`; deliberately customized target lists are not overwritten. Check `/api/groups` after deployment, and update any customized groups through PATCH. New messages use the new settings; previously sent replies are unchanged.

## Show all five languages, even when the source matches

Outgoing WhatsApp replies always contain Hebrew, English, Sinhala, Uzbek, and Russian sections. The section matching the detected input language repeats the original text verbatim; all other sections are translated. The native WhatsApp quotation of the original message remains enabled.
