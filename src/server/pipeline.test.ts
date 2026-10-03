import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { createPeriod } from "./ledger";
import { PIPELINE_STAGES, missingDocsChecklist, recomputePipeline } from "./pipeline";
import { proposeFromDocumentFacts, approveProposal } from "./propose";

const OMAR = "55555555-5555-4555-8555-555555555555";
const AL_NOOR = "22222222-2222-4222-8222-222222222222";

test("pipeline stages list is ordered", () => {
  assert.equal(PIPELINE_STAGES[0], "DOCS_COLLECTING");
  assert.equal(PIPELINE_STAGES.at(-1), "PACKS_RELEASED");
});

test("recomputePipeline advances after posting a proposal", async (t) => {
  const appUrl =
    process.env.DATABASE_URL || "postgresql://daftar_app:daftar-local-only@127.0.0.1:5432/daftar_test";
  process.env.DATABASE_URL = appUrl;
  const adminUrl = process.env.DATABASE_URL_SUPER || appUrl.replace("://daftar_app:", "://daftar:");
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const ready = await admin.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'period_pipeline_status'`,
  );
  if (!ready.rowCount) {
    t.skip("pipeline schema not migrated");
    await admin.end();
    return;
  }

  try {
    const period = await createPeriod(OMAR, AL_NOOR, {
      label: "G4-pipeline",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    });
    const proposal = await proposeFromDocumentFacts(OMAR, AL_NOOR, {
      periodId: period.id,
      docType: "SALES_INVOICE",
      entryDate: "2026-09-05",
      taxableMinor: 20000,
      vatMinor: 1000,
      confidence: 90,
    });
    await approveProposal(OMAR, AL_NOOR, proposal!.id, true);
    const status = await recomputePipeline(OMAR, AL_NOOR, period.id);
    assert.ok(PIPELINE_STAGES.includes(status.stage));
    assert.ok((status.counts.postedProposals || 0) >= 1);

    const missing = await missingDocsChecklist(OMAR, AL_NOOR, period.id);
    assert.ok(Array.isArray(missing));
    assert.ok(missing.some((m) => m.code === "opening_tb"));
  } finally {
    await admin.end().catch(() => undefined);
  }
});
