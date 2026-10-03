import { withUser } from "@/lib/db";
import { BooksError } from "@/server/books/errors";
import { assertSyntheticTenant } from "@/server/security-gate";

/** Period balances for 2210 / 1430 used by the VAT settlement template. */
export async function booksVatSettlementPreview(
  userId: string,
  clientId: string,
  periodId: string,
) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const period = await db.query(
      `SELECT id, label, period_end FROM books_periods WHERE id = $1 AND client_id = $2`,
      [periodId, clientId],
    );
    if (!period.rowCount) throw new BooksError("period_not_found", "not_found");
    const periodEnd = String(period.rows[0].period_end);

    const accounts = await db.query(
      `SELECT id, code, name FROM books_accounts
       WHERE client_id = $1 AND code IN ('1430','1440','2210','2220','1120','1110')
       ORDER BY code`,
      [clientId],
    );
    const byCode = new Map(accounts.rows.map((r) => [String(r.code), r]));

    const bal = async (code: string) => {
      const acc = byCode.get(code);
      if (!acc) return { accountId: null as string | null, debitMinor: 0, creditMinor: 0, netMinor: 0 };
      const rows = await db.query(
        `SELECT COALESCE(SUM(l.debit_minor),0)::bigint AS dr,
                COALESCE(SUM(l.credit_minor),0)::bigint AS cr
         FROM books_journal_lines l
         JOIN books_journal_entries e ON e.id = l.entry_id
         WHERE e.client_id = $1 AND e.status IN ('posted','reversed')
           AND e.deleted_at IS NULL
           AND e.entry_date <= $2::date
           AND l.account_id = $3`,
        [clientId, periodEnd, acc.id],
      );
      const debitMinor = Number(rows.rows[0].dr);
      const creditMinor = Number(rows.rows[0].cr);
      return {
        accountId: String(acc.id),
        code,
        name: String(acc.name),
        debitMinor,
        creditMinor,
        netMinor: debitMinor - creditMinor,
      };
    };

    const output = await bal("2210"); // liability: credit balance → netMinor negative
    const input = await bal("1430"); // asset: debit balance → netMinor positive
    const outNet = Math.max(0, -output.netMinor); // credit balance of output
    const inNet = Math.max(0, input.netMinor);
    const payable = outNet - inNet;

    const bank = byCode.get("1120") || byCode.get("1110");
    const vatPayable = byCode.get("2220");
    const vatReceivable = byCode.get("1440");

    const returnLines: Array<{
      accountId: string;
      debitMinor: number;
      creditMinor: number;
      lineMemo: string;
    }> = [];
    if (outNet > 0 && output.accountId) {
      returnLines.push({
        accountId: output.accountId,
        debitMinor: outNet,
        creditMinor: 0,
        lineMemo: "Clear VAT output",
      });
    }
    if (inNet > 0 && input.accountId) {
      returnLines.push({
        accountId: input.accountId,
        debitMinor: 0,
        creditMinor: inNet,
        lineMemo: "Clear VAT input",
      });
    }
    if (payable > 0 && vatPayable) {
      returnLines.push({
        accountId: String(vatPayable.id),
        debitMinor: 0,
        creditMinor: payable,
        lineMemo: "VAT payable",
      });
    } else if (payable < 0 && vatReceivable) {
      returnLines.push({
        accountId: String(vatReceivable.id),
        debitMinor: -payable,
        creditMinor: 0,
        lineMemo: "VAT receivable",
      });
    }

    const paymentLines: Array<{
      accountId: string;
      debitMinor: number;
      creditMinor: number;
      lineMemo: string;
    }> = [];
    if (payable > 0 && vatPayable && bank) {
      paymentLines.push({
        accountId: String(vatPayable.id),
        debitMinor: payable,
        creditMinor: 0,
        lineMemo: "Settle VAT payable",
      });
      paymentLines.push({
        accountId: String(bank.id),
        debitMinor: 0,
        creditMinor: payable,
        lineMemo: "Bank payment to FTA",
      });
    }

    return {
      periodId,
      periodLabel: String(period.rows[0].label),
      periodEnd,
      outputVat: output,
      inputVat: input,
      outputNetMinor: outNet,
      inputNetMinor: inNet,
      payableMinor: payable,
      returnEntry: {
        memo: `VAT return ${period.rows[0].label}`,
        voucherType: "Journal",
        lines: returnLines,
      },
      paymentEntry:
        payable > 0
          ? {
              memo: `VAT payment ${period.rows[0].label}`,
              voucherType: "Payment",
              lines: paymentLines,
            }
          : null,
    };
  });
}
