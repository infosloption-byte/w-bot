import test from "node:test";
import assert from "node:assert/strict";
import { pickFairMessages } from "../src/processor.js";

test("worker processes messages round-robin across customer workspaces", () => {
  const records = [
    ...Array.from({ length: 10 }, (_, i) => ({
      id: "A" + i, groupId: "groupA", group: { tenantId: "tenantA" }
    })),
    { id: "B1", groupId: "groupB", group: { tenantId: "tenantB" } },
    { id: "C1", groupId: "groupC", group: { tenantId: "tenantC" } }
  ];
  const selected = pickFairMessages(records, 6);
  assert.deepEqual(selected.map(item => item.id), [
    "A0", "B1", "C1", "A1", "A2", "A3"
  ]);
});
