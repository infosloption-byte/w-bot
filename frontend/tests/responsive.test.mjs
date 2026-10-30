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
