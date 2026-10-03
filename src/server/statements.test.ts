import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { LedgerError } from "./errors";
import { createJournal, createPeriod } from "./ledger";
import {
  approveStatementsPack,
  evaluateIntegrity,
  getFinancialStatements,
  prepareStatementsPack,
  yearEndCloseToRE,
} from "./statements";

const OMAR = "55555555-5555-4555-8555-555555555555";
const LAYLA = "44444444-4444-4444-8444-444444444444";
const AL_NOOR = "22222222-2222-4222-8222-222222222222";
const BANK = "a1000001-0000-4000-8000-000000000001";
const REVENUE = "a1000001-0000-4000-8000-000000000007";
const EXPENSE = "a1000001-0000-4000-8000-000000000008";

test("integrity gates require TB, A=L+E, and RE roll-forward", () => {
  const ok = evaluateIntegrity({
    totalDebit: 100,
    totalCredit: 100,
    totalAssets: 80,
    totalLiabilities: 30,
    totalEquity: 50,
    openingRe: 10,
    netIncome: 40,
    dividends: 0,
    closingRe: 50,
  });
  assert.equal(ok.ready, true);

  const bad = evaluateIntegrity({
    totalDebit: 100,
    totalCredit: 90,
    totalAssets: 80,
    totalLiabilities: 30,
    totalEquity: 50,
    openingRe: 10,
    netIncome: 40,
    dividends: 0,
    closingRe: 40,
  });
  assert.equal(bad.tbBalanced, false);
  assert.equal(bad.reRollForward, false);
  assert.equal(bad.ready, false);
});

test("financials identity holds; YE close to RE; gates block then allow STATEMENTS release", async (t) => {
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
    const has = await admin.query(`SELECT to_regclass('public.year_end_closes') AS reg`);
    if (!has.rows[0]?.reg) {
      t.skip("statements tables not migrated");
      return;
    }

    const period = await createPeriod(OMAR, AL_NOOR, {
      label: "Statements test",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
    });

    await createJournal(OMAR, AL_NOOR, {
      periodId: period.id,
      memo: "sale",
      entryDate: "2026-06-05",
      post: true,
      lines: [
        { accountId: BANK, debitMinor: 50000 },
        { accountId: REVENUE, creditMinor: 50000 },
      ],
    });
    await createJournal(OMAR, AL_NOOR, {
      periodId: period.id,
      memo: "expense",
      entryDate: "2026-06-06",
      post: true,
      lines: [
        { accountId: EXPENSE, debitMinor: 12000 },
        { accountId: BANK, creditMinor: 12000 },
      ],
    });

    const before = await getFinancialStatements(OMAR, AL_NOOR, period.id);
    assert.equal(before.pnl.netIncomeMinor, 38000);
    assert.equal(before.integrity.tbBalanced, true);
    assert.equal(before.integrity.accountingEquation, true);
    assert.equal(before.integrity.reRollForward, true);
    assert.equal(before.integrity.ready, true);

    const prepared = await prepareStatementsPack(OMAR, AL_NOOR, period.id);
    assert.equal(prepared.status, "PENDING_APPROVAL");

    await assert.rejects(
      () => approveStatementsPack(OMAR, AL_NOOR, prepared.id),
      (error: unknown) => error instanceof LedgerError && error.message === "preparer_cannot_approve",
    );

    const released = await approveStatementsPack(LAYLA, AL_NOOR, prepared.id);
    assert.equal(released.status, "RELEASED");

    // Mutate ledger → pack should go stale via mark on post; new prepare after YE.
    const ye = await yearEndCloseToRE(OMAR, AL_NOOR, period.id, "test YE");
    assert.equal(ye.netIncomeMinor, 38000);

    const afterYe = await getFinancialStatements(OMAR, AL_NOOR, period.id);
    assert.equal(afterYe.retainedEarnings.yearEndClosed, true);
    assert.equal(afterYe.pnl.netIncomeMinor, 0);
    assert.equal(afterYe.retainedEarnings.netIncomeMinor, 38000);
    assert.equal(afterYe.integrity.ready, true);

    const stale = await admin.query(`SELECT status FROM release_packs WHERE id = $1`, [prepared.id]);
    assert.equal(stale.rows[0].status, "STALE");

    await assert.rejects(
      () => approveStatementsPack(LAYLA, AL_NOOR, prepared.id),
      (error: unknown) => error instanceof LedgerError && error.code === "conflict",
    );

    const again = await prepareStatementsPack(OMAR, AL_NOOR, period.id);
    assert.equal(again.status, "PENDING_APPROVAL");
  } finally {
    await admin.end().catch(() => undefined);
  }
});
