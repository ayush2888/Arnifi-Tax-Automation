import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { unsupportedCurrency, unsupportedCurrencyMessage } from "./currency";

const appUrl =
  process.env.DATABASE_URL || "postgresql://daftar_app:daftar-local-only@127.0.0.1:5432/daftar_test";
process.env.DATABASE_URL = appUrl;
const adminUrl =
  process.env.DATABASE_URL_SUPER || appUrl.replace("://daftar_app:", "://daftar:");

const OMAR = "55555555-5555-4555-8555-555555555555";
const AL_NOOR = "22222222-2222-4222-8222-222222222222";
const NORTHWIND = "77777777-7777-4777-8777-777777777777";

test("upload refuses a 3-decimal currency before the file is stored", async () => {
  const { registerUpload } = await import("../server/data");
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const csv = Buffer.from(
    "Bank,Northwind Commercial Bank\nCurrency,KWD\nDate,Description,Debit,Credit,Balance,Reference\n2024-01-02,Test,1.230,,1.230,K-1\n",
  );
  try {
    const result = await registerUpload(OMAR, AL_NOOR, NORTHWIND, "kwd-web.csv", csv, "text/csv");
    assert.deepEqual(result, {
      error: "unsupported_currency",
      message: unsupportedCurrencyMessage("KWD"),
    });
    assert.match(unsupportedCurrencyMessage("KWD"), /3 decimal places/);
    const stored = await admin.query(`SELECT count(*)::int AS n FROM files WHERE original_name = 'kwd-web.csv'`);
    assert.equal(stored.rows[0].n, 0);
    assert.equal(unsupportedCurrency(Buffer.from("Currency,AED\n")), null);
  } finally {
    await admin.end();
  }
});
