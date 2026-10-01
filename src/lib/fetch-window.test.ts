import assert from "node:assert/strict";
import test from "node:test";

import { mountedRowBudget, windowFor } from "./fetch-window";

test("a viewport near row 50,000 requests one bounded window", () => {
  const viewport = 30;
  const overscan = 8;
  const first = 49960 - overscan;
  const last = 49960 + viewport + overscan;
  const window = windowFor(first, last);
  assert.ok(window.limit <= 500);
  assert.ok(window.offset >= 49800);
  assert.ok(window.offset + window.limit >= last);
  assert.ok(mountedRowBudget(viewport, overscan) < 80);
});
