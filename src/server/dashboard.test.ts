import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { dashboard } from "@/server/data";

const OMAR = "55555555-5555-4555-8555-555555555555";
const AL_NOOR = "22222222-2222-4222-8222-222222222222";

test("dashboard with empty clientId returns zero attention counts", async () => {
  const payload = await dashboard(OMAR, "");
  assert.equal(payload.inboxToReview, 0);
  assert.equal(payload.statementsStuck, 0);
  assert.equal(payload.bankUnclassified, 0);
  assert.equal(payload.bankNeedsReview, 0);
  assert.equal(payload.draftJournals, 0);
  assert.equal(payload.statements, 0);
  assert.equal(payload.transactions, 0);
  assert.deepEqual(payload.recent, []);
});

test("dashboard attention payload is numeric for a synthetic client", async (t) => {
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
    const has = await admin.query(`SELECT to_regclass('public.bank_transactions') AS reg`);
    if (!has.rows[0]?.reg) {
      t.skip("bank tables not migrated");
      return;
    }
    const payload = await dashboard(OMAR, AL_NOOR);
    for (const key of [
      "inboxToReview",
      "statementsStuck",
      "bankUnclassified",
      "bankNeedsReview",
      "draftJournals",
      "statements",
      "transactions",
      "needsReview",
      "balanceFailures",
    ] as const) {
      assert.equal(typeof payload[key], "number", key);
      assert.ok(payload[key] >= 0, key);
    }
    assert.equal(payload.bankNeedsReview, payload.needsReview);
    assert.ok(Array.isArray(payload.recent));
  } finally {
    await admin.end().catch(() => undefined);
  }
});
