import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { LedgerError } from "./errors";
import {
  assertBalanced,
  createJournal,
  postJournal,
  sumDebitsCredits,
  trialBalance,
  trialBalanceFromLines,
} from "./ledger";

const AR = "a1000001-0000-4000-8000-000000000002";
const REVENUE = "a1000001-0000-4000-8000-000000000007";
const VAT_OUT = "a1000001-0000-4000-8000-000000000005";
const PERIOD = "a0000001-0000-4000-8000-000000000001";
const OMAR = "55555555-5555-4555-8555-555555555555";
const AL_NOOR = "22222222-2222-4222-8222-222222222222";

test("unbalanced lines fail in the app before any write", () => {
  assert.throws(
    () =>
      assertBalanced([
        { accountId: AR, debitMinor: 10500 },
        { accountId: REVENUE, creditMinor: 10000 },
      ]),
    (error: unknown) => error instanceof LedgerError && error.code === "journal_unbalanced",
  );
});

test("balanced sales-shaped lines pass and TB identity holds", () => {
  const lines = [
    { accountId: AR, debitMinor: 10500, creditMinor: 0 },
    { accountId: REVENUE, debitMinor: 0, creditMinor: 10000 },
    { accountId: VAT_OUT, debitMinor: 0, creditMinor: 500 },
  ];
  const sums = sumDebitsCredits(lines);
  assert.equal(sums.balanced, true);
  assert.equal(sums.debit, 10500);
  assert.equal(sums.credit, 10500);
  const tb = trialBalanceFromLines(lines);
  assert.equal(tb.balanced, true);
  assert.equal(tb.totalDebit, tb.totalCredit);
});

test("property: random balanced journals keep TB debit = credit", () => {
  for (let i = 0; i < 50; i++) {
    const amount = (i + 1) * 100;
    const vat = Math.floor(amount * 0.05);
    const lines = [
      { accountId: "a", debitMinor: amount + vat, creditMinor: 0 },
      { accountId: "b", debitMinor: 0, creditMinor: amount },
      { accountId: "c", debitMinor: 0, creditMinor: vat },
    ];
    const tb = trialBalanceFromLines(lines);
    assert.equal(tb.totalDebit, tb.totalCredit);
    assert.equal(tb.balanced, true);
  }
});

test("posted balanced journal survives DB balance trigger; unbalanced post fails", async (t) => {
  const appUrl =
    process.env.DATABASE_URL || "postgresql://daftar_app:daftar-local-only@127.0.0.1:5432/daftar_test";
  process.env.DATABASE_URL = appUrl;
  const adminUrl =
    process.env.DATABASE_URL_SUPER || appUrl.replace("://daftar_app:", "://daftar:");
  const admin = new pg.Client({ connectionString: adminUrl });
  try {
    await admin.connect();
  } catch {
    t.skip("Postgres daftar_test is not reachable");
    return;
  }
  try {
    const hasLedger = await admin.query(`SELECT to_regclass('public.journal_entries') AS reg`);
    if (!hasLedger.rows[0]?.reg) {
      t.skip("ledger tables not migrated");
      await admin.end();
      return;
    }

    const balanced = await createJournal(OMAR, AL_NOOR, {
      periodId: PERIOD,
      memo: "ledger-test-balanced",
      entryDate: "2026-01-10",
      post: true,
      lines: [
        { accountId: AR, debitMinor: 21000 },
        { accountId: REVENUE, creditMinor: 20000 },
        { accountId: VAT_OUT, creditMinor: 1000, vat201Box: "1b" },
      ],
    });
    assert.equal(balanced.status, "posted");

    const tb = await trialBalance(OMAR, AL_NOOR, PERIOD);
    assert.equal(tb.balanced, true);

    await assert.rejects(
      () =>
        createJournal(OMAR, AL_NOOR, {
          periodId: PERIOD,
          memo: "ledger-test-unbalanced",
          entryDate: "2026-01-11",
          post: true,
          lines: [
            { accountId: AR, debitMinor: 1000 },
            { accountId: REVENUE, creditMinor: 900 },
          ],
        }),
      (error: unknown) => error instanceof LedgerError && error.code === "journal_unbalanced",
    );

    // Draft path then force-unbalance at SQL to prove DB trigger rejects posted status.
    const draft = await createJournal(OMAR, AL_NOOR, {
      periodId: PERIOD,
      memo: "ledger-test-draft",
      entryDate: "2026-01-12",
      post: false,
      lines: [
        { accountId: AR, debitMinor: 5000 },
        { accountId: REVENUE, creditMinor: 5000 },
      ],
    });
    await admin.query(`UPDATE journal_lines SET credit_minor = 4999 WHERE entry_id = $1 AND account_id = $2`, [
      draft.id,
      REVENUE,
    ]);
    await assert.rejects(() => postJournal(OMAR, AL_NOOR, draft.id));

    // DB deferred trigger must also reject posting an unbalanced entry.
    await assert.rejects(async () => {
      await admin.query("BEGIN");
      await admin.query(`UPDATE journal_entries SET status = 'posted', posted_at = now() WHERE id = $1`, [draft.id]);
      await admin.query("COMMIT");
    });
    await admin.query("ROLLBACK").catch(() => undefined);
  } finally {
    await admin.end().catch(() => undefined);
  }
});
