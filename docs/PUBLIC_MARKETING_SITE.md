# W-Bot Public Landing & Marketing Website

## Scope

This feature adds a public marketing website at **https://wbot.sloptions.xyz/**, built from the existing React/Vite frontend. It does not replace customer login at `/portal/` or the separately protected Platform Admin UI at `/portal/platform/`.

### Pages

| Public URL | Purpose |
| --- | --- |
| `/` | Homepage: product positioning, illustrative interface, two services, industry examples, setup guide and CTA |
| `/translation/` | Group Translation overview, source-quoted group replies, languages and authorization |
| `/smart-alerts/` | Universal AI search rules, monitoring, private Inbox and optional WhatsApp notifications |
| `/how-it-works/` | Centralized WhatsApp connection and the independent Translation and Smart Alerts workflows |
| `/pricing/` | Translation Starter/Team/Business monthly and annual tiers; Smart Alerts separately licensed |
| `/faq/` | Data handling, consent, eligibility, sender identity, reliability and subscriptions |
| `/contact/` | Pilot access and enquiries, linked to the existing SL Options corporate contact page |

The marketing site uses a separate Vite entry `src/marketing-main.tsx` and page-specific HTML documents under `frontend/marketing/`. Each document has its own title, description, canonical URL, Open Graph metadata and Twitter summary. Responsive CSS is scoped to the marketing entry and is **not imported into the customer or Platform Admin portals**.

Vite builds all nine HTML entries (customer + Platform Admin + seven public pages) from `frontend/vite.config.ts`; `frontend/Dockerfile` includes `marketing` and `public` and serves the generated files from the existing portal container.

A favicon, robots.txt and sitemap.xml are provided. Assets under `/portal/assets/` remain crawlable for JavaScript rendering, but account and API pages are not intended for indexing. For stronger organic-search optimization, server-side prerendered marketing text is a follow-up improvement; meta tags are already static per route.

## Product claims and limitations

- **Translation:** published Starter ($69/mo or $690/yr, 1 number / 10 groups), Team ($179/mo or $1,790/yr, 2 / 30), Business ($329/mo or $3,290/yr, 5 / 50). Prices are initialized from the current canonical catalog and **refreshed from the public** `GET /portal/api/plans` endpoint when available. There is no fixed monthly text message allowance, but service is still subject to fair-use, provider throughput and gateway limitations.
- **Smart Alerts:** an independently subscribed service using its own authorized monitored groups, AI analysis limits and private inbox. No fixed public price is claimed.
- **Payments:** self-service Paddle checkout is **not** integrated. "Request access" links to `/contact/`, which directs people to SL Options' company contact site. It does **not** submit a nonfunctional form or claim payment succeeded.
- **Pilot:** account registration requires an invitation code. Public marketing does not create accounts or bypass subscription or group-access checks.
- **WhatsApp:** customer-owned linked-device connector is an unofficial Baileys integration, **not** an official Meta Business/Groups API partnership. Group membership and appropriate authorization/participant notice are required. No group joining, mass outreach or unsolicited scraping.
- **Privacy:** sender numbers may be unavailable when WhatsApp only provides an anonymized identity. AI matches are probabilistic. Do not advertise this as guaranteed lead capture or guaranteed WhatsApp delivery.
- **Social proof:** there are no invented user counts, testimonials, guaranteed business results or official integrations.

## Deployment validation — non-disruptive

After this feature PR is open, build it in an isolated project without touching production:

```bash
cd /opt/apps/w-bot || exit 1
git fetch origin
git switch --detach origin/feature/public-marketing-site-20261103
sudo docker compose -p wbot-marketing-validation --profile portal build portal
git switch main
```

The portal Docker build runs TypeScript, Vite and frontend regression tests. Do **not** merge/deploy if it fails.

After successful validation and merging:

```bash
cd /opt/apps/w-bot
git switch main
git pull --ff-only origin main
sudo docker compose --profile portal build portal
sudo docker compose --profile portal up -d --no-deps --no-build --force-recreate portal
curl -fsSI http://127.0.0.1:9048/
curl -fsSI http://127.0.0.1:9048/pricing/
curl -fsSI http://127.0.0.1:9048/portal/
curl -fsSI http://127.0.0.1:9048/sitemap.xml
```

These commands **do not** restart API, MySQL or either WhatsApp gateway and require **no Prisma migration**.

### Required host Nginx adjustment

The current public `https://wbot.sloptions.xyz/` host may still have an exact-match redirect: `location = / { return 302 /portal/; }`. To publish the marketing homepage, **remove only that exact-match redirect** from the active **HTTPS vhost**, allowing the existing `location / { proxy_pass http://127.0.0.1:9048; ... }` rule to forward root and public paths to the portal container.

1. Inspect the active configuration using `sudo nginx -T`; it may differ from the example in `deploy/nginx/wbot.sloptions.xyz.conf` because Certbot modified it.
2. Back up the *live file* in `/etc/nginx/sites-available/`, then edit the HTTPS server block. Preserve TLS, proxy headers, `/portal/platform/` and `/portal/api/platform/` **Basic Authentication** rules verbatim.
3. `sudo nginx -t && sudo systemctl reload nginx`. Do not blindly overwrite the live vhost with the sample repo file.
4. Verify `curl -IL https://wbot.sloptions.xyz/` gives HTTP 200 (no login redirect), while `/portal/` still loads and **unauthenticated** `/portal/platform/` and `/portal/api/platform/me` remain HTTP 401 under the host's Basic Auth policy.
5. Verify each public route, `robots.txt`, `sitemap.xml`, customer signup/recovery and mobile navigation. Perform a browser hard reload after deployment.

If the root redirect remains in host Nginx, all new marketing pages except the homepage can still be reachable, but `/` will continue redirecting to `/portal/`.

## QA / launch checklist

- Desktop 1440px and mobile 390px: no horizontal scrolling, CTA links and dropdown navigation work.
- Site pages: correct URL and per-page title/canonical, no portal secrets or internal API data.
- Pricing: monthly/yearly toggle, annual total, separate Smart Alerts licensing, no false checkout promises.
- Conversion: Request Access takes users to the public contact page, and company contact link opens the actual SL Options site (verify the `/contact` route externally before launch).
- Existing portal: login, invitation-only signup, password reset, active connections, Translation and Smart Alerts remain unchanged.
- Security: unauthenticated Platform Admin UI and API continue to require Basic Auth at the host reverse proxy; no public link should expose them.
- Operations: healthz and gateway containers remain healthy. Marketing pages can be rolled back by redeploying the previous portal image if needed.

## Next marketing enhancements

Add reviewed W-Bot-specific privacy/terms pages, official social media previews with an approved brand asset, analytics with consent controls, case studies when evidence exists, verified domain indexing through Google Search Console and Bing Webmaster Tools, and optional SSR/prerendering for more robust SEO. A secure, rate-limited lead request backend may replace the corporate contact link when its mail workflow is configured and tested.

## Visual design

The public site uses a light "Clear Indigo" theme that shares the indigo + teal identity of the customer portal (`src/marketing.css`, scoped to the marketing entry). Illustrations live in `src/marketing-graphics.tsx` and are drawn with markup and CSS only (no external images, so the strict Nginx CSP is unaffected). Every product mock-up is labelled "Illustrative example"; no customer counts, testimonials or guaranteed results are shown.
