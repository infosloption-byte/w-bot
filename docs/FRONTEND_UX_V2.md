# W-Bot frontend workspace redesign — implementation notes

Source of truth: customer app `frontend/src/main.tsx`, associated workspace components, and platform admin `frontend/src/platform-main.tsx`.

## Design goals
- One login, centralized customer-owned WhatsApp sessions, and two independent paid features: Translation and Smart Alerts.
- Make navigation match customers' actual tasks rather than implementation chronology.
- Remove **Add Group** from top-level navigation. Group onboarding must be reached through the relevant service and WhatsApp Connections.
- Keep separate Translation group approval and Smart Alerts monitored-group consent. Do not automatically enroll a WhatsApp group for either service.
- Share an updated visual system across customer and administrator portals, with readable contrast, keyboard-focus states, mobile navigation, adaptive cards, and reduced-motion support.

## New customer navigation
| Section | Subpages | Existing implementation reused |
| --- | --- | --- |
| Dashboard | Unified overview and setup checklist | CustomerDashboard, existing workspace counters |
| Translation | Overview; Groups & Languages; Activity | Translation group controls, language chips, translation usage |
| Smart Alerts | Overview; Monitored Groups; Intelligent Searches; Inbox | Existing SmartAlerts APIs, subscription, group selection, rules and inbox |
| WhatsApp Connections | Connected Accounts; Add Account; Pairing & Reconnection | Existing BYON creation, QR/phone pairing, state polling, verified group-admin command |
| Plans & Usage | Translation Subscription; Smart Alerts Subscription; Limits & Usage | Existing FeatureHub and WorkspaceActivity; Alerts usage |
| Settings | Profile; Workspace; Security | Existing profile/password account endpoints |

## Setup journey
1. Customer signs in and sees a unified service dashboard with connected WhatsApp status.
2. Customer reviews independent Translation and Smart Alerts subscription entitlements in Plans & Usage. During the pilot, Platform Admin assigns entitlements; do not advertise live checkout.
3. Customer links their own WhatsApp account using QR or a phone pairing code under Connections. One session can be used for both licensed services.
4. Translation: open Translation Groups & Languages, perform existing group-admin activation when required, then select languages. Shared-bot legacy groups remain visible for management.
5. Smart Alerts: choose authorized monitored groups, separately consent to private AI analysis, save flexible label/value searches, then review matches in the private inbox.
6. Customer can pause either feature independently without altering the other feature's processing.
7. Account settings keep profile, workspace and security management distinct.

## Platform Admin
Shares the visual refresh. Existing separate subscription assignment, WhatsApp policies, language catalog, customer directory, delivery reconciliation and audit controls remain in place; overview summarizes active Smart Alerts entitlements alongside Translation metrics.

## Guardrails and compatibility
- No changes to Prisma schema, API routes, queue workers, gateway session volumes, translation send behavior, billing entitlements or subscription prices.
- Existing authentication, profile update, password reset and group-deletion confirmations remain.
- Legacy shared-bot group activation is not removed from the API. Its obsolete standalone customer navigation item is removed.
- All Smart Alerts inputs and group controls still call their existing tenant-scoped endpoints. AI matching is not modified.
- This redesign is frontend-only. The build should run `npm run build` in `frontend`, which runs TypeScript, Vite and Node UI structural tests.
- Test on desktop and mobile: sidebar, each submenu, linking, QR/pairing, subscription gating, group activation, consent, searches, inbox, account settings and Platform Admin.
- Do not recreate the WhatsApp gateway containers solely for this UI change.

## Remaining UX enhancements after phase 1
- True route URLs / browser back-state and direct links instead of in-memory section state.
- Search templates, rule testing sandbox and confidence explanations for Smart Alerts.
- Admin approval/self-service billing integration once a payment provider is connected.
- More comprehensive end-to-end Playwright coverage for keyboard interactions and mobile workflows.

**Status:** development branch / pull request until separately tested and merged.
