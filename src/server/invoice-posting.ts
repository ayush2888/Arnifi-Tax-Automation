import { assertMinor } from "@/lib/money";
import type { JournalLineInput } from "@/server/ledger";

export const FX_RATE_SCALE = BigInt(100_000_000);

export type InvoiceDocType = "SALES_INVOICE" | "PURCHASE_INVOICE";

export type InvoiceFacts = {
  docKind?: string | null;
  invoiceNumber?: string | null;
  entryDate?: string | null;
  dueDate?: string | null;
  counterparty?: string | null;
  counterpartyTrn?: string | null;
  supplierTrn?: string | null;
  currency?: string | null;
  originalSubtotalMinor?: number | null;
  originalVatMinor?: number | null;
  originalTotalMinor?: number | null;
  fxRateScaled?: number | null;
  fxSource?: string | null;
  taxableMinor?: number | null;
  vatMinor?: number | null;
  totalMinor?: number | null;
  memo?: string | null;
  warnings?: string[];
  editedBy?: string[];
};

export type PostingAccount = { id: string; code: string; name: string };

export type PostingAccounts = {
  ar: PostingAccount;
  ap: PostingAccount;
  vatOut: PostingAccount;
  vatIn: PostingAccount;
  revenue: PostingAccount;
  expense: PostingAccount;
};

export type InvoicePostingLine = JournalLineInput & {
  accountCode: string;
  accountName: string;
  originalCurrency: string | null;
  originalMinor: number | null;
  fxRateScaled: number | null;
  aedMinor: number;
};

const TRN_RE = /^1\d{14}$/;

/** Half-up rounding of original minor units into AED fils (rate scaled by 1e8). */
export function aedFromOriginal(originalMinor: number | null | undefined, rateScaled: number | null | undefined) {
  if (originalMinor === null || originalMinor === undefined || rateScaled === null || rateScaled === undefined) {
    return null;
  }
  assertMinor(originalMinor);
  assertMinor(rateScaled);
  const sign = BigInt(originalMinor < 0 ? -1 : 1);
  const abs = BigInt(Math.abs(originalMinor));
  const aed = (abs * BigInt(rateScaled) + FX_RATE_SCALE / BigInt(2)) / FX_RATE_SCALE;
  const result = Number(sign * aed);
  if (!Number.isSafeInteger(result)) throw new Error("fx_overflow");
  return result;
}

/** Recompute AED amounts from original-currency amounts. AED invoices use rate 1. */
export function withAedAmounts(facts: InvoiceFacts): InvoiceFacts {
  const currency = (facts.currency || "AED").toUpperCase();
  const rate = currency === "AED" ? Number(FX_RATE_SCALE) : (facts.fxRateScaled ?? null);
  const taxableMinor = aedFromOriginal(facts.originalSubtotalMinor, rate);
  const vatMinor = aedFromOriginal(facts.originalVatMinor ?? 0, rate);
  return {
    ...facts,
    currency,
    fxRateScaled: rate,
    taxableMinor,
    vatMinor,
    totalMinor: taxableMinor === null || vatMinor === null ? null : taxableMinor + vatMinor,
  };
}

/** Input VAT is recoverable only on a tax invoice that carries the supplier's TRN. */
export function inputVatRecoverable(facts: InvoiceFacts) {
  const kind = facts.docKind || "UNKNOWN";
  return TRN_RE.test(String(facts.supplierTrn || "")) && (kind === "TAX_INVOICE" || kind === "INVOICE");
}

/** Reasons the document cannot be posted yet. Empty = ready. */
export function invoiceBlockers(
  facts: InvoiceFacts,
  docType: string,
  period: { periodStart: string; periodEnd: string },
): string[] {
  const out: string[] = [];
  if (docType !== "SALES_INVOICE" && docType !== "PURCHASE_INVOICE") out.push("unsupported_doc_type");
  if (facts.docKind === "PROFORMA" || facts.docKind === "QUOTATION") out.push("not_a_tax_invoice");
  if (facts.docKind === "UNKNOWN") out.push("not_an_invoice");
  if (!facts.invoiceNumber) out.push("invoice_number_missing");
  if (!facts.entryDate || !/^\d{4}-\d{2}-\d{2}$/.test(facts.entryDate)) out.push("date_missing");
  else if (facts.entryDate < period.periodStart || facts.entryDate > period.periodEnd) out.push("date_outside_month");
  const currency = (facts.currency || "AED").toUpperCase();
  if (currency !== "AED" && !facts.fxRateScaled) out.push("fx_rate_needed");
  if (!facts.originalSubtotalMinor || facts.originalSubtotalMinor <= 0) out.push("amount_missing");
  if ((facts.originalVatMinor ?? 0) < 0) out.push("amount_missing");
  const warnings = facts.warnings || [];
  if (docType === "SALES_INVOICE" && warnings.includes("looks_like_purchase")) out.push("wrong_direction");
  if (docType === "PURCHASE_INVOICE" && warnings.includes("looks_like_sales")) out.push("wrong_direction");
  return [...new Set(out)];
}

function line(
  account: PostingAccount,
  side: "debit" | "credit",
  aedMinor: number,
  originalMinor: number | null,
  facts: InvoiceFacts,
  memo: string,
  vat201Box: string | null = null,
): InvoicePostingLine {
  const currency = (facts.currency || "AED").toUpperCase();
  const foreign = currency !== "AED";
  return {
    accountId: account.id,
    accountCode: account.code,
    accountName: account.name,
    debitMinor: side === "debit" ? aedMinor : 0,
    creditMinor: side === "credit" ? aedMinor : 0,
    currency: "AED",
    vat201Box,
    lineMemo: memo,
    originalCurrency: foreign ? currency : null,
    originalMinor: foreign ? originalMinor : null,
    fxRateScaled: foreign ? (facts.fxRateScaled ?? null) : null,
    aedMinor,
  };
}

export function invoiceMemo(docType: string, facts: InvoiceFacts) {
  const label = docType === "SALES_INVOICE" ? "Sales invoice" : "Purchase invoice";
  return [label, facts.invoiceNumber, facts.counterparty].filter(Boolean).join(" · ");
}

/**
 * Sales:    Dr Receivable (gross) / Cr Revenue (net) / Cr Output VAT.
 * Purchase: Dr Expense (net) / Dr Input VAT / Cr Payable (gross).
 * Unrecoverable input VAT is part of the cost, so it is added to the expense line.
 */
export function buildInvoiceJournalLines(facts: InvoiceFacts, docType: InvoiceDocType, accounts: PostingAccounts) {
  const f = withAedAmounts(facts);
  const taxable = f.taxableMinor ?? 0;
  const vat = f.vatMinor ?? 0;
  const origSub = f.originalSubtotalMinor ?? null;
  const origVat = f.originalVatMinor ?? 0;
  const origTotal = origSub === null ? null : origSub + origVat;
  const memo = invoiceMemo(docType, f);
  const lines: InvoicePostingLine[] = [];
  let vatRecoverable = false;

  if (docType === "SALES_INVOICE") {
    lines.push(line(accounts.ar, "debit", taxable + vat, origTotal, f, memo));
    lines.push(line(accounts.revenue, "credit", taxable, origSub, f, memo));
    if (vat > 0) lines.push(line(accounts.vatOut, "credit", vat, origVat, f, memo, "1b"));
  } else {
    vatRecoverable = vat > 0 && inputVatRecoverable(f);
    if (vatRecoverable) {
      lines.push(line(accounts.expense, "debit", taxable, origSub, f, memo));
      lines.push(line(accounts.vatIn, "debit", vat, origVat, f, memo, "9"));
    } else {
      lines.push(line(accounts.expense, "debit", taxable + vat, origTotal, f, memo));
    }
    lines.push(line(accounts.ap, "credit", taxable + vat, origTotal, f, memo));
  }
  const kept = lines.filter((l) => (l.debitMinor ?? 0) > 0 || (l.creditMinor ?? 0) > 0);
  return { facts: f, lines: kept, memo, vatRecoverable, totalAed: taxable + vat };
}
