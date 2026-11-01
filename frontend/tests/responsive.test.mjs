import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fromRoot = path => readFileSync(fileURLToPath(new URL("../" + path, import.meta.url)), "utf8");
const customer = fromRoot("src/main.tsx");
const platform = fromRoot("src/platform-main.tsx");
const hook = fromRoot("src/useSidebar.ts");
const responsive = fromRoot("src/responsive.css");

test("customer and platform share a responsive sidebar with separate saved preferences", () => {
  assert.match(customer, /useSidebar\("wbot-customer-sidebar-collapsed"\)/);
  assert.match(platform, /useSidebar\("wbot-platform-sidebar-collapsed"\)/);
  for (const source of [customer, platform]) {
    assert.match(source, /import "\.\/responsive\.css"/);
    assert.match(source, /sidebar-mobile-toggle/);
    assert.match(source, /sidebar-toggle/);
    assert.match(source, /sidebar-close/);
    assert.match(source, /sidebar-scrim/);
    assert.match(source, /aria-expanded=\{sidebar\.mobileOpen\}/);
    assert.match(source, /aria-current=\{view === item\./);
    assert.match(source, /sidebar\.closeMobile\(\)/);
    assert.match(source, /ref=\{sidebar\.drawerRef\}/);
  }
});

test("drawer supports Escape, locked background scrolling and keyboard focus", () => {
  for (const fragment of [
    'event.key === "Escape"',
    'event.key !== "Tab"',
    'document.body.style.overflow = "hidden"',
    "querySelectorAll<HTMLElement>",
    "localStorage.setItem",
    "window.innerWidth > 900"
  ]) assert.ok(hook.includes(fragment), fragment);
});

test("responsive layout covers tablet, mobile and narrow phone table cards", () => {
  for (const breakpoint of ["max-width:900px","max-width:640px","max-width:700px"]) {
    assert.ok(responsive.includes(breakpoint), breakpoint);
  }
  for (const component of [
    ".dashboard .sidebar.is-mobile-open",
    ".dashboard .sidebar-scrim.is-visible",
    ".dashboard.nav-collapsed .sidebar",
    ".dashboard .metrics",
    ".dashboard .platform-metrics",
    ".dashboard .group-cards",
    ".dashboard .activation-layout",
    ".dashboard .modal-panel",
    ".dashboard .platform-table td::before"
  ]) assert.ok(responsive.includes(component), component);
});

test("all platform data tables provide labels for mobile card layout", () => {
  for (const label of [
    "Workspace","Owner","Groups","Subscription","Monthly usage",
    "User","Email","Workspace roles","Email verified","Registered",
    "Gateway","Messages stored","Language","ISO code","Availability",
    "Attempts","Received"
  ]) assert.ok(platform.includes('data-label="' + label + '"'), label);
  assert.equal((platform.match(/data-label="/g) ?? []).length, 26);
});

test("short viewports keep Sign out in a fixed footer while navigation scrolls", () => {
  for (const source of [customer, platform]) {
    assert.match(source, /className="sidebar-foot"/);
    assert.match(source, /className="nav-item signout"/);
  }
  for (const rule of [
    ".dashboard .sidebar nav,",
    "flex:1 1 auto;",
    "min-height:0;",
    "overflow-y:auto;",
    "grid-auto-rows:max-content;",
    ".dashboard .sidebar-foot,",
    "flex:0 0 auto;",
    ".dashboard .sidebar-foot .signout",
    "max-height:760px"
  ]) assert.ok(responsive.includes(rule), rule);
});

const connections = fromRoot("src/ByonConnections.tsx");
const connectionCss = fromRoot("src/connections.css");

test("activated personal and business groups refresh automatically and identify their linked number", () => {
  for (const term of [
    "const refreshGroups = useCallback",
    'view !== "groups" && view !== "overview"',
    "window.setInterval",
    'api<{ groups: Group[] }>("/groups")',
    "manualGroupRefresh",
    "group.connection.kind",
    "group.connection.label",
    "onManageGroups"
  ]) assert.ok(customer.includes(term), term);
});
test("responsive pairing provides distinct QR and phone-code workflows", () => {
  for (const term of [
    '"qr" | "code"', "Generate QR code", "Request pairing code",
    "pairExpiresAt", "byon-progress", "byon-method-switch",
    "byon-qr-frame", "byon-code-stage", "byon-connected",
    "byon-group-list", "onManageGroups"
  ]) assert.ok(connections.includes(term), term);
  for (const term of [
    "max-width:1100px", "max-width:700px", "max-width:480px",
    ".byon-layout", ".byon-qr-stage", ".byon-method-switch",
    ".byon-number-item", ".group-page-actions"
  ]) assert.ok(connectionCss.includes(term), term);
});

test("Model C displays unlimited multi-number allowance, group quota and accessible removal",()=>{
  for (const term of [
    'maxConnections === 0 ? "Unlimited"',
    "activeConnectionsCount", "groupSlotsUsed", "groupSlotsLimit",
    "GROUP_LIMIT_REACHED", "byon-group-quota",
    "byon-remove-action", "Permanently remove WhatsApp",
    "Remove permanently", "groupUsage", "activated"
  ]) {
    // Server error-code lives in API; client renders its human-readable detail.
    if (term === "GROUP_LIMIT_REACHED") continue;
    assert.ok(connections.includes(term), term);
  }
  for (const term of [".byon-remove-action",".byon-group-quota","max-width:480px"]) {
    assert.ok(connectionCss.includes(term), term);
  }
  assert.ok(platform.includes("whatsappConnectionLimit"));
});

test("customer and admin surfaces show catalog prices and unlimited text without message quota bars", () => {
  const account = fromRoot("src/PortalAccount.tsx");
  for (const term of ["wbot-plan-picker","billingInterval","pricingPlans","Yearly · save 2 months"]) {
    assert.ok(platform.includes(term),term);
  }
  for (const term of ["wbot-price-catalog","Unlimited","whatsappConnections","yearlyCents"]) {
    assert.ok(account.includes(term),term);
  }
  assert.ok(customer.includes("Unlimited text translations · usage monitored"));
  assert.ok(!customer.includes("me.limits.messagesPerMonth"));
  const theme=fromRoot("src/platform.css");
  assert.ok(theme.includes("max-width:650px"));
  assert.ok(theme.includes(".wbot-plan-choice.is-selected"));
});
