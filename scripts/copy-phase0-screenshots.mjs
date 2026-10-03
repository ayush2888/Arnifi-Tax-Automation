/**
 * Copies latest Playwright snapshot PNGs into docs/phase0/ for design reference.
 * Visual e2e tests also write directly; run after: npx playwright test e2e/books-journals-visual.spec.ts
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const from = path.join(root, "e2e", "books-journals-visual.spec.ts-snapshots");
const to = path.join(root, "docs", "phase0");

if (!fs.existsSync(from)) {
  console.error("No snapshot folder yet. Run visual e2e first.");
  process.exit(1);
}
fs.mkdirSync(to, { recursive: true });
for (const name of fs.readdirSync(from)) {
  if (!name.endsWith(".png")) continue;
  fs.copyFileSync(path.join(from, name), path.join(to, name));
  console.log("copied", name);
}
