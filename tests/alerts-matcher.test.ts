import test from "node:test";
import assert from "node:assert/strict";
import { extractContactNumber, extractQuotedPrice, evaluateWatchRule } from "../src/alerts-matcher.js";
const rule = {
  category: "TOUR", keywords: "van,vehicle", origin: "Kandy", destination: "Ella",
  minPrice: 12000, maxPrice: 20000, requireContact: true
};
test("tour request matches route, fare and contact details", () => {
  const found = evaluateWatchRule(
    "Van from Kandy to Ella, fare LKR 14,000 contact 0771234567", rule);
  assert.equal(found?.quotedPrice, 14000);
  assert.equal(found?.contactNumber, "0771234567");
});
test("missing prices, contacts or keywords are not invented", () => {
  assert.equal(evaluateWatchRule("Van Kandy to Ella 0771234567", rule), null);
  assert.equal(evaluateWatchRule("Van Kandy to Ella fare LKR 14,000", rule), null);
  assert.equal(evaluateWatchRule("Bike Kandy to Ella fare LKR 14,000 contact 0771234567", rule), null);
  assert.equal(evaluateWatchRule("Van Kandy to Galle fare LKR 14,000 contact 0771234567", rule), null);
});
test("generic rules can find matching keywords in multiple group messages", () => {
  assert.ok(evaluateWatchRule("Looking for PHP developer", {
    category: "GENERIC", keywords: "php developer,laravel",
    origin: null, destination: null, minPrice: null, maxPrice: null, requireContact: false
  }));
});
test("never match empty keyword catch-all rules", () => {
  assert.equal(evaluateWatchRule("This should not alert everyone", {
    ...rule, keywords: ""
  }), null);
});
test("avoids short numeric values as phone numbers and needs a labelled price", () => {
  assert.equal(extractContactNumber("Price LKR 14000, date 2026-11-05"), null);
  assert.equal(extractQuotedPrice("LKR 14,000"), 14000);
  assert.equal(extractQuotedPrice("no price specified"), null);
});
