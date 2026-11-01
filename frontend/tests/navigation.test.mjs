import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const read = file => readFileSync(fileURLToPath(new URL("../" + file, import.meta.url)), "utf8");
const customer = read("src/main.tsx");
const dashboard = read("src/CustomerDashboard.tsx");
const alerts = read("src/SmartAlerts.tsx");
const connections = read("src/ByonConnections.tsx");
const account = read("src/PortalAccount.tsx");
const platform = read("src/platform-main.tsx");
const theme = read("src/theme-refresh.css");
const pages = read("src/workspace-pages.css");

test("customer workspace has exactly the five requested functional sections plus Dashboard", () => {
  for (const label of [
    "Dashboard", "Translation", "Smart Alerts", "WhatsApp Connections", "Plans & Usage", "Settings"
  ]) assert.ok(customer.includes('label: "' + label + '"'), label);
  const nav = customer.match(/const nav: Array<\{ id: View; label: string; icon: string \}> = \[([\s\S]*?)\];/);
  assert.ok(nav, "navigation must exist");
  assert.equal((nav[1].match(/id: "/g) ?? []).length, 6);
  assert.ok(!nav[1].includes('label: "Add Group"'));
});

test("submenus switch between real pages with accessible current state", () => {
  for (const name of ["Groups & Languages", "Monitored Groups", "Intelligent Searches", "Inbox",
    "Connected Accounts", "Add Account", "Pairing & Reconnection",
    "Translation Subscription", "Smart Alerts Subscription", "Limits & Usage",
    "Profile", "Workspace", "Security"]) assert.ok(customer.includes('label: "' + name + '"'), name);
  assert.match(customer, /chooseSubtab\(item\.id, sub\.id\)/);
  assert.match(customer, /aria-current=\{activeSubtab\(item\.id\)/);
  assert.match(customer, /<CustomerDashboard/);
  assert.match(customer, /<TranslationActivity/);
  assert.match(customer, /<SmartAlerts section=\{alertTab\}/);
});

test("independent alerts pages and source group controls remain available", () => {
  for (const source of ['section === "overview"', 'section === "groups"',
    'section === "searches"', 'section === "inbox"',
    '"/alerts/groups/bulk"', '"/alerts/rules"', '"/alerts/inbox"'])
    assert.ok(alerts.includes(source), source);
  assert.match(alerts, /onNavigate\?\.\("groups"\)/);
  assert.match(alerts, /parameters\.map/);
});

test("connections keep pairing, consent, and admin activation while removing duplicate menu flow", () => {
  for (const source of ["mode === \"pairing\"", 'mode === "add"', 'onNavigate?.("pairing")',
    '"/connections/activations"', "groupConsent", "byon-qr-frame", "byon-code-stage"])
    assert.ok(connections.includes(source), source);
  assert.ok(!customer.includes('id: "activate", label: "Add Group"'));
});

test("settings pages, dashboard onboarding and shared theme are wired in both portals", () => {
  assert.match(account, /section === "profile"/);
  assert.match(account, /section === "workspace"/);
  assert.match(account, /section === "security"/);
  for (const token of ["Connected accounts", "Unread matches", "Your setup checklist", "Group Translation", "What do you want W-Bot to do?", "Continue setup"])
    assert.ok(dashboard.includes(token), token);
  assert.match(customer, /import "\.\/theme-refresh\.css"/);
  assert.match(platform, /import "\.\/theme-refresh\.css"/);
  for (const token of [".home-hero", ".home-service-card", ".sidebar-subnav", ".workspace-tabs"])
    assert.ok(theme.includes(token), token);
  assert.ok(pages.includes(".alert-page-grid"));
});
