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
