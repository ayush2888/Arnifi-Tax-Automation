import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { LedgerError } from "./errors";
import {
  assertDownloadMfa,
  assertSessionTenantAllowed,
  issueMfaCookieValue,
  signMfaToken,
  verifyMfaCode,
  verifyMfaToken,
} from "./security-gate";

const OMAR = "55555555-5555-4555-8555-555555555555";
const AL_NOOR = "22222222-2222-4222-8222-222222222222";

test("demo MFA code and signed token round-trip", () => {
  process.env.MFA_DEMO_CODE = "000000";
  process.env.REQUIRE_DOWNLOAD_MFA = "true";
  assert.equal(verifyMfaCode("000000"), true);
  assert.equal(verifyMfaCode("111111"), false);

  const now = Date.now();
  const issued = issueMfaCookieValue(OMAR, now);
  assert.equal(verifyMfaToken(OMAR, issued.value, now), true);
  assert.equal(verifyMfaToken(OMAR, issued.value, issued.expiresAtMs + 1), false);
  assert.equal(verifyMfaToken("other-user", issued.value, now), false);

  assert.throws(
    () => assertDownloadMfa(OMAR, null),
    (error: unknown) => error instanceof LedgerError && error.message === "mfa_required",
  );
  assert.doesNotThrow(() => assertDownloadMfa(OMAR, issued.value));

  process.env.REQUIRE_DOWNLOAD_MFA = "false";
  assert.doesNotThrow(() => assertDownloadMfa(OMAR, null));
  process.env.REQUIRE_DOWNLOAD_MFA = "true";

  const forged = `${OMAR}.${issued.expiresAtMs}.deadbeef`;
  assert.equal(verifyMfaToken(OMAR, forged, 1_700_000_000_000), false);
  assert.ok(signMfaToken(OMAR, 123).includes("123"));
});

test("non-synthetic client is blocked while portal security is FAIL", async (t) => {
  process.env.PORTAL_SECURITY_STATUS = "FAIL";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || "postgresql://daftar_app:daftar-local-only@127.0.0.1:5432/daftar_test";
  const adminUrl =
    process.env.DATABASE_URL_SUPER ||
    process.env.DATABASE_URL.replace("://daftar_app:", "://daftar:");
  const admin = new pg.Client({ connectionString: adminUrl });
  try {
    await admin.connect();
  } catch {
    t.skip("Postgres is not reachable");
    return;
  }
  try {
    const col = await admin.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'clients' AND column_name = 'is_synthetic'`,
    );
    if (!col.rowCount) {
      t.skip("is_synthetic column not migrated");
      return;
    }

    await assertSessionTenantAllowed(OMAR, AL_NOOR);

    await admin.query(`UPDATE clients SET is_synthetic = false WHERE id = $1`, [AL_NOOR]);
    await assert.rejects(
      () => assertSessionTenantAllowed(OMAR, AL_NOOR),
      (error: unknown) =>
        error instanceof LedgerError && error.message === "real_client_data_blocked",
    );
  } finally {
    await admin.query(`UPDATE clients SET is_synthetic = true WHERE id = $1`, [AL_NOOR]).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
});
