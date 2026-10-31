import assert from "node:assert/strict";
import test from "node:test";

import {
  aedFromOriginal,
  buildInvoiceJournalLines,
  invoiceBlockers,
  type InvoiceFacts,
  type PostingAccounts,
} from "@/server/invoice-posting";

const ACCOUNTS: PostingAccounts = {
  ar: { id: "ar", code: "1100", name: "Accounts receivable" },
  ap: { id: "ap", code: "2000", name: "Accounts payable" },
  vatIn: { id: "vin", code: "1200", name: "VAT recoverable (input)" },
  vatOut: { id: "vout", code: "2100", name: "VAT payable (output)" },
  revenue: { id: "rev", code: "4000", name: "Sales revenue" },
  expense: { id: "exp", code: "5000", name: "Operating expenses" },
};

const JUNE = { periodStart: "2026-06-01", periodEnd: "2026-06-30" };
const USD_PEG = 367_250_000;

const sum = (lines: { debitMinor?: number; creditMinor?: number }[], side: "debitMinor" | "creditMinor") =>
  lines.reduce((acc, l) => acc + (l[side] ?? 0), 0);

test("USD sales invoice converts each line to AED, keeps originals, balances", () => {
  const facts: InvoiceFacts = {
    docKind: "TAX_INVOICE",
    invoiceNumber: "S-1",
    entryDate: "2026-06-01",
    counterparty: "Gulf Crest Trading LLC",
    currency: "USD",
    originalSubtotalMinor: 1_500_000,
    originalVatMinor: 75_000,
    fxRateScaled: USD_PEG,
  };
  const { lines } = buildInvoiceJournalLines(facts, "SALES_INVOICE", ACCOUNTS);
  assert.deepEqual(
    lines.map((l) => [l.accountCode, l.debitMinor, l.creditMinor, l.originalMinor]),
    [
      ["1100", 5_784_188, 0, 1_575_000],
      ["4000", 0, 5_508_750, 1_500_000],
      ["2100", 0, 275_438, 75_000],
    ],
  );
  assert.equal(sum(lines, "debitMinor"), sum(lines, "creditMinor"));
  assert.ok(lines.every((l) => l.originalCurrency === "USD" && l.fxRateScaled === USD_PEG));
  assert.equal(lines.find((l) => l.accountCode === "2100")?.vat201Box, "1b");
});

test("purchase with supplier TRN recovers input VAT", () => {
  const facts: InvoiceFacts = {
    docKind: "TAX_INVOICE",
    invoiceNumber: "P-1",
    entryDate: "2026-06-14",
    counterparty: "Palm Grove Supplies LLC",
    supplierTrn: "100000000000037",
    currency: "AED",
    originalSubtotalMinor: 400_000,
    originalVatMinor: 20_000,
  };
  const { lines, vatRecoverable } = buildInvoiceJournalLines(facts, "PURCHASE_INVOICE", ACCOUNTS);
  assert.equal(vatRecoverable, true);
  assert.deepEqual(
    lines.map((l) => [l.accountCode, l.debitMinor, l.creditMinor, l.vat201Box ?? null]),
    [
      ["5000", 400_000, 0, null],
      ["1200", 20_000, 0, "9"],
      ["2000", 0, 420_000, null],
    ],
  );
  assert.ok(lines.every((l) => l.originalCurrency === null));
});

test("purchase without supplier TRN puts VAT into the expense (not recoverable)", () => {
  const facts: InvoiceFacts = {
    docKind: "TAX_INVOICE",
    invoiceNumber: "P-2",
    entryDate: "2026-06-14",
    supplierTrn: null,
    currency: "AED",
    originalSubtotalMinor: 400_000,
    originalVatMinor: 20_000,
  };
  const { lines, vatRecoverable } = buildInvoiceJournalLines(facts, "PURCHASE_INVOICE", ACCOUNTS);
  assert.equal(vatRecoverable, false);
  assert.deepEqual(
    lines.map((l) => [l.accountCode, l.debitMinor, l.creditMinor]),
    [
      ["5000", 420_000, 0],
      ["2000", 0, 420_000],
    ],
  );
});

test("blockers: proforma, date outside month, missing FX, direction mismatch", () => {
  assert.deepEqual(
    invoiceBlockers(
      { docKind: "PROFORMA", invoiceNumber: "PI-1", entryDate: "2026-07-29", currency: "AED", originalSubtotalMinor: 100 },
      "PURCHASE_INVOICE",
      JUNE,
    ),
    ["not_a_tax_invoice", "date_outside_month"],
  );
  assert.deepEqual(
    invoiceBlockers(
      { docKind: "TAX_INVOICE", invoiceNumber: "S-1", entryDate: "2026-06-02", currency: "EUR", originalSubtotalMinor: 100 },
      "SALES_INVOICE",
      JUNE,
    ),
    ["fx_rate_needed"],
  );
  assert.deepEqual(
    invoiceBlockers(
      {
        docKind: "TAX_INVOICE",
        invoiceNumber: "S-1",
        entryDate: "2026-06-02",
        currency: "AED",
        originalSubtotalMinor: 100,
        warnings: ["looks_like_purchase"],
      },
      "SALES_INVOICE",
      JUNE,
    ),
    ["wrong_direction"],
  );
});

test("aedFromOriginal is exact for large amounts (BigInt, half-up)", () => {
  assert.equal(aedFromOriginal(100_000_000_000, USD_PEG), 367_250_000_000);
  assert.equal(aedFromOriginal(1, 150_000_000), 2);
  assert.equal(aedFromOriginal(null, USD_PEG), null);
});
