# Publish W-Bot at wbot.sloptions.xyz (Lightsail + Nginx + HTTPS)

**Status: Reference configuration only; NOT live-deployed.**
The W-Bot Docker portal currently runs on the Lightsail instance at
`127.0.0.1:9048` (check with Docker Compose). API stays on `127.0.0.1:9028`;
WhatsApp gateway and MySQL remain on private Docker networks. The customer
portal is ready for public HTTPS access only after the invite-only pilot's
security/privacy safeguards are reviewed.

## 1. DNS

In the authoritative DNS zone for `sloptions.xyz`, add an **A record**:
- Host/name: `wbot`
- Value: **the static public IPv4 address assigned to the Lightsail instance**
- TTL: 300 seconds, if supported

Do **not** copy a guessed IPv4 address, edit root/www records, or change email MX/TXT records.
Confirm the instance IP in Lightsail's Networking pane; assign a **static IP** if needed.

Check DNS from the server:

    dig +short @1.1.1.1 wbot.sloptions.xyz A
    dig +short @8.8.8.8 wbot.sloptions.xyz A

Check the portal port from the W-Bot directory:

    cd /opt/apps/w-bot
    sudo docker compose --profile portal port portal 8080
    curl -fsS http://127.0.0.1:9048/healthz
    curl -fsSI http://127.0.0.1:9048/portal/

If the returned host port differs from 9048, change all 9048 occurrences in
`deploy/nginx/wbot.sloptions.xyz.conf` before installation.

## 2. Host Nginx

Use the existing host Nginx instance that already serves other domains. The
example vhost is in `deploy/nginx/wbot.sloptions.xyz.conf`.

Create the second access layer for Platform Admin, **before enabling the vhost**:

    if ! command -v htpasswd >/dev/null; then sudo apt-get update && sudo apt-get install -y apache2-utils; fi
    sudo htpasswd -c /etc/nginx/.wbot-platform-users wbotoperator
    sudo chown root:www-data /etc/nginx/.wbot-platform-users
    sudo chmod 640 /etc/nginx/.wbot-platform-users

The Basic Auth password must be different from your W-Bot Platform Admin
password. Never put either password into chat, GitHub or shell commands.
If the Nginx worker runs under a different group than `www-data`, adjust
permissions for that worker.

Install a **new** site without overwriting unrelated websites:

    sudo install -m 644 deploy/nginx/wbot.sloptions.xyz.conf /etc/nginx/sites-available/wbot.sloptions.xyz
    sudo ln -s /etc/nginx/sites-available/wbot.sloptions.xyz /etc/nginx/sites-enabled/wbot.sloptions.xyz
    sudo nginx -t && sudo systemctl reload nginx

If the symlink already exists, inspect it before changing anything.
Make sure Lightsail allows inbound TCP 80 and 443, but **never** expose the
Docker portal 9048, API 9028, MySQL 3306, or Web gateway 9029.

## 3. HTTPS (required before login)

Wait until DNS points to this exact Lightsail instance. Certbot must be
installed with the Nginx plugin (you may already have it). Then run:

    sudo certbot --nginx -d wbot.sloptions.xyz --redirect
    sudo nginx -t && sudo systemctl reload nginx
    sudo certbot renew --dry-run

Do not log in or enter Basic Auth credentials over HTTP while TLS is not
configured. After certbot, **inspect the generated 80/443 Nginx blocks**
(`sudo nginx -T`) to verify that both admin paths still require Basic Auth on
HTTPS and that HTTP redirects to HTTPS.

The public marketing homepage is:
- https://wbot.sloptions.xyz/

The customer workspace and sign-in page is:
- https://wbot.sloptions.xyz/portal/

Platform Admin (two successive logins: Nginx Basic Auth then W-Bot):
- https://wbot.sloptions.xyz/portal/platform/

The root of the subdomain is the **public marketing homepage** after the public-site deployment and active HTTPS vhost update. The customer login remains at `/portal/`.

## 4. Production app settings

In `/opt/apps/w-bot/.env` set:

    SAAS_COOKIE_SECURE=true
    PORTAL_PUBLIC_URL=https://wbot.sloptions.xyz/portal/
    WEB_ACTIVATION_DEBUG=false

Never change database credentials, WhatsApp auth volume, or current signup
invitation code as part of DNS setup.

Because `api` uses the environment from `.env`, after a backup and during a
short maintenance window, recreate **only** the API container if any variable
has changed:

    sudo docker compose --profile web up -d --no-deps --force-recreate api

This briefly interrupts API translations, while preserving database and
Baileys auth volumes. Plan and check carefully: with secure cookies enabled,
the old plain-HTTP localhost tunnel may no longer behave consistently across
browsers (especially Safari); use the new HTTPS address for sign-in.

**Important:** If `SAAS_REQUIRE_EMAIL_VERIFICATION=true`, make sure SMTP is
working and verification/reset links use the actual HTTPS portal URL. Do not
enable verification if SMTP is not configured.

## 5. Security verification

    curl -IL https://wbot.sloptions.xyz/
    curl -fsSI https://wbot.sloptions.xyz/portal/
    curl -I https://wbot.sloptions.xyz/portal/platform/
    curl -I https://wbot.sloptions.xyz/portal/api/platform/me

Expected after marketing deployment: root HTTP 200 (not a login redirect), customer page HTTP 200, and both unauthenticated
platform paths HTTP **401** from external Nginx Basic Auth.
`https://wbot.sloptions.xyz/portal/api/me` should still return an app-level
HTTP 401 when no customer is logged in.

After logging in through HTTPS, verify customer sign-in, group listing,
language changes and existing WhatsApp translations without editing any
Docker auth volumes.

## Marketing root-route migration

The original example vhost had `location = / { return 302 /portal/; }`. The marketing-enabled sample no longer includes that redirect. The **active live HTTPS Nginx config may still have it**. Inspect `sudo nginx -T`, back up the live vhost, remove only this root redirect, retain all Basic Auth protections, then `sudo nginx -t && sudo systemctl reload nginx`. Do not overwrite Certbot-managed TLS blocks with a plain HTTP sample. See [public marketing site guide](PUBLIC_MARKETING_SITE.md).

## Security caveats

The W-Bot pilot uses unofficial Baileys/WhatsApp Web. DNS and HTTPS do not make
this an authorized Meta commercial integration. Platform Admin lacks MFA and
self-service recovery; Nginx Basic Auth offers a limited second independent
secret, **not full MFA**. A managed identity-aware gateway (e.g. Cloudflare
Access), MFA and security testing are recommended before wider public access.

The host vhost must not be removed in favor of a simple `location / { proxy_pass ...; }`
without retaining dedicated protection on both `/portal/platform/` and
`/portal/api/platform/`.
