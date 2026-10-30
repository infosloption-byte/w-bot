# W-Bot Platform Admin and Prisma build fix

Status: Implemented on the draft Model B branch, NOT deployed or merged. Build, database migration and live acceptance must pass before production use.

## Fix for failed API build

The hardening migration already adds the Message.sendStartedAt MySQL column, but prisma/schema.prisma omitted sendStartedAt. The schema now has sendStartedAt DateTime?, matching the existing migration and the worker code. The Docker build regenerates Prisma Client via npx prisma generate. Do not add the MySQL column twice.

## Platform Admin vs customers

- Existing customer accounts and tenant permissions are unchanged. Customer authentication lives under /portal/api and the customer dashboard at /portal/.
- Platform administrators use dedicated PlatformAdmin, PlatformSession and PlatformAudit database models, NOT TenantMember records. Customer session cookies cannot authenticate to platform APIs.
- New platform login: /portal/platform/. API prefix: /portal/api/platform. Initial SUPER_ADMIN must be provisioned locally via an explicit Docker CLI action. There is NO public platform-admin registration.
- Eight-hour, HttpOnly, SameSite=Strict sessions with Secure flag when HTTPS is enabled. Sessions store token hashes, not plaintext tokens. Mutations require matching Origin and the custom request header. Platform login is rate-limited for this invite-only pilot.
- Console: overall counts, customer workspaces, customer users, plan status/limits, groups, queued/failed/uncertain deliveries, shared gateway status, customer audit trail and platform administrative actions.
- SUPER_ADMIN can update tenant limits and pause or enable previously authorized groups. VIEWER can monitor but not mutate. Operator changes are audited.
- No raw messages, phone numbers, WhatsApp JIDs, or linked authentication data are returned through monitoring endpoints.

## Deployment safety

1. Take a Lightsail snapshot and a MySQL backup. Preserve the existing wbot_mysql and wbot_web_auth Docker volumes. Never run docker compose down -v.
2. On the server, pull the feature branch and build WITHOUT restarting live services:

    cd /opt/apps/w-bot
    git pull --ff-only origin feature/model-b-shared-number-saas
    sudo docker compose --profile web --profile portal build api portal

Do not deploy if either build fails. The API Dockerfile runs TypeScript compilation and backend tests; Vite builds both customer and platform pages.

3. After a verified backup and clean build, deploy API and portal (the API automatically runs both pending Prisma migrations):

    sudo docker compose --profile web --profile portal up -d --no-build api portal
    sudo docker compose --profile web --profile portal ps
    sudo docker compose --profile web logs --tail=80 api
    curl -fsS http://127.0.0.1:9028/readyz
    curl -fsS http://127.0.0.1:9048/healthz

No need to recreate the Web gateway or clear its persistent credentials.

4. Provision the FIRST Platform Admin account from a trusted Lightsail shell, once the migration has applied. Do NOT put passwords in chat, GitHub, shell history or .env. These Bash prompts are safer than passing a password as a literal command argument:

    read -r -p "Platform admin email: " WBOT_PLATFORM_EMAIL
    read -r -s -p "Platform admin password (16+ characters): " WBOT_PLATFORM_PASSWORD
    echo
    printf '%s\n' "$WBOT_PLATFORM_EMAIL" "$WBOT_PLATFORM_PASSWORD" "W-Bot Platform Owner" |
      sudo docker compose exec -T api node dist/bootstrap-platform-admin.js
    unset WBOT_PLATFORM_EMAIL WBOT_PLATFORM_PASSWORD

The CLI creates the initial SUPER_ADMIN and refuses to run again after one has been created.

5. On Windows use the existing SSH tunnel and visit:

    http://localhost:19032/portal/platform/

Customer login remains at http://localhost:19032/portal/. The Lightsail portal HTTP port is still loopback 9048. Do NOT expose this console to the public internet. For future HTTPS set SAAS_COOKIE_SECURE=true.

## Acceptance checklist

- Prisma generate, TypeScript, backend tests and both frontend pages compile; migrations apply cleanly, with no duplicate columns.
- Customer A and B can still sign in, manage their own groups and translate messages.
- Customer session cookies cannot access any platform API, including overview, tenants, users, groups and deliveries.
- Platform sign-in works, invalid/expired cookies are denied, password change revokes all sessions, and admin actions are recorded.
- Platform overview counts match the database and shared gateway status. Workspaces, users and groups show correct tenant associations.
- Adjust a pilot tenant's plan and verify customer quota enforcement. Pause/enable a previously consented group and check the admin audit log.
- Delivery errors show metadata only. No private message text or sender identifiers appear in platform responses.
- Retention deletes expired platform sessions and message history according to the configured retention period.

## Limitations

This is a functional invite-only pilot, not an authorized commercial WhatsApp integration. Baileys remains unofficial. Paid Paddle billing, platform-admin MFA, robust admin recovery, security reviews, cross-instance rate limiting, paging beyond 100 entries, and long-term queue/delivery robustness remain work to complete before a public launch.
