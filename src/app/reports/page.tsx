"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { LedgerPeriodSelect, useLedgerPeriod } from "@/lib/use-ledger-period";
import { cn } from "@/lib/utils";

type Financials = {
  period: { label: string; status: string };
  pnl: {
    incomeMinor: number;
    expenseMinor: number;
    netIncomeMinor: number;
    lines: { code: string; name: string; amountMinor: number; accountType: string }[];
  };
  balanceSheet: {
    assets: { code: string; name: string; amountMinor: number }[];
    liabilities: { code: string; name: string; amountMinor: number }[];
    equity: { code: string; name: string; amountMinor: number }[];
    totalAssetsMinor: number;
    totalLiabilitiesMinor: number;
    totalEquityMinor: number;
  };
  cashFlow: {
    netIncomeMinor: number;
    netCashMinor: number;
    openingCashMinor: number;
    closingCashMinor: number;
    note: string;
  };
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

type TrialBalance = {
  accounts: {
    accountId: string;
    code: string;
    name: string;
    accountType: string;
    debitMinor: string | number;
    creditMinor: string | number;
  }[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
};

type JournalRow = {
  id: string;
  memo: string;
  entryDate: string;
  status: string;
  debitMinor?: string | number;
  creditMinor?: string | number;
};

type Pack = { id: string; version: number; status: string; kind: string };

type TabId = "pnl" | "bs" | "tb" | "daybook" | "cash";

const TABS: { id: TabId; label: string }[] = [
  { id: "pnl", label: "Profit & loss" },
  { id: "bs", label: "Balance sheet" },
  { id: "tb", label: "Trial balance" },
  { id: "daybook", label: "Day book" },
  { id: "cash", label: "Cash flow" },
];

function fils(n: number) {
  return (n / 100).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ReportsInner() {
  const router = useRouter();
  const search = useSearchParams();
  const tabParam = (search.get("tab") || "pnl") as TabId;
  const tab: TabId = TABS.some((t) => t.id === tabParam) ? tabParam : "pnl";

  const { periods, periodId, setPeriodId } = useLedgerPeriod();
  const [data, setData] = useState<Financials | null>(null);
  const [tb, setTb] = useState<TrialBalance | null>(null);
  const [journals, setJournals] = useState<JournalRow[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function setTab(next: TabId) {
    const params = new URLSearchParams(search.toString());
    params.set("tab", next);
    router.replace(`/reports?${params.toString()}`);
  }

  function load() {
    if (!periodId) return;
    setError("");
    Promise.all([
      fetch(`/api/periods/${periodId}/financials`).then(async (r) => {
        if (!r.ok) throw new Error("financials");
        return r.json();
      }),
      fetch(`/api/release-packs?periodId=${periodId}`).then((r) => r.json()),
      fetch(`/api/trial-balance?periodId=${periodId}`).then((r) => r.json()),
      fetch(`/api/journals?periodId=${periodId}`).then((r) => r.json()),
    ])
      .then(([financials, packList, trial, journalList]) => {
        setData(financials);
        setPacks((Array.isArray(packList) ? packList : []).filter((p: Pack) => p.kind === "STATEMENTS"));
        setTb(trial && Array.isArray(trial.accounts) ? trial : null);
        setJournals(Array.isArray(journalList) ? journalList : []);
      })
      .catch(() => setError("Could not load reports. Check the database is running and SQL migrations are applied."));
  }

  useEffect(() => {
    if (!periodId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodId]);

  const postedJournals = useMemo(
    () => journals.filter((j) => j.status === "posted").sort((a, b) => a.entryDate.localeCompare(b.entryDate)),
    [journals],
  );

  async function yearEnd() {
    setError("");
    setMessage("");
    const response = await fetch(`/api/periods/${periodId}/year-end-close`, {
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
    const response = await fetch(`/api/periods/${periodId}/statements-prepare`, { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.message || payload.error || "Prepare blocked — integrity gates failed.");
      return;
    }
    setMessage(`Prepared STATEMENTS v${payload.version}. Switch Role to Approver in the sidebar to approve.`);
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
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Reports"
        description="Built only from posted journals. Switch tabs to see P&L, balance sheet, trial balance, and day book."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <LedgerPeriodSelect periods={periods} periodId={periodId} onChange={setPeriodId} />
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        }
      />

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-red-50 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

      <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1 shadow-sm">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-medium transition",
              tab === item.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {data ? (
        <p className="text-sm text-muted-foreground">
          Posted journals · AED · {data.period.label} ({data.period.status})
          {data.integrity.tbBalanced ? " · TB ✓" : " · TB needs check"}
          {data.integrity.accountingEquation ? " · A=L+E ✓" : " · A≠L+E"}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {tab === "pnl" && data ? (
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-heading text-lg font-semibold">Profit &amp; loss</h2>
          <ul className="mt-3 divide-y divide-border text-sm">
            {data.pnl.lines.map((line) => (
              <li key={`${line.code}-${line.name}`} className="flex justify-between gap-4 py-2">
                <span>
                  {line.code} · {line.name}
                </span>
                <span className="tabular-nums">{fils(line.amountMinor)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm font-semibold">Net income {fils(data.pnl.netIncomeMinor)} AED</p>
        </section>
      ) : null}

      {tab === "bs" && data ? (
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-heading text-lg font-semibold">Balance sheet</h2>
          <div className="mt-4 grid gap-6 md:grid-cols-3 text-sm">
            <BsColumn title="Assets" total={data.balanceSheet.totalAssetsMinor} rows={data.balanceSheet.assets} />
            <BsColumn
              title="Liabilities"
              total={data.balanceSheet.totalLiabilitiesMinor}
              rows={data.balanceSheet.liabilities}
            />
            <BsColumn title="Equity" total={data.balanceSheet.totalEquityMinor} rows={data.balanceSheet.equity} />
          </div>
        </section>
      ) : null}

      {tab === "tb" ? (
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-heading text-lg font-semibold">Trial balance</h2>
            <p className="text-sm text-muted-foreground">
              Net closing balances from posted journal lines
              {tb ? ` · ${tb.balanced ? "Balanced" : "Not balanced"}` : ""}
            </p>
          </div>
          {!tb ? (
            <p className="px-5 py-8 text-sm text-muted-foreground">No trial balance yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-medium">Account</th>
                    <th className="px-3 py-3 text-right font-medium">Closing Dr</th>
                    <th className="px-5 py-3 text-right font-medium">Closing Cr</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tb.accounts.map((row) => (
                    <tr key={row.accountId} className="hover:bg-muted/30">
                      <td className="px-5 py-2.5">
                        {row.code} · {row.name}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {Number(row.debitMinor) ? fils(Number(row.debitMinor)) : ""}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums">
                        {Number(row.creditMinor) ? fils(Number(row.creditMinor)) : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border bg-muted/30 font-semibold">
                  <tr>
                    <td className="px-5 py-3">Total</td>
                    <td className="px-3 py-3 text-right tabular-nums">{fils(tb.totalDebit)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{fils(tb.totalCredit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {tab === "daybook" ? (
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="font-heading text-lg font-semibold">Day book</h2>
              <p className="text-sm text-muted-foreground">
                Every posted voucher in date order. Expand from Journals for line detail.
              </p>
            </div>
            <Link href="/journals" className="text-sm font-medium text-primary hover:underline">
              Open journals →
            </Link>
          </div>
          {postedJournals.length === 0 ? (
            <p className="px-5 py-8 text-sm text-muted-foreground">No posted vouchers in this period.</p>
          ) : (
            <ul className="divide-y divide-border">
              {postedJournals.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-sm">
                  <div>
                    <p className="font-medium text-foreground">{j.memo || "(no memo)"}</p>
                    <p className="text-xs text-muted-foreground">
                      {j.entryDate} · {j.id.slice(0, 8)}
                    </p>
                  </div>
                  <p className="tabular-nums font-medium">
                    {fils(Number(j.debitMinor || j.creditMinor || 0))} AED
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "cash" && data ? (
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm text-sm">
          <h2 className="font-heading text-lg font-semibold">Cash flow (demo layout)</h2>
          <p>Opening cash {fils(data.cashFlow.openingCashMinor)}</p>
          <p>Net cash movement {fils(data.cashFlow.netCashMinor)}</p>
          <p>Closing cash {fils(data.cashFlow.closingCashMinor)}</p>
          <p className="text-muted-foreground">{data.cashFlow.note}</p>
          <div className="border-t border-border pt-4">
            <h3 className="font-medium">Retained earnings</h3>
            <p>Opening {fils(data.retainedEarnings.openingMinor)}</p>
            <p>+ NI {fils(data.retainedEarnings.netIncomeMinor)}</p>
            <p>− Dividends {fils(data.retainedEarnings.dividendsMinor)}</p>
            <p className="font-medium">Closing {fils(data.retainedEarnings.closingMinor)}</p>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button variant="outline" onClick={yearEnd} disabled={data.retainedEarnings.yearEndClosed}>
              Year-end close to RE
            </Button>
            <Button onClick={prepare} disabled={!data.integrity.ready}>
              Prepare STATEMENTS pack
            </Button>
          </div>
          <ul className="divide-y divide-border border border-border rounded-lg">
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
      ) : null}
    </div>
  );
}

function BsColumn({
  title,
  total,
  rows,
}: {
  title: string;
  total: number;
  rows: { code: string; name: string; amountMinor: number }[];
}) {
  return (
    <div>
      <h3 className="font-medium">
        {title} {fils(total)}
      </h3>
      <ul className="mt-2 space-y-1">
        {rows.map((line) => (
          <li key={line.code} className="flex justify-between gap-2">
            <span>
              {line.code} · {line.name}
            </span>
            <span className="tabular-nums">{fils(line.amountMinor)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading reports…</p>}>
      <ReportsInner />
    </Suspense>
  );
}
