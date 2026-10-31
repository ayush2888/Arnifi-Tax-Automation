import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { BooksError } from "./errors";
import { createBooksJournal, postBooksJournal, reverseBooksJournal } from "./journals";
import {
  createBooksParty,
  groupLedgerOverview,
  listBooksParties,
  subsidiaryLedgerAging,
  subsidiaryLedgerStatement,
  subsidiaryLedgerSummary,
  updateBooksParty,
} from "./subsidiary-ledgers";

const OMAR = "55555555-5555-4555-8555-555555555555";
const LAYLA = "44444444-4444-4444-8444-444444444444";
const DESERT = "e1000001-0000-4000-8000-000000000001";
const GULF = "e1000001-0000-4000-8000-000000000002";
const BANK = "e3000001-0000-4000-8000-000000000001";

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
  const ready = await admin.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'books_parties'`,
  );
  if (!ready.rowCount) {
    t.skip("subsidiary ledger schema not migrated (30)");
    await admin.end();
    return null;
  }
  return admin;
}

function codeOf(error: unknown) {
  return error instanceof BooksError ? error.code : String(error);
}

async function post(userId: string, body: Parameters<typeof createBooksJournal>[2]) {
  const draft = await createBooksJournal(userId, DESERT, { ...body, post: false });
  const approver = userId === OMAR ? LAYLA : OMAR;
  return postBooksJournal(approver, DESERT, draft.id);
}

test("party ledgers: sales statement, summary, reversal and tenant isolation", async (t) => {
  const admin = await withAdmin(t);
  if (!admin) return;
  try {
    const ar = await admin.query(
      `SELECT id FROM books_accounts WHERE client_id = $1 AND is_ar AND active AND is_postable ORDER BY code LIMIT 1`,
      [DESERT],
    );
    const revenue = await admin.query(
      `SELECT id FROM books_accounts WHERE client_id = $1 AND account_type = 'income' AND active AND is_postable ORDER BY code LIMIT 1`,
      [DESERT],
    );
    if (!ar.rowCount || !revenue.rowCount) {
      t.skip("Desert Falcon has no AR or revenue account");
      return;
    }
    const AR = String(ar.rows[0].id);
    const REVENUE = String(revenue.rows[0].id);

    const stamp = Date.now();
    const periodRow = await admin.query(
      `INSERT INTO books_periods (client_id, label, period_start, period_end, status)
       VALUES ($1,$2,'2031-03-01','2031-03-31','OPEN') RETURNING id`,
      [DESERT, `sl-${stamp}`],
    );
    const periodId = String(periodRow.rows[0].id);

    const acme = await createBooksParty(OMAR, DESERT, { name: `Acme ${stamp}`, partyType: "customer" });
    const beta = await createBooksParty(OMAR, DESERT, { name: `Beta ${stamp}`, partyType: "customer" });

    await assert.rejects(
      () => createBooksParty(OMAR, DESERT, { name: `  acme   ${stamp} `, partyType: "customer" }),
      (error: unknown) => codeOf(error) === "conflict",
    );
    await assert.rejects(
      () => createBooksParty(OMAR, DESERT, { name: "Bad TRN", partyType: "customer", trn: "123" }),
      (error: unknown) => error instanceof BooksError && error.message === "party_trn_invalid",
    );

    const listed = await listBooksParties(OMAR, DESERT, { partyType: "customer" });
    assert.ok(listed.some((p: { id: string }) => p.id === acme.id));

    await post(OMAR, {
      periodId,
      entryDate: "2031-03-05",
      memo: "Invoice Acme",
      reference: "INV-A1",
      lines: [
        { accountId: AR, debitMinor: 10_000, partyId: acme.id },
        { accountId: REVENUE, creditMinor: 10_000 },
      ],
    });
    await post(OMAR, {
      periodId,
      entryDate: "2031-03-06",
      memo: "Invoice Beta",
      reference: "INV-B1",
      lines: [
        { accountId: AR, debitMinor: 4_000, partyId: beta.id },
        { accountId: REVENUE, creditMinor: 4_000 },
      ],
    });
    const receipt = await post(OMAR, {
      periodId,
      entryDate: "2031-03-10",
      memo: "Receipt Acme",
      reference: "RCT-A1",
      lines: [
        { accountId: BANK, debitMinor: 6_000 },
        { accountId: AR, creditMinor: 6_000, partyId: acme.id },
      ],
    });

    const statement = await subsidiaryLedgerStatement(OMAR, DESERT, "sales", periodId, acme.id);
    assert.equal(statement.openingBalanceMinor, 0);
    assert.deepEqual(
      statement.lines.map((l) => l.balanceMinor),
      [10_000, 4_000],
    );
    assert.equal(statement.closingBalanceMinor, 4_000);
    assert.equal(statement.party.name, `Acme ${stamp}`);

    const summary = await subsidiaryLedgerSummary(OMAR, DESERT, "sales", periodId);
    const rowFor = (id: string) => summary.parties.find((p) => p.partyId === id);
    assert.equal(rowFor(acme.id)?.closingBalanceMinor, 4_000);
    assert.equal(rowFor(beta.id)?.closingBalanceMinor, 4_000);
    assert.equal(rowFor(acme.id)?.periodDebitMinor, 10_000);
    assert.equal(rowFor(acme.id)?.periodCreditMinor, 6_000);
    assert.equal(
      summary.totals.closingBalanceMinor,
      summary.parties.reduce((sum, p) => sum + p.closingBalanceMinor, 0),
    );

    const purchase = await subsidiaryLedgerSummary(OMAR, DESERT, "purchase", periodId);
    assert.equal(purchase.parties.find((p) => p.partyId === acme.id), undefined);

    const reversal = await reverseBooksJournal(LAYLA, DESERT, receipt.id, "2031-03-11");
    assert.equal(reversal.status, "reversed");
    const afterReversal = await subsidiaryLedgerStatement(OMAR, DESERT, "sales", periodId, acme.id);
    assert.equal(afterReversal.closingBalanceMinor, 10_000);

    const foreign = await admin.query(
      `INSERT INTO books_parties (client_id, name, party_type) VALUES ($1,$2,'customer') RETURNING id`,
      [GULF, `Foreign ${stamp}`],
    );
    await assert.rejects(
      () =>
        createBooksJournal(OMAR, DESERT, {
          periodId,
          entryDate: "2031-03-12",
          memo: "cross tenant",
          lines: [
            { accountId: AR, debitMinor: 100, partyId: String(foreign.rows[0].id) },
            { accountId: REVENUE, creditMinor: 100 },
          ],
          post: false,
        }),
      (error: unknown) => codeOf(error) === "not_found",
    );
    await assert.rejects(
      () => subsidiaryLedgerStatement(OMAR, DESERT, "sales", periodId, String(foreign.rows[0].id)),
      (error: unknown) => codeOf(error) === "not_found",
    );
  } finally {
    await admin.end().catch(() => undefined);
  }
});

test("subsidiary ledger rejects bad kind, period and party keys", async (t) => {
  const admin = await withAdmin(t);
  if (!admin) return;
  try {
    const period = await admin.query(`SELECT id FROM books_periods WHERE client_id = $1 LIMIT 1`, [DESERT]);
    if (!period.rowCount) {
      t.skip("no period");
      return;
    }
    const periodId = String(period.rows[0].id);
    await assert.rejects(
      () => subsidiaryLedgerSummary(OMAR, DESERT, "payroll", periodId),
      (error: unknown) => codeOf(error) === "invalid_ledger",
    );
    await assert.rejects(
      () => subsidiaryLedgerSummary(OMAR, DESERT, "sales", "not-a-uuid"),
      (error: unknown) => codeOf(error) === "not_found",
    );
    await assert.rejects(
      () => subsidiaryLedgerStatement(OMAR, DESERT, "sales", periodId, "nope"),
      (error: unknown) => codeOf(error) === "not_found",
    );
    const unassigned = await subsidiaryLedgerStatement(OMAR, DESERT, "sales", periodId, "unassigned");
    assert.equal(unassigned.party.id, null);
  } finally {
    await admin.end().catch(() => undefined);
  }
});

test("aging, party update and group overview", async (t) => {
  const admin = await withAdmin(t);
  if (!admin) return;
  try {
    const ar = await admin.query(
      `SELECT id FROM books_accounts WHERE client_id = $1 AND is_ar AND active AND is_postable ORDER BY code LIMIT 1`,
      [DESERT],
    );
    const revenue = await admin.query(
      `SELECT id FROM books_accounts WHERE client_id = $1 AND account_type = 'income' AND active AND is_postable ORDER BY code LIMIT 1`,
      [DESERT],
    );
    if (!ar.rowCount || !revenue.rowCount) {
      t.skip("Desert Falcon has no AR or revenue account");
      return;
    }
    const AR = String(ar.rows[0].id);
    const REVENUE = String(revenue.rows[0].id);
    const stamp = Date.now();
    const periodRow = await admin.query(
      `INSERT INTO books_periods (client_id, label, period_start, period_end, status)
       VALUES ($1,$2,'2032-06-01','2032-06-30','OPEN') RETURNING id`,
      [DESERT, `ag-${stamp}`],
    );
    const periodId = String(periodRow.rows[0].id);
    const acme = await createBooksParty(OMAR, DESERT, { name: `Aging ${stamp}`, partyType: "customer" });

    await post(OMAR, {
      periodId,
      entryDate: "2032-06-01",
      memo: "Old invoice",
      lines: [
        { accountId: AR, debitMinor: 5_000, partyId: acme.id },
        { accountId: REVENUE, creditMinor: 5_000 },
      ],
    });
    await post(OMAR, {
      periodId,
      entryDate: "2032-06-28",
      memo: "Recent invoice",
      lines: [
        { accountId: AR, debitMinor: 2_000, partyId: acme.id },
        { accountId: REVENUE, creditMinor: 2_000 },
      ],
    });
    await post(OMAR, {
      periodId,
      entryDate: "2032-06-29",
      memo: "Part receipt",
      lines: [
        { accountId: BANK, debitMinor: 1_000 },
        { accountId: AR, creditMinor: 1_000, partyId: acme.id },
      ],
    });

    const aging = await subsidiaryLedgerAging(OMAR, DESERT, "sales", periodId);
    const row = aging.parties.find((p) => p.partyId === acme.id);
    assert.ok(row, "party appears in aging");
    assert.equal(row.totalMinor, 6_000);
    assert.equal(aging.asOf, "2032-06-30");
    assert.equal(
      aging.totals.totalMinor,
      aging.parties.reduce((s, p) => s + p.totalMinor, 0),
    );

    const updated = await updateBooksParty(OMAR, DESERT, acme.id, { email: "ap@example.com", active: false });
    assert.equal(updated.active, false);
    assert.equal(updated.email, "ap@example.com");
    const activeList = await listBooksParties(OMAR, DESERT, {});
    assert.ok(!activeList.some((p: { id: string }) => p.id === acme.id));
    const allList = await listBooksParties(OMAR, DESERT, { includeInactive: true });
    assert.ok(allList.some((p: { id: string }) => p.id === acme.id));
    await assert.rejects(
      () => updateBooksParty(OMAR, DESERT, acme.id, { name: "" }),
      (error: unknown) => error instanceof BooksError && error.message === "party_name_required",
    );
    await assert.rejects(
      () => updateBooksParty(OMAR, DESERT, "00000000-0000-4000-8000-000000000000", { active: true }),
      (error: unknown) => codeOf(error) === "not_found",
    );
    // Inactive parties keep their history in the statement.
    const statement = await subsidiaryLedgerStatement(OMAR, DESERT, "sales", periodId, acme.id);
    assert.equal(statement.closingBalanceMinor, 6_000);

    const group = await groupLedgerOverview(OMAR, "2032-06-30");
    const desert = group.companies.find((c) => c.clientId === DESERT);
    assert.ok(desert, "Desert Falcon is in the group");
    assert.ok(desert.balances.sales >= 6_000);
    await assert.rejects(
      () => groupLedgerOverview(OMAR, "2032-13-45"),
      (error: unknown) => codeOf(error) === "invalid_date",
    );
  } finally {
    await admin.end().catch(() => undefined);
  }
});
