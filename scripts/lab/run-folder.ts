/**
 * Local-only lab: inventory and lightly probe documents under --input.
 * Writes summaries to lab-output/ (gitignored). Never logs full TRNs/IBANs.
 *
 * Usage:
 *   npm run lab:folder -- --input "D:/path/to/invoices" --period 2026-Q2
 */
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join, relative } from "node:path";

type FileRow = {
  path: string;
  ext: string;
  bytes: number;
  sha256: string;
};

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function main() {
  const input = argValue("--input");
  const period = argValue("--period") || "unspecified";
  if (!input) {
    console.error("Usage: npm run lab:folder -- --input <dir> [--period YYYY-QN]");
    process.exit(1);
  }
  if (!existsSync(input)) {
    console.error(`Input not found: ${input}`);
    process.exit(1);
  }

  const outDir = join(process.cwd(), "lab-output");
  mkdirSync(outDir, { recursive: true });

  const allowed = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".csv", ".xlsx", ".xls"]);
  const files = walk(input).filter((f) => allowed.has(extname(f).toLowerCase()));

  const rows: FileRow[] = files.map((path) => ({
    path: relative(input, path).replace(/\\/g, "/"),
    ext: extname(path).toLowerCase(),
    bytes: statSync(path).size,
    sha256: sha256File(path),
  }));

  const byExt: Record<string, number> = {};
  for (const row of rows) {
    byExt[row.ext] = (byExt[row.ext] || 0) + 1;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const summary = {
    period,
    inputRoot: input,
    generatedAt: new Date().toISOString(),
    fileCount: rows.length,
    byExt,
    note: "Inventory only. Extraction pipeline hooks land in Phase 3/4. Do not commit lab-output or real client files.",
    files: rows,
  };

  const jsonPath = join(outDir, `inventory-${period}-${stamp}.json`);
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2), "utf8");

  const csvPath = join(outDir, `inventory-${period}-${stamp}.csv`);
  const csv = createWriteStream(csvPath, { encoding: "utf8" });
  csv.write("path,ext,bytes,sha256\n");
  for (const row of rows) {
    csv.write(`"${row.path.replace(/"/g, '""')}",${row.ext},${row.bytes},${row.sha256}\n`);
  }
  csv.end();

  console.log(`Lab inventory: ${rows.length} files`);
  console.log(`byExt: ${JSON.stringify(byExt)}`);
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${csvPath}`);
}

main();
