# W-Bot dual WhatsApp gateways — Lightsail

W-Bot supports two **separate** message transports with the same MySQL group registry and Gemini translation engine.

| Gateway | Code | Group type | Prerequisites |
| --- | --- | --- | --- |
| Meta Groups API | `official` | eligible business-created small groups | Meta approved Official Business Account/Groups access and signed webhooks |
| Linked-device Web | `web` | existing ordinary groups | dedicated account already a member; manually link with QR; explicit opt-in |

**Important:** Baileys is unofficial, not affiliated with WhatsApp, and carries account restriction / disconnection risk. Meta's official Groups API cannot read normal large groups. There is no automatic same-group takeover if Web disconnects. **The other gateway's groups continue working**; Web messages already queued in W-Bot wait for reconnect. We do not clone messages to another group.

## 1. Pull and protect the existing working deployment

    cd /opt/apps/w-bot
    git switch feature/translation-mvp-lightsail
    git pull --ff-only origin feature/translation-mvp-lightsail
    cp .env .env.backup.$(date +%Y%m%d%H%M%S)
    chmod 600 .env.backup.*
    nano .env

Keep the current Gemini values. Add exactly one copy of these settings:

    DRY_RUN=true
    TRANSLATION_PROVIDER=gemini
    WEB_GATEWAY_ENABLED=true
    WEB_GATEWAY_TOKEN=GENERATE_SEPARATE_64_CHAR_RANDOM_HEX_TOKEN

Generate a random token with `openssl rand -hex 32` and keep it only in .env. Never post it in chat or GitHub.

## 2. Deploy both optional services

    sudo docker compose --profile web up -d --build
    sudo docker compose --profile web ps
    sudo docker compose --profile web logs --tail=80 api
    curl -fsS http://127.0.0.1:9028/healthz
    curl -fsS http://127.0.0.1:9028/readyz

The API stays bound to **127.0.0.1:9028**; the Web gateway port **9029** is reachable only within the private Docker network, not from the internet. MySQL is likewise private. The database applies a forward-only migration adding `gateway` to groups (existing groups default to `OFFICIAL`).

### Session pairing

The Web container emits a temporary linked-device QR code into its logs while unpaired:

    sudo docker compose --profile web logs --tail=100 web-gateway

Open **WhatsApp > Linked devices > Link a device** on a dedicated number already participating in your selected groups, then scan the QR. The QR is a **sensitive credential**. Do not screenshot/share it or send the logs to chat while an unexpired QR is visible. Anyone with your session files may control the WhatsApp account; guard the `wbot_web_auth` Docker volume and server backups. The Web gateway keeps auth state there across restarts. Baileys's file-based auth helper is suitable for a pilot, not a hardened multi-user production credential store.

### Alternative pairing when the QR graphic does not appear

The Docker log viewer may display the QR announcement without a usable QR picture. Use Baileys' optional phone-number pairing method instead. **Do this only for a dedicated WhatsApp account you control.**

In the server's `.env`, add its country code and phone number as digits only. For Sri Lankan numbers, remove the initial domestic `0` and prepend `94`:

    WEB_PAIRING_PHONE_NUMBER=94XXXXXXXXX

No plus sign, spaces, hyphens or quotation marks. **Do not post the real number or pairing code to ChatGPT or GitHub.** Keep `DRY_RUN=true`.

Pull the updated code and rebuild **only the Web gateway**:

    git pull --ff-only origin feature/translation-mvp-lightsail
    sudo docker compose --profile web up -d --build --no-deps web-gateway

View the *private* logs:

    sudo docker compose --profile web logs -f --tail=20 web-gateway

Baileys will print an eight-character pairing code when WhatsApp requests pairing. On the dedicated WhatsApp phone go to **Linked devices > Link a device > Link with phone number instead**, and enter the displayed code promptly. The pairing code is temporary and is a sensitive credential; do not share logs while it appears.

When connected, the session is saved to the existing `wbot_web_auth` Docker volume and will persist across restarts. You may comment out `WEB_PAIRING_PHONE_NUMBER` in `.env` after linking and recreate just the Web service to remove the phone value from its runtime environment.

If the code is rejected or expires, check `/api/gateways` and Web logs. Some Baileys releases can fail during phone-code linking due to WhatsApp changes; as a fallback, leave `WEB_PAIRING_PHONE_NUMBER` empty and try QR pairing from an SSH terminal with a visible QR rendering. Never delete the auth volume casually.

### Recovery after WhatsApp reports loggedOut (401)

**Only reset an authentication session that WhatsApp has rejected, not a working linked session.** A successful phone-code pairing can trigger a temporary 515 restart-required event; the Web gateway reconnects after that automatically. A subsequent 401 is different: WhatsApp rejects or revokes the credentials. Baileys documentation recommends re-pairing from fresh authentication state.

1. Check Linked devices on the WhatsApp phone, and revoke any unfamiliar linked device. The temporary code must remain private.
2. Stop the Web gateway, **not** the whole Docker Compose stack:

       sudo docker compose --profile web stop web-gateway

3. Archive the rejected auth files inside the existing private Docker volume (does not remove the volume, MySQL, or Gemini configuration):

       sudo docker compose --profile web run --rm --no-deps --entrypoint node web-gateway auth-reset.mjs --confirm-reset

4. Use a normal browser identifier rather than a custom one. This is already configured in the updated gateway code. Start fresh:

       sudo docker compose --profile web up -d --build --no-deps web-gateway

5. View pairing code or QR **only on the private SSH terminal**:

       sudo docker compose --profile web logs -f --tail=20 web-gateway

If your phone says **Couldn't link device** after entering a new code, retrying many times can cause account restrictions. Do not attempt to bypass WhatsApp device validation. Some Baileys versions have known pairing-code compatibility problems; you can try QR pairing with the dedicated number instead, or use an approved official Meta group where eligible.

For a QR attempt, comment out \`WEB_PAIRING_PHONE_NUMBER\` in \`.env\`, recreate the Web container, and open its QR display in a private terminal. Never share the live QR or pairing code. If the new attempt also yields 401, stop and report the **disconnect code and whether the phone reported successful pairing**, not the pairing credential itself.

Auth archives remain within the protected Docker volume for investigation; remove old rejected session archives securely according to your retention policy once no longer needed. Avoid deleting the entire volume.

If linked, API gateway status should show `web.status: "connected"`. If the account logs out, relink is required. Avoid deleting the session volume except for an intentionally revoked, backed-up session.

## 3. Identify joined groups

Get your existing admin API key from your own .env and enter it without echoing or pasting:

    read -rsp "Admin API key: " WBOT_ADMIN_KEY
    echo

List connected Web groups:

    curl -sS http://127.0.0.1:9028/api/web/groups \
      -H "Authorization: Bearer $WBOT_ADMIN_KEY" | python3 -m json.tool

Web group IDs normally end in `@g.us`. **The Web account must already belong to the group**; the bot does not join via link or scrape arbitrary chats. Ask group participants and admins for informed consent before processing their text using Gemini.

## 4. Register Web group with five-language targets

Use an actual JID from `/api/web/groups`:

    curl -sS -X POST http://127.0.0.1:9028/api/groups \
      -H "Authorization: Bearer $WBOT_ADMIN_KEY" \
      -H "Content-Type: application/json" \
      -d '{"groupId":"ACTUAL_GROUP_ID@g.us","gateway":"web","name":"Pilot Translation Group","enabled":true,"targetLanguages":["he","en","si","uz","ru"]}'

The existing demo group and official business groups keep their original `OFFICIAL` transport. Group transport cannot be changed implicitly through re-registration; a mismatched update returns 409.

## 5. Verify and switch to live only when ready

First, send test messages in an opted-in pilot group while `DRY_RUN=true`. They should be ingested, detected and translated in MySQL, but **nothing will be posted**. Inspect /api/messages. Only after reviewing translations, duplicate handling, account risk, and privacy, change `DRY_RUN=false` and restart:

    sudo docker compose --profile web up -d --build

Live `OFFICIAL` delivery separately requires eligible Meta Groups API authorization, an official group ID and WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID. W-Bot retains Meta webhook HMAC signature verification; official and Web groups never share their inbound authentication path.

## 6. Health and outage behavior

    curl -sS http://127.0.0.1:9028/api/gateways \
      -H "Authorization: Bearer $WBOT_ADMIN_KEY"

- `web.connected` means the linked-device session is online; `official.configured` means credentials exist, **not** that real Meta group access has been approved.
- If Web goes offline, queued Web group translations are retried on the same gateway. The bot never posts the translation into a different group.
- Ordinary WhatsApp groups cannot automatically switch to Meta's official Groups API, even when credentials exist.
- A crash between sending and saving acknowledgement can lead to repeated messages (at-least-once delivery). Improve outbox tracking, rate limits and queue observability before commercial rollout.

## 7. Operational security

Keep the endpoint `/internal/web/message` inaccessible via Nginx (only proxy the Meta webhook location). Never expose Web gateway port 9029, MySQL 3306 or the admin API publicly. Group text passes through Gemini and is stored in MySQL; implement consent, deletion/retention controls and data backup protections before real customer deployment.

For production, replace Baileys's multi-file auth with an encrypted credential store and use official APIs where eligible.

## 8. Translation speed and quoted replies

The new language set is **Hebrew / English / Sinhala / Uzbek / Russian**. Existing groups configured with exactly the previous five default languages are updated during `prisma migrate deploy`. Customized sets require manual PATCH through `/api/groups/:groupId`.

The worker polls every 500ms, and Gemini 3.x uses `minimal` thinking by default. Adjust by setting `GEMINI_THINKING_LEVEL=low` if you notice quality problems; `minimal` may trade some accuracy for speed. Logs show `queueDelayMs`, `translationMs`, `sendMs` and `totalMs`, without message contents. A live outgoing translation should **reply/quote the original sender's message**, not send a disconnected standalone post.

When deploying, rebuild both services:

    sudo docker compose --profile web up -d --build

The Web gateway's encrypted linked-device session is held in `wbot_web_auth` and should reconnect without relinking. Never run `down -v`.

## Include the original language in the reply

The outgoing translated reply now displays all five configured languages, even when the original message is already in one of them. For example, Russian input produces Hebrew, English, Sinhala and Uzbek translations plus a Russian section containing the exact original Russian message. The existing WhatsApp quote/reply behavior is unaffected.
