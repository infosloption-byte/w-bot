# Platform-managed translation languages

Status: Implemented on the existing draft Model B branch. Live build, database migration, and WhatsApp translation smoke test remain to be verified.

## What the platform admin can do

Use the SSH-tunnel-only admin dashboard at http://localhost:19032/portal/platform/ and open **Languages**.

- Inspect a global catalogue of languages and whether customers can select them.
- Enable or disable languages, add another language using a two- or three-letter ISO code and a name, and review language changes in the Platform Audit.
- The initial five (Hebrew `he`, English `en`, Sinhala `si`, Uzbek `uz`, Russian `ru`) stay enabled.
- 23 useful additional language presets (French, Spanish, German, Arabic, Hindi, Tamil, Japanese, Chinese, Portuguese, Korean, Italian, Turkish, Dutch, Ukrainian, Polish, Bengali, Malayalam, Telugu, Indonesian, Thai, Vietnamese, Filipino and Nepali) are registered **disabled**. An admin can enable them as appropriate.
- Further ISO-code languages can be registered with the **Add language** form. Newly added languages can start enabled or disabled.
- At least one language must remain enabled. Only the `SUPER_ADMIN` role can change the catalogue; platform viewers may view it.

## What the customer sees

After enabling a language, customers can find it in **My Groups** in the customer portal at http://localhost:19032/portal/. Group settings still belong to that customer and are validated server-side. Up to **10 enabled languages per group** can be selected, to limit Gemini request size and the WhatsApp reply length. The API rejects unknown, disabled, duplicate and over-limit selections.

Newly activated groups still start with the previously working five enabled defaults (or up to five currently enabled alternatives if none of those defaults remain available). Adding/enabling a new language does **not** silently alter any customer's group selections. Customers select new languages for the individual groups that need them.

Disabling a language does not delete stored group preferences. The translation worker filters disabled targets for newly processed messages. When a group is edited or a language toggled, unsent **PENDING** cached translation output is invalidated. An already in-flight delivery may still complete. Re-enabling a language restores its availability, including saved preferences. A group with zero enabled targets will produce no new translation reply until the customer selects one.

Translation labels are taken from the catalogue instead of the old hard-coded five. Gemini receives the explicit language names for the selected ISO codes in its structured request; the current Google Translation provider uses the same ISO target codes. Provider quality/availability can vary for individual languages. The 3900-character outbound WhatsApp message limit remains: very long messages with many target languages may fail, so test new combinations on a small group before broad adoption.

## Database migration / deployment

A new forward-only migration `20261030000300_language_catalog` adds `LanguageCatalog` and seeds the 28 initial records. It does **not** delete or rewrite existing groups, messages, customer sessions, platform admins or Baileys sessions.

**Before applying migrations, back up MySQL and take a Lightsail snapshot.** Do not clear Docker volumes or run `docker compose down -v`. If the previous API and portal are working, continue to run them during the build:

    cd /opt/apps/w-bot
    git pull --ff-only origin feature/model-b-shared-number-saas
    sudo docker compose --profile web --profile portal build api portal

The API Dockerfile compiles TypeScript and runs tests. The portal Dockerfile builds the customer and platform dashboards. Only after both builds pass and backup is confirmed, deploy:

    sudo docker compose --profile web --profile portal up -d --no-build api portal
    curl -fsS http://127.0.0.1:9028/readyz
    curl -fsS http://127.0.0.1:9048/healthz

The API entrypoint automatically runs Prisma migrations. The WhatsApp Web gateway does not need to be rebuilt, restarted or re-paired. The portal remains loopback-only and accessed through the existing Windows SSH tunnel.

## Manual acceptance

1. Verify there are 28 catalogue rows and exactly five initially enabled (unless the admin has already changed them).
2. Sign in to Platform Admin; enable French and Spanish. Confirm they appear in Customer A's **My Groups** selection. Add a custom language with a valid ISO code.
3. In Customer A's group, select French and Spanish in addition to the original five; send a short test WhatsApp message from another participant and verify the quoted Gemini reply includes all selected language headings.
4. Disable Spanish in Platform Admin; verify it disappears as an available customer option and that new replies omit Spanish while preserving the saved selection. Re-enable it and confirm the option returns.
5. Use Customer B's cookie to call the platform language POST/PATCH endpoints; both should be rejected. Use a platform VIEWER account, if one exists, to confirm mutation is denied. Confirm changes appear in Platform Audit.
6. Ensure a group cannot be configured with zero, duplicate or more than ten enabled targets, and that a stale/disabled code cannot be submitted via a direct API request.
7. Test a short 6- or 7-language message and a longer message near the WhatsApp text limit. More language output can exceed WhatsApp's reply-size limit; it is not silently truncated or mislabelled.

## Security and operational notes

This remains a private technical pilot using an unofficial WhatsApp linked-device gateway. It is not an authorized Meta commercial groups API. Adding more languages does not change the current quota or subscription limits; message usage is still counted by incoming messages, not by language count. Costs and translation latency may rise with more selected languages.
