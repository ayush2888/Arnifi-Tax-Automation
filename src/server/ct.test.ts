import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { LedgerError } from "./errors";
import { createJournal, createPeriod } from "./ledger";
import {
  addCtAdjustment,
  approveCtPack,
  computeCtPayable,
  downloadCtPack,
  getCtReport,
  prepareCtPack,
} from "./ct";

const OMAR = "55555555-5555-4555-8555-555555555555";
const LAYLA = "44444444-4444-4444-8444-444444444444";
const AL_NOOR = "22222222-2222-4222-8222-222222222222";
const BANK = "a1000001-0000-4000-8000-000000000001";
const REVENUE = "a1000001-0000-4000-8000-000000000007";

test("CT payable uses rate bps on positive taxable income", () => {
  assert.equal(computeCtPayable(100000, 900), 9000);
  assert.equal(computeCtPayable(0, 900), 0);
  assert.equal(computeCtPayable(-5000, 900), 0);
});

test("CT report reconciles to ledger; download requires RELEASED approval", async (t) => {
  const appUrl =
    process.env.DATABASE_URL || "postgresql://daftar_app:daftar-local-only@127.0.0.1:5432/daftar_test";
  process.env.DATABASE_URL = appUrl;
  const adminUrl = process.env.DATABASE_URL_SUPER || appUrl.replace("://daftar_app:", "://daftar:");
  const admin = new pg.Client({ connectionString: adminUrl });
  try {
    await admin.connect();
  } catch {
    t.skip("Postgres is not reachable");
    return;
  }
  try {
    const has = await admin.query(`SELECT to_regclass('public.ct_adjustments') AS reg`);
    if (!has.rows[0]?.reg) {
      t.skip("ct tables not migrated");
      return;
    }

    const period = await createPeriod(OMAR, AL_NOOR, {
      label: "CT test period",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });

    await createJournal(OMAR, AL_NOOR, {
      periodId: period.id,
      memo: "ct sale",
      entryDate: "2026-07-10",
      post: true,
      lines: [
        { accountId: BANK, debitMinor: 200000 },
        { accountId: REVENUE, creditMinor: 200000 },
      ],
    });

    await addCtAdjustment(OMAR, AL_NOOR, {
      periodId: period.id,
      direction: "ADD_BACK",
      amountMinor: 10000,
      reason: "Non-deductible expense",
    });

    const report = await getCtReport(OMAR, AL_NOOR, period.id);
    assert.equal(report.reconciledToLedger, true);
    assert.equal(report.accountingProfitMinor, 200000);
    assert.equal(report.taxableIncomeMinor, 210000);
    assert.equal(report.ctPayableMinor, computeCtPayable(210000));

    const prepared = await prepareCtPack(OMAR, AL_NOOR, period.id);
    assert.equal(prepared.status, "PENDING_APPROVAL");

    await assert.rejects(
      () => downloadCtPack(OMAR, AL_NOOR, prepared.id),
      (error: unknown) =>
        error instanceof LedgerError && error.message === "download_requires_released",
    );

    await assert.rejects(
      () => approveCtPack(OMAR, AL_NOOR, prepared.id),
      (error: unknown) => error instanceof LedgerError && error.message === "preparer_cannot_approve",
    );

    const released = await approveCtPack(LAYLA, AL_NOOR, prepared.id);
    assert.equal(released.status, "RELEASED");

    const bundle = await downloadCtPack(OMAR, AL_NOOR, prepared.id, { ipHash: "ct", userAgent: "test" });
    assert.equal(bundle.status, "RELEASED");
    assert.equal(bundle.payload.ctPayableMinor, report.ctPayableMinor);
  } finally {
    await admin.end().catch(() => undefined);
  }
});
