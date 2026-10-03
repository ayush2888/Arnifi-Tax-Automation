/**
 * V1 VAT201 back-test CLI (roadmap §3.4).
 *
 * Compare a golden JSON (lab or filed) to an actual VAT201 payload JSON.
 * Owner-supplied filed goldens stay on-machine under fixtures/v1-goldens/filed/.
 *
 * Usage:
 *   npx tsx scripts/v1-backtest.ts --golden <path> --actual <path>
 *   npx tsx scripts/v1-backtest.ts --golden <path> --actual <path> --tolerance 1
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { compareVat201, formatCompareReport, type Vat201Golden } from "../src/server/vat201-compare";
import type { Vat201Payload } from "../src/server/release";

function arg(name: string) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function usage() {
  console.error(
    "Usage: npx tsx scripts/v1-backtest.ts --golden <golden.json> --actual <actual.json> [--tolerance N]",
  );
  process.exit(2);
}

const goldenPath = arg("--golden");
const actualPath = arg("--actual");
const toleranceRaw = arg("--tolerance");
if (!goldenPath || !actualPath) usage();

const golden = JSON.parse(readFileSync(path.resolve(goldenPath!), "utf8")) as Vat201Golden;
if (toleranceRaw !== undefined) {
  golden.toleranceMinor = Number(toleranceRaw);
  if (!Number.isInteger(golden.toleranceMinor) || golden.toleranceMinor < 0) {
    console.error("--tolerance must be a non-negative integer (minor units)");
    process.exit(2);
  }
}

const actualJson = JSON.parse(readFileSync(path.resolve(actualPath!), "utf8")) as Partial<Vat201Payload> & {
  boxes: Vat201Payload["boxes"];
};
if (!actualJson.boxes) {
  console.error("actual JSON must include boxes");
  process.exit(2);
}

const result = compareVat201(golden, {
  boxes: actualJson.boxes,
  totalOutputVat: Number(actualJson.totalOutputVat ?? 0),
  totalInputVat: Number(actualJson.totalInputVat ?? 0),
  netPayable: Number(actualJson.netPayable ?? 0),
});

console.log(formatCompareReport(result));
process.exit(result.ok ? 0 : 1);
