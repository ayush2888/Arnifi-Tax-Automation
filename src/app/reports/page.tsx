"use client";

import { useEffect, useState } from "react";

import { DEMO_PERIOD_ID } from "@/config/product";
import { Button } from "@/components/ui/button";

type Financials = {
  period: { label: string; status: string };
  pnl: { incomeMinor: number; expenseMinor: number; netIncomeMinor: number; lines: { code: string; name: string; amountMinor: number; accountType: string }[] };
  balanceSheet: {
    assets: { code: string; name: string; amountMinor: number }[];
    liabilities: { code: string; name: string; amountMinor: number }[];
    equity: { code: string; name: string; amountMinor: number }[];
    totalAssetsMinor: number;
    totalLiabilitiesMinor: number;
    totalEquityMinor: number;
  };
  cashFlow: { netIncomeMinor: number; netCashMinor: number; openingCashMinor: number; closingCashMinor: number; note: string };
  retainedEarnings: {
    openingMinor: number;
    netIncomeMinor: number;
    dividendsMinor: number;
    closingMinor: number;
    yearEndClosed: boolean;
  };
  integrity: {
    tbBalanced: boolean;
    accountingEquation: boolean;
    reRollForward: boolean;
    ready: boolean;
  };
};

type Pack = { id: string; version: number; status: string; kind: string };

function fils(n: number) {
  return (n / 100).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ReportsPage() {
  const [data, setData] = useState<Financials | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function load() {
    setError("");
    Promise.all([
      fetch(`/api/periods/${DEMO_PERIOD_ID}/financials`).then(async (r) => {
        if (!r.ok) throw new Error("financials");
        return r.json();
      }),
      fetch(`/api/release-packs?periodId=${DEMO_PERIOD_ID}`).then((r) => r.json()),
    ])
      .then(([financials, packList]) => {
        setData(financials);
        setPacks(packList.filter((p: Pack) => p.kind === "STATEMENTS"));
      })
      .catch(() => setError("Could not load financial statements. Apply db/10-statements.sql if needed."));
  }

  useEffect(() => {
    load();
  }, []);

  async function yearEnd() {
    setError("");
    setMessage("");
    const response = await fetch(`/api/periods/${DEMO_PERIOD_ID}/year-end-close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: "Demo YE close" }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.message || payload.error || "Year-end close failed.");
      return;
    }
    setMessage(`P&L closed to RE. NI ${fils(payload.netIncomeMinor)}.`);
    load();
  }

  async function prepare() {
    setError("");
    setMessage("");
    const response = await fetch(`/api/periods/${DEMO_PERIOD_ID}/statements-prepare`, { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.message || payload.error || "Prepare blocked — integrity gates failed.");
      return;
    }
    setMessage(`Prepared STATEMENTS v${payload.version}. Switch to Layla to approve.`);
    load();
  }

  async function approve(packId: string) {
    setError("");
    const response = await fetch(`/api/release-packs/${packId}/approve-statements`, { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.message || payload.error || "Approve failed.");
      return;
    }
    setMessage("Statements pack RELEASED.");
    load();
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-heading text-3xl tracking-tight">Reports</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          P&L, balance sheet, and demo cash flow from the ledger. Integrity gates (TB, A=L+E, RE roll-forward) must pass
          before a STATEMENTS pack can be prepared.
        </p>
      </header>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={load}>
          Refresh
        </Button>
        <Button variant="outline" onClick={yearEnd} disabled={data?.retainedEarnings.yearEndClosed}>
          Year-end close to RE
        </Button>
        <Button onClick={prepare} disabled={!data?.integrity.ready}>
          Prepare STATEMENTS pack
        </Button>
      </div>

      {data ? (
        <>
          <section className="space-y-2">
            <h2 className="font-heading text-xl">
              {data.period.label} · {data.period.status}
            </h2>
            <ul className="text-sm">
              <li className={data.integrity.tbBalanced ? "" : "text-danger"}>
                {data.integrity.tbBalanced ? "✓" : "✗"} TB balanced
              </li>
              <li className={data.integrity.accountingEquation ? "" : "text-danger"}>
                {data.integrity.accountingEquation ? "✓" : "✗"} A = L + E
              </li>
              <li className={data.integrity.reRollForward ? "" : "text-danger"}>
                {data.integrity.reRollForward ? "✓" : "✗"} RE roll-forward
              </li>
            </ul>
          </section>

          <section className="space-y-2 border-t border-border pt-4">
            <h2 className="font-heading text-xl">Profit &amp; loss</h2>
            <ul className="max-w-xl text-sm">
              {data.pnl.lines.map((line) => (
                <li key={`${line.code}-${line.name}`} className="flex justify-between gap-4 py-1">
                  <span>
                    {line.code} · {line.name}
                  </span>
                  <span>{fils(line.amountMinor)}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm font-medium">Net income {fils(data.pnl.netIncomeMinor)}</p>
          </section>

          <section className="space-y-2 border-t border-border pt-4">
            <h2 className="font-heading text-xl">Balance sheet</h2>
            <div className="grid max-w-3xl gap-4 md:grid-cols-3 text-sm">
              <div>
                <h3 className="font-medium">Assets {fils(data.balanceSheet.totalAssetsMinor)}</h3>
                {data.balanceSheet.assets.map((line) => (
                  <p key={line.code} className="flex justify-between gap-2">
                    <span>{line.code}</span>
                    <span>{fils(line.amountMinor)}</span>
                  </p>
                ))}
              </div>
              <div>
                <h3 className="font-medium">Liabilities {fils(data.balanceSheet.totalLiabilitiesMinor)}</h3>
                {data.balanceSheet.liabilities.map((line) => (
                  <p key={line.code} className="flex justify-between gap-2">
                    <span>{line.code}</span>
                    <span>{fils(line.amountMinor)}</span>
                  </p>
                ))}
              </div>
              <div>
                <h3 className="font-medium">Equity {fils(data.balanceSheet.totalEquityMinor)}</h3>
                {data.balanceSheet.equity.map((line) => (
                  <p key={line.code} className="flex justify-between gap-2">
                    <span>{line.code}</span>
                    <span>{fils(line.amountMinor)}</span>
                  </p>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-2 border-t border-border pt-4 text-sm">
            <h2 className="font-heading text-xl">Cash flow (demo)</h2>
            <p>Opening cash {fils(data.cashFlow.openingCashMinor)}</p>
            <p>Net cash movement {fils(data.cashFlow.netCashMinor)}</p>
            <p>Closing cash {fils(data.cashFlow.closingCashMinor)}</p>
            <p className="text-muted-foreground">{data.cashFlow.note}</p>
          </section>

          <section className="space-y-2 border-t border-border pt-4 text-sm">
            <h2 className="font-heading text-xl">Retained earnings</h2>
            <p>Opening {fils(data.retainedEarnings.openingMinor)}</p>
            <p>+ NI {fils(data.retainedEarnings.netIncomeMinor)}</p>
            <p>− Dividends {fils(data.retainedEarnings.dividendsMinor)}</p>
            <p className="font-medium">Closing {fils(data.retainedEarnings.closingMinor)}</p>
            <p className="text-muted-foreground">
              {data.retainedEarnings.yearEndClosed ? "Year-end close posted." : "Year-end not yet closed."}
            </p>
          </section>

          <section className="space-y-2 border-t border-border pt-4">
            <h2 className="font-heading text-xl">STATEMENTS packs</h2>
            <ul className="divide-y divide-border border border-border text-sm">
              {packs.length === 0 ? (
                <li className="px-3 py-2 text-muted-foreground">No STATEMENTS packs yet.</li>
              ) : (
                packs.map((pack) => (
                  <li key={pack.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span>
                      v{pack.version} · {pack.status}
                    </span>
                    {pack.status === "PENDING_APPROVAL" ? (
                      <Button size="sm" variant="outline" onClick={() => approve(pack.id)}>
                        Approve &amp; release
                      </Button>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          </section>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </div>
  );
}
