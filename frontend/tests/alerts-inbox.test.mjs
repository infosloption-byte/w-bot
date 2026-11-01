import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const read = file => readFileSync(fileURLToPath(new URL("../" + file, import.meta.url)), "utf8");
const main=read("src/SmartAlerts.tsx");
const inbox=read("src/SmartAlertsInbox.tsx");
const notify=read("src/AlertNotificationSettings.tsx");
test("Smart Alerts keeps separate overview and searchable inbox pages",()=>{
  assert.ok(main.includes("<SmartAlertsInbox/>"));
  assert.ok(main.includes("<AlertNotificationSettings/>"));
  for(const field of ["Search matches","Read status","Monitored group","Intelligent search","View details"])
    assert.ok(inbox.includes(field),field);
  for(const field of ['setSelected(item.id)', 'role="dialog"', 'criteriaSnapshot', 'Mark as'])
    assert.ok(inbox.includes(field),field);
  assert.ok(inbox.includes('"/alerts/inbox/"+'));
});
test("WhatsApp notifications require explicit customer opt-in and selected group",()=>{
  for(const label of ["Connected WhatsApp account","Dedicated alerts group",
    "all participants agree","Enable WhatsApp notifications","Turn off"])
    assert.ok(notify.includes(label),label);
  assert.ok(notify.includes("consentConfirmed:true"));
  assert.ok(notify.includes('},"PUT")'));
  assert.ok(notify.includes("!connectionId||!groupId||!consent||busy"));
});

test("source sender phone is shown distinctly from any contact typed in the message",()=>{
  assert.ok(inbox.includes("Message sender:"));
  assert.ok(inbox.includes("Original sender (WhatsApp)"));
  assert.ok(inbox.includes("Copy sender number"));
  assert.ok(inbox.includes("Contact mentioned inside the message"));
  assert.ok(inbox.includes("Number unavailable"));
});
