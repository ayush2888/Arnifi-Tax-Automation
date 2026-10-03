import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { approveProposal, proposeFromDocumentFacts } from "./propose";
import { recomputePipeline } from "./pipeline";
import { compareVat201, type Vat201Golden } from "./vat201-compare";
import { createPeriod, vat201Draft } from "./ledger";

const OMAR = "55555555-5555-4555-8555-555555555555";
const SERVICE = "d1000001-0000-4000-8000-000000000001";
const TRADING = "d1000001-0000-4000-8000-000000000002";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("G6 service client pipeline reproduces lab VAT201 golden", async (t) => {
  const appUrl =
    process.env.DATABASE_URL || "postgresql://daftar_app:daftar-local-only@127.0.0.1:5432/daftar_test";
  process.env.DATABASE_URL = appUrl;
  const adminUrl = process.env.DATABASE_URL_SUPER || appUrl.replace("://daftar_app:", "://daftar:");
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const ready = await admin.query(`SELECT 1 FROM clients WHERE id = $1`, [SERVICE]);
  if (!ready.rowCount) {
    t.skip("g-pipeline demo clients not seeded");
    await admin.end();
    return;
  }

  try {
    const period = await createPeriod(OMAR, SERVICE, {
      label: `G6-svc-${Date.now()}`,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
    });
    const fee = await proposeFromDocumentFacts(OMAR, SERVICE, {
      periodId: period.id,
      docType: "SALES_INVOICE",
      entryDate: "2026-02-10",
      taxableMinor: 100000,
      vatMinor: 5000,
      counterparty: "Fee Customer",
      confidence: 95,
    });
    await approveProposal(OMAR, SERVICE, fee!.id, true);

    const disb = await proposeFromDocumentFacts(OMAR, SERVICE, {
      periodId: period.id,
      docType: "SALES_INVOICE",
      entryDate: "2026-02-12",
      taxableMinor: 20000,
      vatMinor: 0,
      isDisbursement: true,
      itemDescription: "government fee disbursement",
      counterparty: "Fee Customer",
      confidence: 95,
    });
    await approveProposal(OMAR, SERVICE, disb!.id, true);

    const draft = await vat201Draft(OMAR, SERVICE, period.id);
    const golden = JSON.parse(
      readFileSync(path.join(ROOT, "fixtures/g-pipeline/a/expected/vat201.json"), "utf8"),
    ) as Vat201Golden;
    const result = compareVat201(golden, {
      boxes: draft.boxes,
      totalOutputVat: draft.totalOutputVat,
      totalInputVat: draft.totalInputVat,
      netPayable: draft.netPayable,
    });
    assert.equal(result.ok, true, JSON.stringify(result.mismatches));

    const status = await recomputePipeline(OMAR, SERVICE, period.id);
    assert.ok(status.stage);
  } finally {
    await admin.end().catch(() => undefined);
  }
});

test("G6 trading client VAT both sides", async (t) => {
  const appUrl =
    process.env.DATABASE_URL || "postgresql://daftar_app:daftar-local-only@127.0.0.1:5432/daftar_test";
  process.env.DATABASE_URL = appUrl;
  const adminUrl = process.env.DATABASE_URL_SUPER || appUrl.replace("://daftar_app:", "://daftar:");
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const ready = await admin.query(`SELECT 1 FROM clients WHERE id = $1`, [TRADING]);
  if (!ready.rowCount) {
    t.skip("g-pipeline demo clients not seeded");
    await admin.end();
    return;
  }

  try {
    const period = await createPeriod(OMAR, TRADING, {
      label: `G6-trd-${Date.now()}`,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
    });
    const sale = await proposeFromDocumentFacts(OMAR, TRADING, {
      periodId: period.id,
      docType: "SALES_INVOICE",
      entryDate: "2026-02-08",
      taxableMinor: 50000,
      vatMinor: 2500,
      confidence: 95,
    });
    await approveProposal(OMAR, TRADING, sale!.id, true);

    const buy = await proposeFromDocumentFacts(OMAR, TRADING, {
      periodId: period.id,
      docType: "PURCHASE_INVOICE",
      entryDate: "2026-02-09",
      taxableMinor: 30000,
      vatMinor: 1500,
      itemDescription: "inventory goods",
      confidence: 95,
    });
    await approveProposal(OMAR, TRADING, buy!.id, true);

    const draft = await vat201Draft(OMAR, TRADING, period.id);
    const golden = JSON.parse(
      readFileSync(path.join(ROOT, "fixtures/g-pipeline/b/expected/vat201.json"), "utf8"),
    ) as Vat201Golden;
    const result = compareVat201(golden, {
      boxes: draft.boxes,
      totalOutputVat: draft.totalOutputVat,
      totalInputVat: draft.totalInputVat,
      netPayable: draft.netPayable,
    });
    assert.equal(result.ok, true, JSON.stringify(result.mismatches));
  } finally {
    await admin.end().catch(() => undefined);
  }
});
