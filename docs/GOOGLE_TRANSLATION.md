# Enable real translation on Lightsail (WhatsApp sending stays disabled)

W-Bot supports Google Cloud Translation **Basic v2** for language detection and translation. The application uses the `x-goog-api-key` HTTP header for API-key authentication.

## 1. Set up Google Cloud

1. Open https://console.cloud.google.com/
2. Select or create a Google Cloud project dedicated to W-Bot.
3. Link a billing account to the project.
4. Enable **Cloud Translation API** from APIs & Services > Library.
5. Under APIs & Services > Credentials, create an **API key**.
6. Restrict its **API restrictions** to Cloud Translation API. For a fixed Lightsail outbound address, consider setting an **IP address application restriction** after confirming the instance's egress IP.
7. Set a billing budget and appropriate quotas. Four target translations per incoming message increase character usage.

Official docs:
- https://docs.cloud.google.com/translate/docs/setup
- https://docs.cloud.google.com/translate/docs/authentication
- https://docs.cloud.google.com/translate/docs/languages
- https://cloud.google.com/products/translate/pricing

Both `fil` and `tl` are supported for Filipino/Tagalog, and both `he` and `iw` are supported for Hebrew. W-Bot normalizes older response codes to `fil` and `he`.

## 2. Update the local .env (do not commit or share the key)

From `/opt/apps/w-bot`:

    nano .env

Set:

    TRANSLATION_PROVIDER=google
    GOOGLE_TRANSLATE_API_KEY=YOUR_ACTUAL_SECRET_API_KEY
    DRY_RUN=true

Keep Meta live sending disabled. Do not add actual credentials to .env.example.

## 3. Pull, rebuild, check health

    git pull --ff-only origin feature/translation-mvp-lightsail
    sudo docker compose up -d --build
    sudo docker compose ps
    curl -fsS http://127.0.0.1:9028/healthz
    curl -fsS http://127.0.0.1:9028/readyz

Expected health provider: `google` and `dryRun: true`.

## 4. Simulate a real translation without sending WhatsApp messages

Read the admin key from .env securely, without posting it to chat:

    read -rsp "W-Bot admin key: " WBOT_ADMIN_KEY
    echo

Ensure the demo group has all five languages:

    curl -sS -X POST http://127.0.0.1:9028/api/groups \
      -H "Authorization: Bearer $WBOT_ADMIN_KEY" \
      -H "Content-Type: application/json" \
      -d '{"groupId":"demo-group","name":"Multilingual Test Group","targetLanguages":["he","en","fil","si","ta"]}'

Send a Hebrew message:

    curl -sS -X POST http://127.0.0.1:9028/api/simulate \
      -H "Authorization: Bearer $WBOT_ADMIN_KEY" \
      -H "Content-Type: application/json" \
      -d '{"groupId":"demo-group","senderId":"demo-he","text":"שלום לכולם, נתראה מחר בתשע בבוקר."}'

Check results:

    sleep 5
    curl -sS "http://127.0.0.1:9028/api/messages?groupId=demo-group" \
      -H "Authorization: Bearer $WBOT_ADMIN_KEY" | python3 -m json.tool

Expected: a COMPLETED message with real English, Filipino, Sinhala and Tamil translations, no MOCK labels, and no WhatsApp outbound message. If it fails, inspect `lastError` and `sudo docker compose logs --tail=100 api`.

Repeat with Filipino, English, Sinhala and Tamil input. Examples:

- Filipino: `Kumusta po kayo? Magkita tayo bukas ng alas-nuwebe.`
- English: `We will meet tomorrow morning at nine.`
- Sinhala: `අපි හෙට උදේ නවයට හමුවෙමු.`
- Tamil: `நாளை காலை ஒன்பது மணிக்கு சந்திப்போம்.`

Automatic detection of short or mixed-language texts can be imperfect; have native speakers review translations before live use.

## Privacy and cost

Google will receive the message content sent to the Translation API. Make sure real group participants consent and agree on message retention and data handling before live onboarding. W-Bot stores original messages and translations in MySQL; retention and deletion automation still need implementing.

Translation usage is metered by input characters across the translation calls. Check Google's current pricing, quotas and credits in the Cloud Console. An incoming message translated into four target languages typically generates four billable translation requests plus detection.

**Do not turn off DRY_RUN** until Meta Groups API eligibility, webhook signatures, outbound message delivery and group consent are verified.

## Troubleshooting HTTP 401 or 403

When the W-Bot worker records `Google Translation HTTP 401`, first probe the same API from **inside the running Docker container**. Do not print the API key or paste it into chats. This command prints only the HTTP status, a sanitized Google status/reason, and the detected language if successful.

    sudo docker compose exec -T api node --input-type=module <<'NODE'
    const key = process.env.GOOGLE_TRANSLATE_API_KEY ?? "";
    console.log("Key configured:", Boolean(key));
    console.log("Looks like a standard Google key:", /^AIza[0-9A-Za-z_-]{35}$/.test(key));
    console.log("Is an obvious placeholder:", /^(YOUR_|REPLACE_|CHANGE_)/.test(key));
    try {
      const response = await fetch("https://translation.googleapis.com/language/translate/v2/detect", {
        method: "POST",
        headers: {
          "x-goog-api-key": key,
          "content-type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({ q: "Hello world" }),
        signal: AbortSignal.timeout(12000)
      });
      const result = await response.json().catch(() => ({}));
      console.log(JSON.stringify({
        httpStatus: response.status,
        googleStatus: result?.error?.status ?? null,
        reasons: (result?.error?.details ?? []).map(d => d.reason).filter(Boolean),
        detectedLanguage: result?.data?.detections?.[0]?.[0]?.language ?? null
      }, null, 2));
    } catch (error) {
      console.error("Network or timeout error:", error instanceof Error ? error.name : "Unknown");
    }
    NODE

A successful response has `httpStatus: 200` and `detectedLanguage: "en"`.

Common failure categories:

- **401 / UNAUTHENTICATED / API_KEY_INVALID** — Invalid, revoked, malformed, or placeholder key. Generate a standard Google Cloud API key in the project that owns billing.
- **403 / API_KEY_SERVICE_BLOCKED / SERVICE_DISABLED** — Enable **Cloud Translation API** in that key's project; select it under API restrictions. Google API service name is `translate.googleapis.com`.
- **403 / API_KEY_IP_ADDRESS_BLOCKED** — Check the allowed external IP of your AWS Lightsail instance. Backend calls should use an IP-restricted key, not a website referrer-restricted key.
- **403 / BILLING_DISABLED** — Verify billing on the project where the API key belongs.
- **429 / RESOURCE_EXHAUSTED** — Check quota and billing limits.
- **HTTP 200 but bot stays FAILED** — Old failed jobs are not requeued automatically. Send a *new* simulated message (with a new message ID).

The Google Cloud documentation explicitly supports the `x-goog-api-key` HTTP header for Translation Basic v2. Do not place the key in a URL or share the key to troubleshoot authentication.
