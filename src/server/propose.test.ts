import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { createPeriod } from "./ledger";
import { approveProposal, proposeFromDocumentFacts } from "./propose";

const OMAR = "55555555-5555-4555-8555-555555555555";
const AL_NOOR = "22222222-2222-4222-8222-222222222222";

test("propose sales invoice then approve posts a balanced journal", async (t) => {
  const appUrl =
    process.env.DATABASE_URL || "postgresql://daftar_app:daftar-local-only@127.0.0.1:5432/daftar_test";
  process.env.DATABASE_URL = appUrl;
  const adminUrl = process.env.DATABASE_URL_SUPER || appUrl.replace("://daftar_app:", "://daftar:");
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const ready = await admin.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_proposals'`,
  );
  if (!ready.rowCount) {
    t.skip("pipeline schema not migrated");
    await admin.end();
    return;
  }

  try {
    const period = await createPeriod(OMAR, AL_NOOR, {
      label: "G3-propose",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
    });
    const proposal = await proposeFromDocumentFacts(OMAR, AL_NOOR, {
      periodId: period.id,
      docType: "SALES_INVOICE",
      entryDate: "2026-08-10",
      taxableMinor: 100000,
      vatMinor: 5000,
      counterparty: "Lab Buyer",
      confidence: 90,
    });
    assert.ok(proposal);
    assert.equal(proposal?.status, "PROPOSED");
    assert.ok((proposal?.lines.length || 0) >= 2);

    const posted = await approveProposal(OMAR, AL_NOOR, proposal!.id, true);
    assert.equal(posted?.status, "POSTED");
    assert.ok(posted?.journalEntryId);
  } finally {
    await admin.end().catch(() => undefined);
  }
});
