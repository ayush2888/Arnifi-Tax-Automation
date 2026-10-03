import { vatAmountForBase } from "@/lib/vat";

export { vatAmountForBase };

export type BooksLineDraft = {
  accountId: string;
  debitMinor?: number;
  creditMinor?: number;
  currency?: string;
  originalMinor?: number | null;
  fxRateScaled?: number | null;
  aedMinor?: number | null;
  lineMemo?: string;
  vatTreatment?: string | null;
  vatCode?: string | null;
  vatAmountMinor?: number;
  isVatCompanion?: boolean;
  tags?: string[];
};

export const VAT_INPUT_CODE = "1430";
export const VAT_OUTPUT_CODE = "2210";

export type AccountMeta = {
  id: string;
  code: string;
  accountType: string;
};

/** Adds companion VAT control lines for SR on expense (1430 Dr) and revenue (2210 Cr). */
export function expandVatCompanionLines(
  lines: BooksLineDraft[],
  accountById: Map<string, AccountMeta>,
  vatAccountByCode: Map<string, string>,
): BooksLineDraft[] {
  const out: BooksLineDraft[] = [];
  const alreadyHasVatLine = (vatAcctId: string) => lines.some((l) => l.accountId === vatAcctId);

  for (const line of lines) {
    if (line.isVatCompanion) {
      out.push(line);
      continue;
    }
    const vatCode = line.vatCode ?? null;
    const baseMinor = line.debitMinor ?? line.creditMinor ?? 0;
    const vatAmt =
      line.vatAmountMinor != null && line.vatAmountMinor > 0
        ? line.vatAmountMinor
        : vatAmountForBase(baseMinor, vatCode);

    const withVat: BooksLineDraft = {
      ...line,
      vatCode: vatCode ?? null,
      vatAmountMinor: vatAmt,
    };
    out.push(withVat);

    if (vatCode !== "SR" && vatCode !== "RC") continue;
    if (vatAmt <= 0) continue;

    const acct = accountById.get(line.accountId);
    if (!acct) continue;

    if (acct.accountType === "expense" && (line.debitMinor ?? 0) > 0) {
      const vatAcctId = vatAccountByCode.get(VAT_INPUT_CODE);
      if (!vatAcctId || alreadyHasVatLine(vatAcctId)) continue;
      out.push({
        accountId: vatAcctId,
        debitMinor: vatAmt,
        creditMinor: 0,
        lineMemo: `VAT ${vatCode} on ${acct.code}`,
        vatCode: null,
        vatAmountMinor: 0,
        isVatCompanion: true,
        tags: line.tags,
      });
    } else if (acct.accountType === "income" && (line.creditMinor ?? 0) > 0) {
      const vatAcctId = vatAccountByCode.get(VAT_OUTPUT_CODE);
      if (!vatAcctId || alreadyHasVatLine(vatAcctId)) continue;
      out.push({
        accountId: vatAcctId,
        creditMinor: vatAmt,
        debitMinor: 0,
        lineMemo: `VAT ${vatCode} on ${acct.code}`,
        vatCode: null,
        vatAmountMinor: 0,
        isVatCompanion: true,
        tags: line.tags,
      });
    }
  }
  return out;
}
