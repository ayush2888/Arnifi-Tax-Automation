import assert from "node:assert/strict";
import test from "node:test";

import { assertMinor, displayToMinor, formatMinor, MoneyTypeError } from "./money";

test("rejects floats and formats minor units", () => {
  assert.throws(() => assertMinor(10.5), MoneyTypeError);
  assert.throws(() => formatMinor(10.5), MoneyTypeError);
  assert.equal(assertMinor(1050), 1050);
  assert.equal(assertMinor(null), null);
  assert.equal(formatMinor(123456), "1,234.56");
  assert.equal(formatMinor(-25000), "-250.00");
  assert.equal(formatMinor(null), "");
  assert.equal(displayToMinor("1,234.50"), 123450);
  assert.equal(displayToMinor("10"), 1000);
  assert.throws(() => displayToMinor("10.555"), MoneyTypeError);
});
