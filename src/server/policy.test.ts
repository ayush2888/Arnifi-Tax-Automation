import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

process.env.DATABASE_URL = "postgresql://daftar_app:daftar-local-only@127.0.0.1:5432/daftar_test";

const OMAR = "55555555-5555-4555-8555-555555555555";
const AL_NOOR = "22222222-2222-4222-8222-222222222222";
const NORTHWIND = "77777777-7777-4777-8777-777777777777";
const RENT = "c1000000-0000-4000-8000-000000000002";

test("a correction is logged without a rule until Save as rule is called", async () => {
  const { patchTransaction, createRule, exportTransactions } = await import("./data");
  const { formatMinor } = await import("../lib/money");
  const admin = new pg.Client({ connectionString: "postgresql://daftar:daftar-local-only@127.0.0.1:5432/daftar_test" });
  await admin.connect();
  const fileId = crypto.randomUUID();
  const statementId = crypto.randomUUID();
  const txnId = crypto.randomUUID();
  try {
    await admin.query(
      `INSERT INTO files (id, client_id, sha256, original_name, detected_mime, size, storage_key, uploaded_by)
       VALUES ($1,$2,$3,'policy.csv','text/csv',1,'test/policy',$4)`,
      [fileId, AL_NOOR, fileId, OMAR],
    );
    await admin.query(
      `INSERT INTO statements (id, client_id, bank_account_id, file_id, currency, status)
       VALUES ($1,$2,$3,$4,'AED','parsed')`,
      [statementId, AL_NOOR, NORTHWIND, fileId],
    );
    await admin.query(
      `INSERT INTO bank_transactions (
         id, client_id, statement_id, row_no, txn_date, description_raw, description_clean,
         debit_minor, balance_minor, currency, txn_type, dedupe_hash, reference
       ) VALUES ($1,$2,$3,1,'2024-01-20','POLICY-ROW-XYZ','POLICY-ROW-XYZ',25000,760000,'AED','debit',$4,'P-1')`,
      [txnId, AL_NOOR, statementId, txnId],
    );
    const rulesBefore = await admin.query(`SELECT count(*)::int AS n FROM rules`);
    const patched = await patchTransaction(OMAR, AL_NOOR, txnId, { categoryId: RENT });
    assert.equal(patched.ok, true);
    const correction = await admin.query(
      `SELECT saved_as_rule FROM corrections WHERE bank_transaction_id = $1 AND field = 'categoryId'`,
      [txnId],
    );
    assert.equal(correction.rows[0].saved_as_rule, false);
    const audit = await admin.query(
      `SELECT action FROM audit_log WHERE entity = 'bank_transaction' AND entity_id = $1`,
      [txnId],
    );
    assert.equal(audit.rows[0].action, "correct");
    const rulesAfter = await admin.query(`SELECT count(*)::int AS n FROM rules`);
    assert.equal(rulesAfter.rows[0].n, rulesBefore.rows[0].n);
    await assert.rejects(() => patchTransaction(OMAR, AL_NOOR, txnId, { debitMinor: 10.5 }));
    const created = await createRule(OMAR, AL_NOOR, {
      matchType: "contains",
      pattern: "POLICY-ROW-XYZ",
      categoryId: RENT,
      transactionId: txnId,
    });
    assert.ok(created && "id" in created);
    const explicit = await admin.query(
      `SELECT saved_as_rule FROM corrections WHERE bank_transaction_id = $1 AND field = 'rule'`,
      [txnId],
    );
    assert.equal(explicit.rows[0].saved_as_rule, true);
    await admin.query(`UPDATE bank_transactions SET description_clean = $2, description_raw = $2 WHERE id = $1`, [
      txnId,
      '=HYPERLINK("http://evil.test")',
    ]);
    const csv = await exportTransactions(OMAR, AL_NOOR, { q: "HYPERLINK", tab: "all" });
    assert.match(csv, new RegExp(formatMinor(25000)));
    assert.match(csv, /Unmatched/);
    assert.match(csv, /'=HYPERLINK/);
    assert.equal(csv.includes(',=HYPERLINK'), false);
    const lines = csv.trim().split("\n");
    assert.equal(lines.length, 2);
  } finally {
    await admin.query(`DELETE FROM statements WHERE id = $1`, [statementId]);
    await admin.end();
  }
});

test("listing stays windowed at 50,000 rows", async () => {
  const { listTransactions } = await import("./data");
  const admin = new pg.Client({ connectionString: "postgresql://daftar:daftar-local-only@127.0.0.1:5432/daftar_test" });
  await admin.connect();
  const fileId = crypto.randomUUID();
  const statementId = crypto.randomUUID();
  try {
    await admin.query(
      `INSERT INTO files (id, client_id, sha256, original_name, detected_mime, size, storage_key, uploaded_by)
       VALUES ($1,$2,$3,'volume.csv','text/csv',1,'test/volume',$4)`,
      [fileId, AL_NOOR, fileId, OMAR],
    );
    await admin.query(
      `INSERT INTO statements (id, client_id, bank_account_id, file_id, currency, status)
       VALUES ($1,$2,$3,$4,'AED','parsed')`,
      [statementId, AL_NOOR, NORTHWIND, fileId],
    );
    await admin.query(
      `INSERT INTO bank_transactions (
         client_id, statement_id, row_no, txn_date, description_raw, description_clean,
         debit_minor, balance_minor, currency, txn_type, dedupe_hash, reference, flags
       )
       SELECT $1, $2, g, DATE '2020-01-01' + (((g % 400)::text || ' days')::interval),
              'VOLUME', 'VOLUME', 100, 100, 'AED', 'debit', 'vol-' || g::text, 'V' || g::text, '{volume}'
       FROM generate_series(1, 50000) g`,
      [AL_NOOR, statementId],
    );
    const page = await listTransactions(OMAR, AL_NOOR, {
      tab: "all",
      flag: "volume",
      sort: "row",
      dir: "asc",
      offset: 49800,
      limit: 200,
    });
    assert.equal(page.total, 50000);
    assert.equal(page.rows.length, 200);
    assert.equal(page.rows[0].rowNo, 49801);
    assert.equal(page.rows.at(-1)?.rowNo, 50000);
  } finally {
    await admin.query(`DELETE FROM statements WHERE id = $1`, [statementId]);
    await admin.end();
  }
});
