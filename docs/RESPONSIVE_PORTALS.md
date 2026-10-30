# Responsive Customer Portal and Platform Admin

**Implementation:** Shared responsive sidebar and layout styles for both Vite/React applications. This is a **frontend-only** update: no database schema, Prisma migration, gateway change or authentication reset is required.

## Navigation experience

- **Desktop (901px and wider):** Click the chevron in either sidebar's header to collapse it to an icon-only strip (approximately 76px) or expand it to full width. The selection is stored in browser localStorage independently for Customer and Platform Admin. Every icon-only entry has a text tooltip and accessible label.
- **Mobile and small tablet (up to 900px):** Tap the header's menu control to open a full-height, scrollable side drawer. Select a menu item, tap the backdrop, tap close, or press Escape to close it. Background scrolling is disabled while the drawer is open. Tab and Shift+Tab stay within the open drawer. It automatically closes when resizing to desktop width.
- Sidebar preferences and navigation remain client-side. They do not modify permissions, subscriptions, group settings or messages.

## Responsive screens

Both customer and platform views are adaptive:
- Phone-sized screens use one-column metric cards, forms, group cards and activity panels; buttons and language chips wrap.
- Platform Admin tables turn into labeled, stacked record cards on narrow phones (700px and below), preserving the owner, status, quota, group and action fields without requiring horizontal scrolling.
- Tablets use responsive two-column metrics and single-column content where necessary. Tables remain horizontally scrollable when their columns won't fit; no data is silently omitted.
- Confirmation dialogs stay within the viewport and scroll vertically as needed. The onboarding activation command wraps rather than causing page-wide horizontal overflow.
- Login and password-reset forms are usable on phones, with 16px inputs to reduce Safari auto-zoom and safe-area support.

## Build and checks

The portal Docker builder now runs TypeScript, Vite and four source-based responsive/accessibility contract tests. These are **not a substitute for device/browser visual checks**. No backend image rebuild is necessary.

Pull/build without restarting your functioning WhatsApp bot:

    cd /opt/apps/w-bot
    git pull --ff-only origin feature/model-b-shared-number-saas
    sudo docker compose --profile portal build portal

If the portal image builds successfully, deploy **only the portal**:

    sudo docker compose --profile portal up -d --no-deps --no-build portal
    curl -fsS http://127.0.0.1:9048/healthz

The API, MySQL and Baileys gateway remain running and their volumes are untouched.

## Manual device QA checklist

Test **both** /portal/ (Customer) and /portal/platform/ (Admin) through the existing tunnel. Chrome/Firefox DevTools device toolbar can emulate each viewport; also test at least one physical phone.

| Width | Example | Expected behavior |
|---|---|---|
| 320px | narrow Android phone | One-column cards; hamburger drawer; no page-wide horizontal scrolling |
| 375px / 390px | iPhone | Sidebar drawer; group language chips wrap; account forms readable; activation command can be copied |
| 430px | larger phone | Readable cards and confirmation modals; scrollable drawers |
| 700px | small tablet/landscape phone | Admin tables render labeled cards; dialog remains fully scrollable |
| 768px / 820px | tablet portrait | Off-canvas drawer; two-column cards where space permits |
| 900px | tablet landscape | Off-canvas drawer; no horizontal navigation strip |
| 1024px | tablet landscape / small laptop | Desktop sidebar; chevron collapses/expands; metric cards adapt |
| 1280px / 1440px | desktop | Full sidebar plus optional icon-only compact mode; admin tables displayed normally |

Check:
1. **Customer:** Sign in, expand/collapse sidebar, switch Overview / My Groups / Add Group / Workspace / Activity & Plan; edit a group; display/close confirmation dialogs; long group names; more than five language choices.
2. **Platform Admin:** Sign in, navigate all sections, inspect Customers/Users/Groups/Languages/Delivery Issues tables as cards on mobile, open Manage Plan confirmation modal, search customers/languages, and inspect errors/alerts.
3. Keyboard: Tab to mobile hamburger, open; Tab/Shift+Tab through drawer; press Escape; confirm focus returns to menu control and scrolling unlocks.
4. Collapse sidebar on desktop, reload, confirm independent persisted preference for each portal. Return to mobile: full labels appear inside the drawer even when desktop mode was previously collapsed.
5. Confirm only the **portal container** is recreated, and the API health plus an existing WhatsApp group's translation continue working.

## Limitations

The responsive contract tests check source/structure; the image build and live mobile/tablet rendering must still be verified on the Lightsail server and representative browsers/devices. This change does not authorize commercial usage of the unofficial WhatsApp Web connector.
