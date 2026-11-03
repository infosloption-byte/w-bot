# W-Bot Public Marketing Site — Trust-First Redesign

## Design intent

The original marketing site used dark surfaces, strong gradients and decorative glowing product cards. The new visual direction is a calmer B2B SaaS identity intended to communicate professional product quality and clear service boundaries.

The redesign changes only the public marketing React entrypoint and its static assets. Customer portal and Platform Admin retain their existing styling, navigation, sessions, API routes and protection.

### Identity

- Light-first interface: white backgrounds, off-white section alternation, legible dark-navy text and controlled muted teal accents.
- Simplified W-Bot wordmark/favicon; restrained labels, buttons, icons, outlines and section dividers.
- Regular software/product layout, not crypto/game-like gradients, rotating previews, bright glows or decorative badge overload.
- Realistic **conceptual workspace preview** in the hero (dashboard navigation, authorized groups and alerts). It is labeled as illustrative and does not show customer data or pretend to be a live screenshot.
- Eight public pages retain static SEO titles, descriptions, canonical URLs, sitemap entries and mobile navigation.

## Trust and content accuracy

- New homepage **Trust & transparency** section: customer-controlled connections, separately configured Translation and Smart Alerts and optional WhatsApp alert delivery.
- New `/trust/` page: group selection and consent, message handling, bounded Smart Alerts retention, external AI processing, sender identity limits and unofficial linked-device caveats.
- No invented ISO/SOC/GDPR certifications, third-party endorsements, customer counts, rankings or security audit guarantees.
- Explicitly disclose that W-Bot's Baileys linked-device integration is unofficial and may be interrupted or subject to account restrictions.
- Product copy must not imply all WhatsApp groups are automatically monitored. Existing subscription limits, admin invitation and disabled checkout remain unchanged.
- W-Bot is a technical pilot; public marketing copy never represents it as an official Meta integration.

## Files and deployment

- `frontend/src/marketing.css` — redesigned stylesheet **imported only by** `marketing-main.tsx`.
- `frontend/src/marketing-demos.tsx` — new illustrative app preview.
- `frontend/src/marketing-home.tsx` — calmer homepage with trust disclosure.
- `frontend/src/marketing-shared.tsx` — navigation, CTA and footers.
- `frontend/src/marketing-trust.tsx` and `frontend/marketing/trust.html` — trust center.
- `frontend/src/marketing-main.tsx`, `frontend/vite.config.ts`, `frontend/nginx.conf` and `frontend/public/sitemap.xml` — new route.
- `frontend/tests/marketing.test.mjs` — routes, responsive styles and trust/portal isolation checks.

### Isolated validation before merge

```bash
cd /opt/apps/w-bot || exit 1
git fetch origin
git switch --detach origin/feature/marketing-trust-first-redesign-20261103
sudo docker compose -p wbot-marketing-redesign-validation --profile portal build portal
git switch main
```

The Docker build runs TypeScript, Vite and frontend tests. Production is not changed by this validation.

### Safe rollout after successful validation

```bash
cd /opt/apps/w-bot
git switch main
git pull --ff-only origin main
sudo docker compose --profile portal build portal
sudo docker compose --profile portal up -d --no-deps --no-build --force-recreate portal
```

Only the public/portal **frontend container** is recreated; there is no backend migration. Do not change the existing HTTPS host Nginx redirect or Platform Admin Basic Auth. The public `/trust/` route is served by the already-proxied frontend container.

### Acceptance checklist

1. Desktop 1440px, tablet 768px, mobile 390px and narrow mobile 320px: hero preview fits, CTA/link rows wrap, no horizontal page scrolling.
2. All eight public routes render. Header, footer, trust links and mobile menu operate through keyboard and touch.
3. Body copy and labels stay readable, focus outlines are visible, reduced-motion preferences are respected.
4. Pricing toggle works and the commercial catalog still loads; Smart Alerts is labeled separately licensed. No unimplemented checkout or lead form is implied.
5. Customer login at `/portal/` works as before. Platform Admin `/portal/platform/` and its API remain protected by host Nginx Basic Auth.
6. Homepage and trust page accurately describe the **current** gateway and group authorization model. AI limitations and unofficial WhatsApp integration are visible.
7. Header/footer links, favicon and sitemap are correct. Verify SEO metadata with View Source on all routes.
8. Run the browser-level visual review after deploy. Automated source checks do not establish that the live UI is visually perfect.

## Future work

A branded product demo video or **approved screenshots of the actual portal** may later replace the conceptual preview. Create a formal, legally reviewed Privacy Policy and Terms of Service before wider onboarding, separately from this educational Trust page. These documents must reflect real data flows and supported procedures.
