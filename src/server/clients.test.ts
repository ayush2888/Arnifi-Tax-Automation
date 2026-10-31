import assert from "node:assert/strict";
import test from "node:test";

import { fiscalYearMonths } from "@/server/clients";

test("fiscalYearMonths Jan start is calendar year", () => {
  const months = fiscalYearMonths(2026, 1);
  assert.equal(months.length, 12);
  assert.equal(months[0]?.label, "Jan 2026");
  assert.equal(months[0]?.periodStart, "2026-01-01");
  assert.equal(months[0]?.periodEnd, "2026-01-31");
  assert.equal(months[5]?.label, "Jun 2026");
  assert.equal(months[11]?.label, "Dec 2026");
  assert.equal(months[11]?.periodEnd, "2026-12-31");
});

test("fiscalYearMonths Apr start spans two calendar years", () => {
  const months = fiscalYearMonths(2026, 4);
  assert.equal(months.length, 12);
  assert.equal(months[0]?.label, "Apr 2026");
  assert.equal(months[0]?.periodStart, "2026-04-01");
  assert.equal(months[8]?.label, "Dec 2026");
  assert.equal(months[9]?.label, "Jan 2027");
  assert.equal(months[9]?.periodStart, "2027-01-01");
  assert.equal(months[11]?.label, "Mar 2027");
  assert.equal(months[11]?.periodEnd, "2027-03-31");
});
