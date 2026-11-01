
# W-Bot Model B — customer security and reliability upgrade

Status: **Implemented in a draft PR; requires a clean Docker build, database backup, and staging/live verification.**
This does **not** make the unofficial Baileys client an authorized commercial Meta integration.

## Changes by requirement

1. **Tenant isolation:** Customer groups, activation history, audit events and usage queries are tenant-scoped. Direct-REST tests cover cross-customer group listing, updating, and disconnection; group claims reject other tenants. Global admin APIs remain private on localhost. No customer can choose arbitrary WhatsApp identifiers in customer APIs.
2. **Account management:** Profile and workspace updates, password change with all sessions revoked, opt-in email verification, resend verification, forgot/reset password with expiring one-time hashed email tokens. SMTP supports port 465 or STARTTLS. Reset requests avoid account enumeration. Existing portal users are marked verified once by migration, preserving pilot access.
3. **Group lifecycle:** Activation history, consent acknowledgment, group-admin proof via live Baileys metadata, group ownership verification, activation audit event, pause/resume and disconnect with confirmation, and per-group stored-message deletion.
4. **Subscriptions and quotas:** A tenant subscription defines group and monthly message allowances, status, optional period end. Per-tenant/per-UTC-month counters are transactionally reserved on message creation, unique inbound message keys block duplicate charging. Plan status is enforced at activation and enqueue; group activation locks the workspace row before group-limit checks. Operators can update pilot subscriptions using the admin-only API. **No payment processor integration is included.**
5. **Reliability:** Queue jobs are chosen round-robin among candidate tenants to reduce starvation. Expired translation jobs are recovered, but jobs whose outbound send may have been issued become DELIVERY_UNCERTAIN instead of being automatically duplicated. A periodic shared gateway health check records status and can notify a configured operations email after sustained downtime. A durable distributed queue and exactly-once delivery are still not provided by Baileys.
6. **Privacy:** Tenant-isolated audit trail without message bodies, consent at activation, deletion endpoint for group message history, and hourly bounded purging of completed messages older than the retention window (30 days default), expired sessions and auth tokens. The dashboard discloses that group messages are processed by external AI and a WhatsApp Web integration.

## Critical migration and rollout

Before deployment take a **Lightsail snapshot and MySQL backup**. Confirm the live pilot is functioning and preserve the existing `wbot_web_auth` volume. Don't run `docker compose down -v`.

The forward-only migration `20261030000100_model_b_hardening` adds tables and nullable columns without deleting current customers or groups. It backfills existing current-month tenant message usage from claimed groups and marks already-registered users as verified for continuity. Existing group consentAt is set from original claimedAt.

The API Docker entrypoint applies Prisma migrations before starting. **Build first, without restarting the working bot**:

    cd /opt/apps/w-bot
    git pull --ff-only origin feature/model-b-shared-number-saas
    sudo docker compose --profile web --profile portal build api portal

If either build fails, **do not run up**. Share the error and fix it before changing the running services.

Only after both builds and tests pass, and after a verified backup, schedule the migration/restart:

    sudo docker compose --profile web --profile portal up -d --no-build
    sudo docker compose --profile web --profile portal ps
    curl -fsS http://127.0.0.1:9028/readyz
    curl -fsS http://127.0.0.1:9048/healthz

The portal is still bound to loopback via `WBOT_PORTAL_PORT` (9048 on this Lightsail server). The current SSH tunnel URL is http://localhost:19032/portal/.

## Configure email before enabling verification

Existing customers can continue signing in without any new settings. SMTP sending requires:

    SMTP_HOST=smtp.gmail.com
    SMTP_PORT=465
    SMTP_USER=<your configured sender address>
    SMTP_PASSWORD=<a valid SMTP app password>
    SMTP_FROM=<the verified sender address>
    PORTAL_PUBLIC_URL=https://YOUR_REAL_WBOT_DOMAIN/portal/
    SAAS_REQUIRE_EMAIL_VERIFICATION=true

For SMTP test over the private localhost tunnel only, a `http://localhost:19032/portal/` public URL may be used by that same local test browser; **never use localhost URLs in customer-facing emails**. Configure DNS, HTTPS, and a trusted sender before customer onboarding. Without SMTP, password recovery emails cannot be delivered. When email verification is enabled, new signups must verify email before requesting group activation codes. Legacy customers are backfilled to preserve the existing pilot.

Optional operations alerts:

    GATEWAY_ALERT_EMAIL=<operations mailbox>
    MESSAGE_RETENTION_DAYS=30

There is no payment processor in this code; editing a subscription is an operator action, not self-service billing. To change a pilot workspace's plan, use the existing localhost admin API:

    PATCH /api/tenants/:tenantId/subscription
    Authorization: Bearer <ADMIN_API_KEY>
    Content-Type: application/json

JSON body example:

    {"planCode":"PILOT","status":"ACTIVE","groupLimit":3,"monthlyMessages":1000,"periodEnd":null}

Do not publish global admin endpoints, API keys, database connection strings, Baileys auth files, activation codes or access tokens.

## Manual acceptance checklist

- Sign in to Customer A and Customer B in separate browser profiles. Customer B cannot list, change, disconnect, see history for, or claim Customer A's groups, including when directly calling /portal/api.
- Register a new verified customer with SMTP enabled. Test verification link expiry, resent link, reset-password link, invalid/used link, password-change logout on all sessions, and profile update.
- Confirm group activation requires consent acknowledgment and a fresh command from a **current** WhatsApp group admin, with 15-minute expiring codes. Confirm group history and audit events appear only in the proper workspace.
- Test one group at its cap, repeated inbound webhook event with the same message ID (must not charge twice), and two simultaneous messages with one slot remaining (only one should be accepted).
- Test queued traffic from two workspaces and a simulated gateway interruption. Ensure no double send is automatically attempted when delivery is marked uncertain.
- Inspect gateway status and alert delivery after a sustained outage; test the data-retention job on records older than the configured cutoff; verify deletion does not affect other tenants.
- Turn off WEB_ACTIVATION_DEBUG after troubleshooting.

## Important limitations

- **Not approved for a paid/public WhatsApp SaaS**: Baileys is unofficial; seek authorization / officially supported Meta group capability before commercializing.
- No Paddle checkout/webhooks/invoices yet; subscriptions are administratively assigned.
- No durable external message queue; the existing MySQL queue remains, with recovery safeguards. Ambiguous WhatsApp sends are held for manual reconciliation, not resent automatically.
- The per-process login rate limiter is for invite-only pilots; public availability needs shared rate limiting, distributed worker locks, and dedicated penetration and privacy reviews.
- SMTP/delivery is only ready when credentials, sender authorization and HTTPS URL are configured and tested.
- Test/deployment is incomplete until the Lightsail Docker build, Prisma migration and manual smoke tests pass.

## Reconcile ambiguous outbound delivery (operator only)

If an outbound send was initiated but the server could not persist the gateway acknowledgment, its status becomes DELIVERY_UNCERTAIN. The worker will not resend it automatically. Investigate actual WhatsApp delivery first, then use the localhost admin-only endpoint:

    POST /api/messages/<internal-message-id>/reconcile
    Authorization: Bearer <ADMIN_API_KEY>
    Content-Type: application/json

    {"action":"mark_delivered"}

Use `{"action":"retry"}` **only after verifying** that WhatsApp did not deliver the original; a retry may create a duplicate message. The operation writes a tenant audit event when applicable. Neither the private admin API nor its key belongs in the customer portal.

For explicit stored-message deletion, pause translation for that group first. The data-deletion endpoint rejects active groups to reduce racing with queued sends. The retention job deletes all message states older than the configured cutoff, including stale pending jobs, in bounded hourly batches.
