import assert from "node:assert/strict";
import test from "node:test";

import { pickDefaultPeriodId } from "@/lib/period-default";

const FY = [
  { id: "jan", status: "OPEN", periodStart: "2026-01-01", periodEnd: "2026-01-31" },
  { id: "oct", status: "OPEN", periodStart: "2026-10-01", periodEnd: "2026-10-31" },
  { id: "dec", status: "OPEN", periodStart: "2026-12-01", periodEnd: "2026-12-31" },
];

test("pickDefaultPeriodId prefers month containing today", () => {
  assert.equal(pickDefaultPeriodId(FY, new Date("2026-10-24T12:00:00Z")), "oct");
});

test("pickDefaultPeriodId falls back to earliest open (not Dec)", () => {
  assert.equal(pickDefaultPeriodId(FY, new Date("2027-02-01T12:00:00Z")), "jan");
});

test("pickDefaultPeriodId ignores locked when open months exist", () => {
  const rows = [
    { id: "dec", status: "LOCKED", periodStart: "2026-12-01", periodEnd: "2026-12-31" },
    { id: "jan", status: "OPEN", periodStart: "2026-01-01", periodEnd: "2026-01-31" },
  ];
  assert.equal(pickDefaultPeriodId(rows, new Date("2026-12-15T12:00:00Z")), "jan");
});
