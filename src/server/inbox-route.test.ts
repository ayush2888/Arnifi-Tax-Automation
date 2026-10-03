import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { detectDocTypeFromName, listUnassignedInbox, registerFirmInboxUpload, routeInboxItem } from "./inbox-route";

const OMAR = "55555555-5555-4555-8555-555555555555";
const AL_NOOR = "22222222-2222-4222-8222-222222222222";
const PERIOD = "a0000001-0000-4000-8000-000000000001";

test("detectDocTypeFromName recognizes stripe and invoices", () => {
  assert.equal(detectDocTypeFromName("stripe_balance_history.csv").docType, "GATEWAY_CSV");
  assert.equal(detectDocTypeFromName("tax-invoice-100.pdf").docType, "SALES_INVOICE");
});

test("firm inbox upload stays pending until routed", async (t) => {
  const appUrl =
    process.env.DATABASE_URL || "postgresql://daftar_app:daftar-local-only@127.0.0.1:5432/daftar_test";
  process.env.DATABASE_URL = appUrl;
  const adminUrl = process.env.DATABASE_URL_SUPER || appUrl.replace("://daftar_app:", "://daftar:");
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const ready = await admin.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'document_inbox'`,
  );
  if (!ready.rowCount) {
    t.skip("pipeline schema not migrated");
    await admin.end();
    return;
  }

  try {
    const uploaded = await registerFirmInboxUpload(OMAR, {
      originalName: "mystery-scan.pdf",
      detectedMime: "application/pdf",
      size: 12,
      storageKey: "inbox/test/mystery-scan.pdf",
      contentSha256: `sha-${Date.now()}`,
      ocrUsed: true,
    });
    assert.equal(uploaded.routingStatus, "pending");
    const pending = await listUnassignedInbox(OMAR);
    assert.ok(pending.some((r) => r.id === uploaded.id));

    const routed = await routeInboxItem(OMAR, uploaded.id, {
      clientId: AL_NOOR,
      periodId: PERIOD,
      docType: "OTHER",
    });
    assert.ok(routed.documentId);
  } finally {
    await admin.end().catch(() => undefined);
  }
});
