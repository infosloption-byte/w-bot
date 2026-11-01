# W-Bot: Gemini translations on Lightsail

This guide configures **Gemini Developer API** with the existing W-Bot application. Do not replace the MySQL database or its Docker volume.

The recommended new-project model is `gemini-3.5-flash-lite` (model name can be changed in .env). Google notes some older 2.5 model access is limited for newly active projects. Verify model availability in https://aistudio.google.com/ for your API key.

## 1. Set up the key

Use a **Gemini API key** from Google AI Studio: https://aistudio.google.com/apikey

Restrict and manage the API key appropriately; the backend authenticates to the Gemini Developer API at `generativelanguage.googleapis.com` using the `x-goog-api-key` header. The app does not put the secret in URLs, message history, or logs.

Review current request pricing, rate limits, account quotas and data handling before sending actual group messages. Free-tier and paid-tier data policies differ; opt-in consent and a deletion/retention policy remain prerequisites for live group content.

## 2. Change existing .env

From `/opt/apps/w-bot`:

    git switch feature/translation-mvp-lightsail
    git pull --ff-only origin feature/translation-mvp-lightsail
    nano .env

Set (replace secret with YOUR key; do not commit this file):

    TRANSLATION_PROVIDER=gemini
    GEMINI_API_KEY=YOUR_REAL_GEMINI_API_KEY
    GEMINI_MODEL=gemini-3.5-flash-lite
    DRY_RUN=true

Remove or comment any duplicate TRANSLATION_PROVIDER lines. Your previous GOOGLE_TRANSLATE_API_KEY can remain in .env but is ignored while Gemini is selected.

## 3. Rebuild and check status

    sudo docker compose up -d --build
    sudo docker compose ps
    sudo docker compose logs --tail=60 api
    curl -fsS http://127.0.0.1:9028/healthz
    curl -fsS http://127.0.0.1:9028/readyz

The Docker builder runs TypeScript compilation and tests automatically. Health should show `"translationProvider":"gemini"` and `"dryRun":true`. First curl after container recreation may fail while migrations start; retry after server is listening.

## 4. Test all five languages in simulation

Read your current admin key without echoing its value:

    read -rsp "W-Bot admin key: " WBOT_ADMIN_KEY
    echo

Your existing demo-group should already be registered with the target codes `["he","en","fil","si","ta"]`. Confirm if necessary:

    curl -fsS http://127.0.0.1:9028/api/groups \
      -H "Authorization: Bearer $WBOT_ADMIN_KEY"

Send a **new** simulated message (even if earlier messages failed under Google Cloud Translation):

    curl -sS -X POST http://127.0.0.1:9028/api/simulate \
      -H "Authorization: Bearer $WBOT_ADMIN_KEY" \
      -H "Content-Type: application/json" \
      -d '{"groupId":"demo-group","senderId":"gemini-test","text":"Kumusta po kayo? Magkikita tayo bukas ng alas-nuwebe ng umaga."}'

Inspect results after processing:

    sleep 6
    curl -sS "http://127.0.0.1:9028/api/messages?groupId=demo-group" \
      -H "Authorization: Bearer $WBOT_ADMIN_KEY" | python3 -m json.tool

Check:
- New message has `status: COMPLETED`, `sourceLanguage: fil`, and translated output without `[MOCK]`.
- Output includes the four other languages; Filipino is excluded because it is the source.
- `attempts: 1`, `lastError: null`, and `outboundMessageId` is null because DRY_RUN is enabled.
- Request result is not always immediate; use the message history and container logs to check status.

Repeat with Hebrew (`שלום לכולם`), English (`Hello everyone`), Sinhala (`අපි හෙට හමුවෙමු`), and Tamil (`நாளை சந்திப்போம்`). Language detection may be imperfect for very short or mixed-language messages; review actual translations with native speakers.

## 5. Common failure codes

- `Gemini API HTTP 400`: request or unsupported model configuration; check the model name.
- `Gemini API HTTP 401`: invalid or missing Gemini API key.
- `Gemini API HTTP 403`: key restrictions, permission or billing issues.
- `Gemini API HTTP 404`: model not available for that API key. Check models in Google AI Studio and set GEMINI_MODEL to one that supports generateContent.
- `Gemini API HTTP 429`: per-project rate limit or quota; inspect rate limits. W-Bot retries transient failures up to three attempts.
- `Gemini response unavailable or incomplete`: blocked response or max output tokens; inspect app logs (content is not logged).
- `Gemini translation missing or invalid`: malformed or incomplete model response; no partial translation is sent.

W-Bot currently stores original and translated messages in MySQL. Automated retention and deletion, rate-limiting, delivery confirmation and a production-grade admin UI are follow-up work. WhatsApp official Groups API eligibility still controls whether messages can be posted into groups.
