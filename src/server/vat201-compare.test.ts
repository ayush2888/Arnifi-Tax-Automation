import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { approveExtractionAndPost, createPeriod, createSyntheticDocument, vat201Draft } from "./ledger";
import {
  compareVat201,
  formatCompareReport,
  type Vat201Golden,
} from "./vat201-compare";

const OMAR = "55555555-5555-4555-8555-555555555555";
const AL_NOOR = "22222222-2222-4222-8222-222222222222";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LAB_GOLDEN = path.join(ROOT, "fixtures/v1-goldens/lab/al-noor-q1-2026.golden.json");

function loadLabGolden(): Vat201Golden {
  return JSON.parse(readFileSync(LAB_GOLDEN, "utf8")) as Vat201Golden;
}

test("compareVat201 passes when boxes and totals match within tolerance", () => {
  const golden = loadLabGolden();
  const result = compareVat201(golden, {
    boxes: golden.boxes,
    totalOutputVat: golden.totalOutputVat,
    totalInputVat: golden.totalInputVat,
    netPayable: golden.netPayable,
  });
  assert.equal(result.ok, true);
  assert.equal(result.mismatches.length, 0);
});

test("compareVat201 reports mismatches outside tolerance", () => {
  const golden = loadLabGolden();
  const result = compareVat201(
    { ...golden, toleranceMinor: 0 },
    {
      boxes: {
        "1b": { taxableMinor: golden.boxes["1b"].taxableMinor, vatMinor: golden.boxes["1b"].vatMinor + 1 },
        "9": golden.boxes["9"],
      },
      totalOutputVat: golden.totalOutputVat + 1,
      totalInputVat: golden.totalInputVat,
      netPayable: golden.netPayable + 1,
    },
  );
  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some((m) => m.path === "boxes.1b.vatMinor"));
  assert.ok(formatCompareReport(result).startsWith("FAIL"));
});

test("compareVat201 allows small deltas inside toleranceMinor", () => {
  const golden = { ...loadLabGolden(), toleranceMinor: 5 };
  const result = compareVat201(golden, {
    boxes: {
      "1b": { taxableMinor: golden.boxes["1b"].taxableMinor, vatMinor: golden.boxes["1b"].vatMinor + 3 },
      "9": golden.boxes["9"],
    },
    totalOutputVat: golden.totalOutputVat + 3,
    totalInputVat: golden.totalInputVat,
    netPayable: golden.netPayable + 3,
  });
  assert.equal(result.ok, true);
});

test("V1 lab golden matches draft VAT201 after posting sales+purchase docs", async (t) => {
  const appUrl =
    process.env.DATABASE_URL || "postgresql://daftar_app:daftar-local-only@127.0.0.1:5432/daftar_test";
  process.env.DATABASE_URL = appUrl;
  const adminUrl = process.env.DATABASE_URL_SUPER || appUrl.replace("://daftar_app:", "://daftar:");
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const ready = await admin.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'documents'`,
  );
  if (!ready.rowCount) {
    t.skip("ledger schema not migrated");
    await admin.end();
    return;
  }

  try {
    const golden = loadLabGolden();
    const period = await createPeriod(OMAR, AL_NOOR, {
      label: "V1-lab-backtest",
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
    });

    const sales = await createSyntheticDocument(OMAR, AL_NOOR, {
      periodId: period.id,
      docType: "SALES_INVOICE",
      originalName: "v1-lab-sales.json",
      facts: {
        entryDate: "2026-07-15",
        invoiceNumber: "INV-V1-LAB-S",
        counterparty: "Lab Customer LLC",
        taxableMinor: golden.boxes["1b"].taxableMinor,
        vatMinor: golden.boxes["1b"].vatMinor,
      },
    });
    await approveExtractionAndPost(OMAR, AL_NOOR, sales.extractionId);

    const purchase = await createSyntheticDocument(OMAR, AL_NOOR, {
      periodId: period.id,
      docType: "PURCHASE_INVOICE",
      originalName: "v1-lab-purchase.json",
      facts: {
        entryDate: "2026-07-20",
        invoiceNumber: "INV-V1-LAB-P",
        counterparty: "Lab Supplier LLC",
        taxableMinor: golden.boxes["9"].taxableMinor,
        vatMinor: golden.boxes["9"].vatMinor,
      },
    });
    await approveExtractionAndPost(OMAR, AL_NOOR, purchase.extractionId);

    const draft = await vat201Draft(OMAR, AL_NOOR, period.id);
    const result = compareVat201(golden, {
      boxes: draft.boxes,
      totalOutputVat: draft.totalOutputVat,
      totalInputVat: draft.totalInputVat,
      netPayable: draft.netPayable,
    });
    assert.equal(result.ok, true, formatCompareReport(result));
  } finally {
    await admin.end().catch(() => undefined);
  }
});
