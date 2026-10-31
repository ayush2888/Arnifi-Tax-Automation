import assert from "node:assert/strict";
import test from "node:test";

import { formatStatementPeriod, periodRangeFromFilename } from "@/lib/statement-period";

test("periodRangeFromFilename reads Aug bank PDF name", () => {
  const range = periodRangeFromFilename("statement(Aug 1, 2026 - Aug 31, 2026).pdf");
  assert.deepEqual(range, { start: "2026-08-01", end: "2026-08-31" });
});

test("formatStatementPeriod collapses same month", () => {
  assert.match(formatStatementPeriod("2026-08-01", "2026-08-31"), /Aug 2026/);
});
