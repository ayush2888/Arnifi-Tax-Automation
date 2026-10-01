import assert from "node:assert/strict";
import test from "node:test";

import { locate, virtualCount } from "./grid-layout";

test("50,000 rows stay addressable when grouped by month", () => {
  const months = Array.from({ length: 120 }, (_, index) => ({
    month: `2016-${String((index % 12) + 1).padStart(2, "0")}`,
    count: index === 119 ? 50000 - 119 * 416 : 416,
  }));
  const total = months.reduce((sum, bucket) => sum + bucket.count, 0);
  assert.equal(total, 50000);
  assert.equal(virtualCount(total, months), 50120);
  assert.deepEqual(locate(0, total, months), { type: "header", month: months[0].month });
  const last = locate(50119, total, months);
  assert.equal(last.type, "row");
  if (last.type === "row") assert.equal(last.rowIndex, 49999);
  const middle = locate(500, total, null);
  assert.deepEqual(middle, { type: "row", rowIndex: 500 });
});
