import assert from "node:assert/strict";
import test from "node:test";

import { formatDateUae } from "./date";

test("formatDateUae formats ISO as dd/mm/yyyy", () => {
  assert.equal(formatDateUae("2026-06-01"), "01/06/2026");
  assert.equal(formatDateUae("2026-06-01T12:00:00Z"), "01/06/2026");
  assert.equal(formatDateUae(""), "—");
  assert.equal(formatDateUae(null), "—");
});
