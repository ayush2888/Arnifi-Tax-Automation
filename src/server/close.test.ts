import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { LedgerError } from "./errors";
import { createJournal, createPeriod, trialBalance } from "./ledger";
import {
  closeChecklist,
  closePeriod,
  createAccrual,
  monthlyStraightLineMinor,
  postAccrual,
  postDepreciation,
  registerFixedAsset,
  reopenPeriod,
} from "./close";

const OMAR = "55555555-5555-4555-8555-555555555555";
const AL_NOOR = "22222222-2222-4222-8222-222222222222";
const EXPENSE = "a1000001-0000-4000-8000-000000000008";
const ACCRUED = "a1000001-0000-4000-8000-000000000012";
const FA = "a1000001-0000-4000-8000-000000000010";
const ACCUM = "a1000001-0000-4000-8000-000000000011";
const DEPR = "a1000001-0000-4000-8000-000000000013";
const BANK = "a1000001-0000-4000-8000-000000000001";
const REVENUE = "a1000001-0000-4000-8000-000000000007";

test("straight-line monthly depreciation is floored fils", () => {
  assert.equal(monthlyStraightLineMinor(120000, 0, 36), 3333);
});

test("close blocks posts; reopen with reason restores posting; TB stays balanced", async (t) => {
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
    const has = await admin.query(`SELECT to_regclass('public.accrual_schedules') AS reg`);
    if (!has.rows[0]?.reg) {
      t.skip("close tables not migrated");
      return;
    }
    const coa = await admin.query(`SELECT id FROM chart_accounts WHERE id = $1`, [ACCRUED]);
    if (!coa.rowCount) {
      t.skip("close COA seed missing");
      return;
    }

    const period = await createPeriod(OMAR, AL_NOOR, {
      label: "Close test period",
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
    });

    const accrual = await createAccrual(OMAR, AL_NOOR, {
      periodId: period.id,
      kind: "ACCRUAL",
      memo: "utilities accrual",
      debitAccountId: EXPENSE,
      creditAccountId: ACCRUED,
      amountMinor: 15000,
    });
    await postAccrual(OMAR, AL_NOOR, accrual.id);

    const asset = await registerFixedAsset(OMAR, AL_NOOR, {
      code: `FA-T-${Date.now()}`,
      name: "Test asset",
      costMinor: 36000,
      residualMinor: 0,
      lifeMonths: 12,
      inServiceOn: "2026-05-01",
      assetAccountId: FA,
      accumDeprAccountId: ACCUM,
      deprExpenseAccountId: DEPR,
      periodId: period.id,
    });
    await postDepreciation(OMAR, AL_NOOR, asset.depreciationScheduleId);

    const tb = await trialBalance(OMAR, AL_NOOR, period.id);
    assert.equal(tb.balanced, true);

    const checklist = await closeChecklist(OMAR, AL_NOOR, period.id);
    assert.equal(checklist.items.tbBalanced, true);
    assert.equal(checklist.items.accrualsSettled, true);
    assert.equal(checklist.items.depreciationSettled, true);
    assert.equal(checklist.ready, true);

    const closed = await closePeriod(OMAR, AL_NOOR, period.id, "test close");
    assert.equal(closed.status, "CLOSED");

    await assert.rejects(
      () =>
        createJournal(OMAR, AL_NOOR, {
          periodId: period.id,
          memo: "blocked",
          entryDate: "2026-05-20",
          post: true,
          lines: [
            { accountId: BANK, debitMinor: 100 },
            { accountId: REVENUE, creditMinor: 100 },
          ],
        }),
      (error: unknown) => error instanceof LedgerError && error.code === "period_closed",
    );

    await assert.rejects(
      () => reopenPeriod(OMAR, AL_NOOR, period.id, { reason: "" }),
      (error: unknown) => error instanceof LedgerError && error.message === "reopen_reason_required",
    );

    const reopened = await reopenPeriod(OMAR, AL_NOOR, period.id, {
      reason: "Correct accrual amount",
      ticketRef: "TKT-1",
    });
    assert.equal(reopened.status, "REOPENED");

    const journal = await createJournal(OMAR, AL_NOOR, {
      periodId: period.id,
      memo: "allowed after reopen",
      entryDate: "2026-05-21",
      post: true,
      lines: [
        { accountId: BANK, debitMinor: 100 },
        { accountId: REVENUE, creditMinor: 100 },
      ],
    });
    assert.equal(journal.status, "posted");

    const audit = await admin.query(
      `SELECT action, reason, ticket_ref FROM period_close_events
       WHERE period_id = $1 ORDER BY at`,
      [period.id],
    );
    assert.ok(audit.rows.some((row) => row.action === "CLOSE"));
    assert.ok(audit.rows.some((row) => row.action === "REOPEN" && row.ticket_ref === "TKT-1"));
  } finally {
    await admin.end().catch(() => undefined);
  }
});
