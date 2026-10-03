import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { LedgerError } from "./errors";
import { approveExtractionAndPost, createPeriod, createSyntheticDocument } from "./ledger";
import {
  confirmMatch,
  controlCheck,
  createException,
  listOpenItems,
  proposeMatch,
  resolveException,
  withinTolerance,
} from "./recon";

const OMAR = "55555555-5555-4555-8555-555555555555";
const AL_NOOR = "22222222-2222-4222-8222-222222222222";
const NORTHWIND = "77777777-7777-4777-8777-777777777777";

test("tolerance helper", () => {
  assert.equal(withinTolerance(100, 100, 0), true);
  assert.equal(withinTolerance(100, 101, 0), false);
  assert.equal(withinTolerance(100, 101, 1), true);
});

test("invoice posting creates AR open item; match clears it; control stays balanced", async (t) => {
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
    const has = await admin.query(`SELECT to_regclass('public.open_items') AS reg`);
    if (!has.rows[0]?.reg) {
      t.skip("recon tables not migrated");
      return;
    }

    const period = await createPeriod(OMAR, AL_NOOR, {
      label: "Recon test period",
      periodStart: "2026-04-01",
      periodEnd: "2026-04-30",
    });
    const periodId = period.id as string;

    const sales = await createSyntheticDocument(OMAR, AL_NOOR, {
      periodId,
      docType: "SALES_INVOICE",
      originalName: "recon-sales.json",
      facts: {
        entryDate: "2026-04-10",
        invoiceNumber: "INV-RECON-1",
        counterparty: "Reconcile Customer LLC",
        taxableMinor: 10000,
        vatMinor: 500,
      },
    });
    await approveExtractionAndPost(OMAR, AL_NOOR, sales.extractionId);

    const items = await listOpenItems(OMAR, AL_NOOR, { side: "AR", periodId });
    const item = items.find((row) => row.reference === "INV-RECON-1");
    assert.ok(item);
    assert.equal(Number(item.outstandingMinor), 10500);

    const before = await controlCheck(OMAR, AL_NOOR, periodId);
    assert.equal(before.ar.balanced, true);

    const fileId = crypto.randomUUID();
    const statementId = crypto.randomUUID();
    const txnId = crypto.randomUUID();
    const wrongTxn = crypto.randomUUID();
    await admin.query(
      `INSERT INTO files (id, client_id, sha256, original_name, detected_mime, size, storage_key, uploaded_by)
       VALUES ($1,$2,$3,'recon.csv','text/csv',1,'test/recon',$4)`,
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
         credit_minor, balance_minor, currency, txn_type, dedupe_hash, reference
       ) VALUES ($1,$2,$3,1,'2026-04-12','RECV INV-RECON-1','RECV INV-RECON-1',10500,100000,'AED','credit',$4,'R-1')`,
      [txnId, AL_NOOR, statementId, txnId],
    );
    await admin.query(
      `INSERT INTO bank_transactions (
         id, client_id, statement_id, row_no, txn_date, description_raw, description_clean,
         credit_minor, balance_minor, currency, txn_type, dedupe_hash, reference
       ) VALUES ($1,$2,$3,2,'2026-04-12','WRONG','WRONG',20000,90000,'AED','credit',$4,'R-2')`,
      [wrongTxn, AL_NOOR, statementId, wrongTxn],
    );

    await assert.rejects(
      () =>
        proposeMatch(OMAR, AL_NOOR, {
          periodId,
          bankTransactionIds: [wrongTxn],
          openItemIds: [item.id],
        }),
      (error: unknown) => error instanceof LedgerError && error.message === "match_out_of_tolerance",
    );

    const proposed = await proposeMatch(OMAR, AL_NOOR, {
      periodId,
      bankTransactionIds: [txnId],
      openItemIds: [item.id],
    });
    assert.equal(proposed.status, "PROPOSED");
    await confirmMatch(OMAR, AL_NOOR, proposed.id);

    const afterItems = await listOpenItems(OMAR, AL_NOOR, { periodId });
    const cleared = afterItems.find((row) => row.id === item.id);
    assert.equal(cleared?.status, "CLEARED");
    assert.equal(Number(cleared?.outstandingMinor), 0);

    const after = await controlCheck(OMAR, AL_NOOR, periodId);
    assert.equal(after.ar.balanced, true);
    assert.equal(after.balanced, true);

    const exc = await createException(OMAR, AL_NOOR, {
      kind: "UNMATCHED_BANK",
      periodId,
      bankTransactionId: wrongTxn,
      message: "leftover wrong-amount row",
    });
    assert.equal(exc.status, "OPEN");
    const resolved = await resolveException(OMAR, AL_NOOR, exc.id);
    assert.equal(resolved.status, "RESOLVED");
  } finally {
    await admin.end().catch(() => undefined);
  }
});
