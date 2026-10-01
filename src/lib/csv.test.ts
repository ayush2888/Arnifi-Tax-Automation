import assert from "node:assert/strict";
import test from "node:test";

import { csvCell } from "./csv";

test("csv export neutralises formula prefixes and keeps money text", () => {
  assert.equal(csvCell('=HYPERLINK("http://evil.test")'), `"'=HYPERLINK(""http://evil.test"")"`);
  assert.equal(csvCell("+cmd|' /C calc'!A0"), `'+cmd|' /C calc'!A0`);
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("-cmd"), "'-cmd");
  assert.equal(csvCell("-250.00"), "-250.00");
  assert.equal(csvCell("1,460.00"), '"1,460.00"');
  assert.equal(csvCell("رسوم بنكية"), "رسوم بنكية");
  assert.equal(csvCell("\t=10+20"), "'\t=10+20");
  assert.equal(csvCell("\r=10+20"), "\"'\r=10+20\"");
  assert.equal(csvCell(" =10+20"), "' =10+20");
  assert.equal(csvCell(" -250.00"), " -250.00");
});
