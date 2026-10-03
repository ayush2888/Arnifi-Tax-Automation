import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { booksTrialBalance } from "./trial-balance";

const OMAR = "55555555-5555-4555-8555-555555555555";
const DESERT = "e1000001-0000-4000-8000-000000000001";
const PERIOD_MAY = "e2000001-0000-4000-8000-000000000001";
const PERIOD_JUN = "e2000001-0000-4000-8000-000000000013";
const SCHED_RENT = "e4000001-0000-4000-8000-000000000015";
const VAT_RETURN = "e4000001-0000-4000-8000-000000000026";
const VAT_PAY = "e4000001-0000-4000-8000-000000000027";

function appUrl() {
  return process.env.DATABASE_URL || "postgresql://daftar_app:daftar-local-only@127.0.0.1:5432/daftar_test";
}

function adminUrl() {
  return process.env.DATABASE_URL_SUPER || appUrl().replace("://daftar_app:", "://daftar:");
}

test("schedule_post posts due rent; VAT settlement is two-step", async (t) => {
  process.env.DATABASE_URL = appUrl();
  const admin = new pg.Client({ connectionString: adminUrl() });
  try {
    await admin.connect();
  } catch {
    t.skip("Postgres is not reachable");
    return;
  }
  try {
    const ready = await admin.query(`SELECT 1 FROM books_journal_entries WHERE id = $1`, [SCHED_RENT]);
    if (!ready.rowCount) {
      t.skip("books seed not applied");
      return;
    }

    const n = await admin.query(`SELECT books_run_due_schedule_posts() AS n`);
    assert.ok(Number(n.rows[0].n) >= 0);

    const rent = await admin.query(
      `SELECT status, entry_no, reference, memo FROM books_journal_entries WHERE id = $1`,
      [SCHED_RENT],
    );
    assert.equal(rent.rows[0].status, "posted", "June scheduled rent must be posted by job");
    assert.match(String(rent.rows[0].entry_no || ""), /^(JV|JE)-2026-\d{4}$/);
    assert.equal(String(rent.rows[0].memo), "Office rent June");

    const vatReturn = await admin.query(
      `SELECT status, entry_type, voucher_type FROM books_journal_entries WHERE id = $1`,
      [VAT_RETURN],
    );
    if (!vatReturn.rowCount) {
      t.skip("VAT two-step seed (22) not applied");
      return;
    }
    assert.equal(vatReturn.rows[0].status, "posted");
    assert.equal(vatReturn.rows[0].entry_type, "manual");
    assert.equal(vatReturn.rows[0].voucher_type, "Journal");

    const vatPay = await admin.query(
      `SELECT status, voucher_type FROM books_journal_entries WHERE id = $1`,
      [VAT_PAY],
    );
    assert.equal(vatPay.rows[0].status, "posted");
    assert.equal(vatPay.rows[0].voucher_type, "Payment");

    const tbMay = await booksTrialBalance(OMAR, DESERT, PERIOD_MAY);
    assert.equal(tbMay.accounts["6200"]?.periodDebitMinor, 8000, "May rent only");

    const tbJun = await booksTrialBalance(OMAR, DESERT, PERIOD_JUN);
    assert.equal(tbJun.accounts["6200"]?.periodDebitMinor, 8000, "June rent only");

    const fn = await admin.query(
      `SELECT pg_get_functiondef('books_run_due_schedule_posts()'::regprocedure) AS def`,
    );
    assert.match(String(fn.rows[0].def), /status = 'blocked'/);
    assert.match(String(fn.rows[0].def), /LOCKED/);
  } finally {
    await admin.end().catch(() => undefined);
  }
});
