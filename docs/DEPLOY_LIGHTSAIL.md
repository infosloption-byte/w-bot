# Deploy w-bot on AWS Lightsail

Uses the existing Docker + Nginx server. No public hostname is assumed.

## 1. Clone and configure

    sudo mkdir -p /opt/apps && sudo chown "$USER":"$USER" /opt/apps
    cd /opt/apps
    git clone https://github.com/infosloption-byte/w-bot.git
    cd w-bot
    git switch feature/translation-mvp-lightsail
    cp .env.example .env
    chmod 600 .env
    openssl rand -hex 32

Use a generated value for ADMIN_API_KEY and generate separate values for WHATSAPP_VERIFY_TOKEN, MYSQL_PASSWORD and MYSQL_ROOT_PASSWORD. Use alphanumeric database passwords or URL-encode special characters. Do not commit secrets.

Keep DRY_RUN=true and TRANSLATION_PROVIDER=mock initially.

## 2. Start

    docker compose up -d --build
    docker compose ps
    docker compose logs --tail=100 api
    curl -fsS http://127.0.0.1:9028/healthz
    curl -fsS http://127.0.0.1:9028/readyz

Do not expose MySQL port 3306. Docker publishes API only to 127.0.0.1:9028.

## 3. Register a demo group and simulate

Set ADMIN_API_KEY in your terminal without pasting it into chat or committing it.

    export WBOT_ADMIN_KEY='your-generated-admin-key'
    curl -sS -X POST http://127.0.0.1:9028/api/groups \
      -H "Authorization: Bearer $WBOT_ADMIN_KEY" \
      -H "Content-Type: application/json" \
      -d '{"groupId":"demo-group","name":"Demo translations","targetLanguages":["he","en","fil","si","ta"]}'

    curl -sS -X POST http://127.0.0.1:9028/api/simulate \
      -H "Authorization: Bearer $WBOT_ADMIN_KEY" \
      -H "Content-Type: application/json" \
      -d '{"groupId":"demo-group","senderId":"tester","text":"Hello everyone"}'

    sleep 3
    curl -sS http://127.0.0.1:9028/api/messages \
      -H "Authorization: Bearer $WBOT_ADMIN_KEY"

Expected: completed message with four MOCK-prefixed output sections (Hebrew, Filipino, Sinhala, Tamil). No WhatsApp message is delivered. Mock translation does not translate the text, and Latin-script Filipino will be interpreted as English during mock detection. To test real detection, configure the Google Cloud Translation provider while keeping DRY_RUN=true.

To test script-based Hebrew detection without sending a real message, call the simulation endpoint again using a different message ID and text such as `שלום לכולם`. The result should skip Hebrew and list English, Filipino, Sinhala and Tamil.

For previously created groups, explicitly update their language selection using `PATCH /api/groups/:groupId` and `{"targetLanguages":["he","en","fil","si","ta"]}`; existing database groups are not silently modified on redeploy.

## 4. Optional public HTTPS webhook

Choose a dedicated hostname and point its DNS A record to Lightsail. Add an Nginx server block (replace HOSTNAME):

    server {
      listen 80;
      server_name HOSTNAME;
      location /webhooks/whatsapp {
        proxy_pass http://127.0.0.1:9028;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 256k;
      }
      location /healthz { proxy_pass http://127.0.0.1:9028; }
      location / { return 404; }
    }

Test and reload Nginx, then obtain HTTPS:

    sudo nginx -t && sudo systemctl reload nginx
    sudo certbot --nginx -d HOSTNAME

Meta callback URL: https://HOSTNAME/webhooks/whatsapp. Set the verification token from WHATSAPP_VERIFY_TOKEN. Subscribe to the messages and relevant group_* webhook fields.

## 5. Enable live translation

Prerequisites: approved official Meta Groups API access; an eligible Meta-managed group ID; group-member consent; signed webhook delivery; Google Cloud Translation API key.

Set TRANSLATION_PROVIDER=google, GOOGLE_TRANSLATE_API_KEY, WHATSAPP_APP_SECRET, WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env. Test Google translation with DRY_RUN=true first.

Change DRY_RUN=false only after validating the group and posting permission. Restart:

    docker compose up -d --build
    docker compose logs --tail=100 api

An ordinary WhatsApp group is not converted into an eligible API group by this application.

## Updates and backups

    git pull --ff-only
    docker compose up -d --build
    docker compose logs --tail=100 api

Back up the MySQL named volume before schema changes. Plan a retention policy, user opt-out, monitoring and dead-letter administration before broad rollout.

## Gemini translation on the same server

Follow [GEMINI_LIGHTSAIL.md](GEMINI_LIGHTSAIL.md) to configure `TRANSLATION_PROVIDER=gemini` and your Gemini AI Studio API key. Use `DRY_RUN=true` to keep WhatsApp delivery disabled. The Docker builder now runs unit tests before producing the image. Older Google Cloud Translation error messages do not apply when using Gemini.


## Optional group gateways

To run both the official Meta Cloud API gateway and opt-in WhatsApp Web gateway, follow [DUAL_GATEWAYS.md](DUAL_GATEWAYS.md). The Web service uses Docker Compose's `web` profile, so it is **not** started during the normal `docker compose up`. Keep `DRY_RUN=true` while linking and validating group IDs.
