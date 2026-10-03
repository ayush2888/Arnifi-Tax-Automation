import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import {
  getClientProfile,
  listPostingRules,
  listSourceAccounts,
  pickPostingRule,
  upsertFxRate,
} from "./pipeline-config";

const OMAR = "55555555-5555-4555-8555-555555555555";
const NINA = "66666666-6666-4666-8666-666666666666";
const AL_NOOR = "22222222-2222-4222-8222-222222222222";
const HARBOUR = "33333333-3333-4333-8333-333333333333";

test("pickPostingRule prefers client override then lower priority", () => {
  const picked = pickPostingRule(
    [
      {
        id: "g",
        firmId: "f",
        clientId: null,
        docType: "SALES_INVOICE",
        vendorPattern: null,
        narrationRegex: null,
        itemPattern: null,
        lineFlag: "revenue",
        vatTreatment: "standard",
        targetAccountCode: "4000",
        targetAccountId: null,
        priority: 900,
        deferMonths: 0,
        active: true,
      },
      {
        id: "c",
        firmId: "f",
        clientId: AL_NOOR,
        docType: "SALES_INVOICE",
        vendorPattern: null,
        narrationRegex: null,
        itemPattern: "disbursement",
        lineFlag: "disbursement",
        vatTreatment: "none",
        targetAccountCode: "1300",
        targetAccountId: null,
        priority: 50,
        deferMonths: 0,
        active: true,
      },
    ],
    { docType: "SALES_INVOICE", item: "Government fee disbursement" },
  );
  assert.equal(picked?.id, "c");
  assert.equal(picked?.lineFlag, "disbursement");
});

test("Al Noor profile and source accounts are visible; Nina cannot read Al Noor", async (t) => {
  const appUrl =
    process.env.DATABASE_URL || "postgresql://daftar_app:daftar-local-only@127.0.0.1:5432/daftar_test";
  process.env.DATABASE_URL = appUrl;
  const adminUrl = process.env.DATABASE_URL_SUPER || appUrl.replace("://daftar_app:", "://daftar:");
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const ready = await admin.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'client_profile'`,
  );
  if (!ready.rowCount) {
    t.skip("pipeline schema not migrated");
    await admin.end();
    return;
  }

  try {
    const profile = await getClientProfile(OMAR, AL_NOOR);
    assert.ok(profile);
    assert.equal(profile?.legalName, "Al Noor Trading LLC");
    const sources = await listSourceAccounts(OMAR, AL_NOOR);
    assert.ok(sources.length >= 1);
    const rules = await listPostingRules(OMAR, AL_NOOR);
    assert.ok(rules.some((r) => r.clientId === null));

    await upsertFxRate(OMAR, AL_NOOR, {
      rateDate: "2026-01-15",
      currency: "USD",
      rateToAedScaled: 367_000_000, // 3.67 * 1e8
    });

    const ninaProfile = await getClientProfile(NINA, AL_NOOR);
    assert.equal(ninaProfile, null);

    const harbour = await getClientProfile(NINA, HARBOUR);
    assert.ok(harbour);
    assert.equal(harbour?.legalName, "Harbour Cafe LLC");
  } finally {
    await admin.end().catch(() => undefined);
  }
});
