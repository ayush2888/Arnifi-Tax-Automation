import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { assertBooksBalanced, createBooksJournal, postBooksJournal, reverseBooksJournal } from "./journals";
import { lockBooksPeriod } from "./periods";
import { BooksError } from "./errors";

const OMAR = "55555555-5555-4555-8555-555555555555";
const LAYLA = "44444444-4444-4444-8444-444444444444";
const DESERT = "e1000001-0000-4000-8000-000000000001";
const BANK = "e3000001-0000-4000-8000-000000000001";
const REVENUE = "e3000001-0000-4000-8000-000000000007";

async function withAdmin(t: test.TestContext) {
  const appUrl =
    process.env.DATABASE_URL || "postgresql://daftar_app:daftar-local-only@127.0.0.1:5432/daftar_test";
  process.env.DATABASE_URL = appUrl;
  const adminUrl = process.env.DATABASE_URL_SUPER || appUrl.replace("://daftar_app:", "://daftar:");
  const admin = new pg.Client({ connectionString: adminUrl });
  try {
    await admin.connect();
  } catch {
    t.skip("Postgres is not reachable");
    return null;
  }
  const ready = await admin.query(`SELECT 1 FROM books_periods WHERE client_id = $1 LIMIT 1`, [DESERT]);
  if (!ready.rowCount) {
    t.skip("books schema not migrated");
    await admin.end();
    return null;
  }
  return admin;
}

test("assertBooksBalanced rejects unbalanced lines", () => {
  assert.throws(
    () =>
      assertBooksBalanced([
        { accountId: BANK, debitMinor: 100 },
        { accountId: REVENUE, creditMinor: 50 },
      ]),
    (error: unknown) => error instanceof BooksError,
  );
});

test("unbalanced post is rejected by app and DB balance trigger", async (t) => {
  const admin = await withAdmin(t);
  if (!admin) return;
  try {
    // Use a throwaway period so seed golden TB stays untouched.
    const temp = await admin.query(
      `INSERT INTO books_periods (client_id, label, period_start, period_end, status)
       VALUES ($1,$2,'2026-08-01','2026-08-31','OPEN') RETURNING id`,
      [DESERT, `unbal-${Date.now()}`],
    );
    const periodId = String(temp.rows[0].id);
    await assert.rejects(
      () =>
        createBooksJournal(OMAR, DESERT, {
          periodId,
          entryDate: "2026-08-01",
          memo: "bad",
          lines: [
            { accountId: BANK, debitMinor: 100 },
            { accountId: REVENUE, creditMinor: 40 },
          ],
          post: true,
        }),
      (error: unknown) => error instanceof BooksError,
    );
  } finally {
    await admin.end().catch(() => undefined);
  }
});

test("period lock blocks posting; reverse links a new posted entry", async (t) => {
  const admin = await withAdmin(t);
  if (!admin) return;
  try {
    const tempPeriod = await admin.query(
      `INSERT INTO books_periods (client_id, label, period_start, period_end, status)
       VALUES ($1,$2,'2026-07-01','2026-07-31','OPEN') RETURNING id`,
      [DESERT, `lock-${Date.now()}`],
    );
    const periodId = String(tempPeriod.rows[0].id);

    const draft = await createBooksJournal(OMAR, DESERT, {
      periodId,
      entryDate: "2026-07-02",
      memo: `lock-test-${Date.now()}`,
      lines: [
        { accountId: BANK, debitMinor: 500 },
        { accountId: REVENUE, creditMinor: 500 },
      ],
      post: false,
    });
    assert.equal(draft.status, "draft");
    await assert.rejects(
      () => postBooksJournal(OMAR, DESERT, draft.id),
      (error: unknown) => error instanceof BooksError && String(error.message).includes("approver"),
    );
    const posted = await postBooksJournal(LAYLA, DESERT, draft.id);
    assert.equal(posted.status, "posted");
    assert.match(String(posted.entryNo), /^(JV|JE)-2026-\d{4}$/);

    const reversed = await reverseBooksJournal(LAYLA, DESERT, draft.id, "2026-07-03");
    assert.equal(reversed.status, "reversed");
    assert.ok(reversed.reversalId);
    assert.equal(reversed.reversedByEntryId, reversed.reversalId);
    assert.equal(reversed.reversesEntryId, draft.id);
    assert.match(String(reversed.entryNo), /^(JV|JE)-2026-\d{4}$/);

    await lockBooksPeriod(LAYLA, DESERT, periodId);
    await assert.rejects(
      () =>
        createBooksJournal(OMAR, DESERT, {
          periodId,
          entryDate: "2026-07-05",
          memo: "into locked",
          lines: [
            { accountId: BANK, debitMinor: 100 },
            { accountId: REVENUE, creditMinor: 100 },
          ],
          post: true,
        }),
      (error: unknown) => error instanceof Error,
    );
  } finally {
    await admin.end().catch(() => undefined);
  }
});

test("posted lines are immutable", async (t) => {
  const admin = await withAdmin(t);
  if (!admin) return;
  try {
    await assert.rejects(
      () =>
        admin.query(
          `UPDATE books_journal_lines SET debit_minor = 1
           WHERE entry_id = 'e4000001-0000-4000-8000-000000000001'`,
        ),
      (error: unknown) => error instanceof Error && String(error).includes("books_posted_immutable"),
    );
  } finally {
    await admin.end().catch(() => undefined);
  }
});
