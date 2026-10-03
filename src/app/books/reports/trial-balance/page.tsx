"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState } from "react";

import { useBooksShell } from "@/components/books/books-shell-context";
import { formatMinor } from "@/lib/money";

type TbAccount = {
  id: string;
  code: string;
  name: string;
  accountType: string;
  openingDebitMinor: number;
  openingCreditMinor: number;
  periodDebitMinor: number;
  periodCreditMinor: number;
  closingDebitMinor: number;
  closingCreditMinor: number;
};

type TbGroup = {
  key: string;
  label: string;
  accounts: TbAccount[];
  subtotalClosingDebitMinor: number;
  subtotalClosingCreditMinor: number;
};

type TbResponse = {
  periodLabel: string;
  groups: TbGroup[];
  totalClosingDebit: number;
  totalClosingCredit: number;
  balanced: boolean;
};

export default function TrialBalancePage() {
  const { periods, periodId, setPeriodId } = useBooksShell();
  const router = useRouter();
  const [data, setData] = useState<TbResponse | null>(null);
  const [showMovements, setShowMovements] = useState(false);
  const [hideZero, setHideZero] = useState(true);
  const [error, setError] = useState("");
  const [clientName, setClientName] = useState("");

  async function loadTb(pid: string, zerosHidden: boolean) {
    if (!pid) return;
    setError("");
    const qs = new URLSearchParams({ periodId: pid });
    if (!zerosHidden) qs.set("includeZero", "1");
    const res = await fetch(`/api/books/trial-balance?${qs}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "tb_failed");
      setData(null);
      return;
    }
    setData(json as TbResponse);
  }

  useEffect(() => {
    fetch("/api/books/company")
      .then((r) => r.json())
      .then((p) => {
        if (p?.name) setClientName(String(p.name));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (periodId) void loadTb(periodId, hideZero);
  }, [periodId, hideZero]);

  function amountCell(debit: number, credit: number) {
    if (debit > 0) return formatMinor(debit);
    if (credit > 0) return formatMinor(credit);
    return formatMinor(0);
  }

  return (
    <div className="space-y-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trial balance</h1>
          <p className="text-sm text-muted-foreground">
            Net closing balances from posted journal lines
            {data?.periodLabel ? ` · ${data.periodLabel}` : ""}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showMovements}
              onChange={(e) => setShowMovements(e.target.checked)}
            />
            Show movements
          </label>
          <label className="flex items-center gap-2 text-sm" data-testid="tb-hide-zero">
            <input
              type="checkbox"
              checked={hideZero}
              onChange={(e) => setHideZero(e.target.checked)}
            />
            Hide zero balances
          </label>
          <label className="text-xs text-muted-foreground">
            Period
            <select
              className="ml-2 rounded-md border border-border bg-card px-2 py-1 text-sm"
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-sm border-b border-border pb-2">
        <span className="rounded-md bg-primary px-3 py-1 text-primary-foreground">Trial balance</span>
        <span
          className="rounded-md px-3 py-1 text-muted-foreground opacity-60 cursor-not-allowed"
          title="Available in Phase 6"
        >
          Profit &amp; loss
        </span>
        <span
          className="rounded-md px-3 py-1 text-muted-foreground opacity-60 cursor-not-allowed"
          title="Available in Phase 6"
        >
          Balance sheet
        </span>
        <span
          className="rounded-md px-3 py-1 text-muted-foreground opacity-60 cursor-not-allowed"
          title="Available in Phase 6"
        >
          Cash flow
        </span>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="rounded-lg border border-border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted/95">
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Account</th>
              {showMovements ? (
                <>
                  <th className="px-3 py-2 text-right font-medium">Opening Dr</th>
                  <th className="px-3 py-2 text-right font-medium">Opening Cr</th>
                  <th className="px-3 py-2 text-right font-medium">Debits</th>
                  <th className="px-3 py-2 text-right font-medium">Credits</th>
                </>
              ) : null}
              <th className="px-3 py-2 text-right font-medium">Closing Dr</th>
              <th className="px-3 py-2 text-right font-medium">Closing Cr</th>
            </tr>
          </thead>
          <tbody>
            {data?.groups.map((group) => (
              <Fragment key={group.key}>
                <tr className="bg-muted/30">
                  <td
                    colSpan={showMovements ? 8 : 4}
                    className="px-3 py-2 text-xs font-semibold uppercase tracking-wide"
                  >
                    {group.label}
                  </td>
                </tr>
                {group.accounts.map((a) => (
                  <tr
                    key={a.code}
                    className="border-b border-border/60 hover:bg-muted/20 cursor-pointer"
                    title={
                      a.code === "2210" && clientName.includes("Desert Falcon")
                        ? "VAT output movements. Use Show movements for Dr/Cr sides."
                        : undefined
                    }
                    data-testid={a.code === "2210" ? "tb-vat-note" : undefined}
                    onClick={() =>
                      router.push(
                        `/books/reports/account-ledger?periodId=${periodId}&accountId=${a.id}`,
                      )
                    }
                  >
                    <td className="px-3 py-2 font-mono text-xs">{a.code}</td>
                    <td className="px-3 py-2">{a.name}</td>
                    {showMovements ? (
                      <>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {a.openingDebitMinor ? formatMinor(a.openingDebitMinor) : formatMinor(0)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {a.openingCreditMinor ? formatMinor(a.openingCreditMinor) : formatMinor(0)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {a.periodDebitMinor ? formatMinor(a.periodDebitMinor) : formatMinor(0)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {a.periodCreditMinor ? formatMinor(a.periodCreditMinor) : formatMinor(0)}
                        </td>
                      </>
                    ) : null}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {amountCell(a.closingDebitMinor, 0)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {amountCell(0, a.closingCreditMinor)}
                    </td>
                  </tr>
                ))}
                <tr className="border-b border-border bg-muted/10 text-xs font-medium">
                  <td className="px-3 py-2" colSpan={2}>
                    Subtotal
                  </td>
                  {showMovements ? <td colSpan={4} /> : null}
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMinor(group.subtotalClosingDebitMinor)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMinor(group.subtotalClosingCreditMinor)}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
          {data ? (
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="px-3 py-3" colSpan={2}>
                  Totals {data.balanced ? "" : "(unbalanced)"}
                </td>
                {showMovements ? <td colSpan={4} /> : null}
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatMinor(data.totalClosingDebit)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatMinor(data.totalClosingCredit)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
