import assert from "node:assert/strict";
import test from "node:test";

import { highlightStyle } from "./highlight";

test("source highlight is a percentage of the stored page size", () => {
  const style = highlightStyle({ x: 10, y: 20, width: 100, height: 40, pageWidth: 1000, pageHeight: 800 });
  assert.deepEqual(style, { left: "1%", top: "2.5%", width: "10%", height: "5%" });
});
