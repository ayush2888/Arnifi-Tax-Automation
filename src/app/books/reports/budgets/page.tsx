"use client";

import { useCallback, useEffect, useState } from "react";

import { useBooksShell } from "@/components/books/books-shell-context";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { displayToMinor, formatMinor } from "@/lib/money";
import { cn } from "@/lib/utils";

type Row = {
  accountId: string;
  code: string;
  name: string;
  accountType: "income" | "expense";
  budgetMinor: number;
  actualMinor: number;
  varianceMinor: number;
  usedPct: number | null;
};

type Response = {
  periodLabel: string;
  rows: Row[];
  totals: {
    incomeBudgetMinor: number;
    incomeActualMinor: number;
    expenseBudgetMinor: number;
    expenseActualMinor: number;
    netBudgetMinor: number;
    netActualMinor: number;
  };
};

export default function BudgetsPage() {
  const { periods, periodId, setPeriodId } = useBooksShell();
  const [data, setData] = useState<Response | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!periodId) return;
    const controller = new AbortController();
    setEdits({});
    fetch(`/api/books/budgets?periodId=${periodId}`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(String(json.error || "request_failed").replaceAll("_", " "));
          setData(null);
          return;
        }
        setError("");
        setData(json as Response);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name !== "AbortError") setError("Could not load budgets.");
      });
    return () => controller.abort();
  }, [periodId, tick]);

  const save = useCallback(async () => {
    const lines: { accountId: string; amountMinor: number }[] = [];
    try {
      for (const [accountId, text] of Object.entries(edits)) {
        const minor = displayToMinor(text) ?? 0;
        if (minor < 0) throw new Error("negative");
        lines.push({ accountId, amountMinor: minor });
      }
    } catch {
      setError("Enter budget amounts as positive numbers with up to 2 decimals.");
      return;
    }
    if (!lines.length) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/books/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodId, lines }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error === "forbidden" ? "Your role cannot edit budgets." : String(json.error || "save failed").replaceAll("_", " "));
        return;
      }
      setTick((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }, [edits, periodId]);

  const dirty = Object.keys(edits).length;

  return (
    <div className="space-y-5 pb-10">
      <PageHeader
        title="Budget vs actual"
        description="Set a budget per income and expense account and compare it with posted journals for the period."
        actions={
          <>
            <label className="text-xs text-muted-foreground">
              Period
              <select
                className="ml-2 rounded-md border border-border bg-card px-2 py-1 text-sm"
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
                data-testid="budget-period"
              >
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <Button size="sm" onClick={save} disabled={!dirty || saving} data-testid="budget-save">
              {saving ? "Saving…" : dirty ? `Save ${dirty} change${dirty === 1 ? "" : "s"}` : "Save"}
            </Button>
          </>
        }
      />
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[760px] text-sm" data-testid="budget-table">
          <thead className="bg-muted/95">
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">Account</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Budget</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Actual</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Variance</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Used</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.accountId} className="border-b border-border/60" data-testid="budget-row">
                <td className="px-3 py-2">
                  <span className="tabular-nums text-muted-foreground">{r.code}</span> {r.name}
                  <span className="ml-2 text-xs text-muted-foreground">{r.accountType}</span>
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    aria-label={`Budget for ${r.code} ${r.name}`}
                    inputMode="decimal"
                    className="w-32 rounded-md border border-border bg-background px-2 py-1 text-right tabular-nums"
                    value={edits[r.accountId] ?? (r.budgetMinor ? formatMinor(r.budgetMinor) : "")}
                    placeholder="0.00"
                    onChange={(e) => setEdits((prev) => ({ ...prev, [r.accountId]: e.target.value }))}
                  />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMinor(r.actualMinor)}</td>
                <td
                  className={cn(
                    "px-3 py-2 text-right font-medium tabular-nums",
                    r.varianceMinor < 0 ? "text-red-700" : r.varianceMinor > 0 ? "text-green-700" : "",
                  )}
                >
                  {formatMinor(r.varianceMinor)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {r.usedPct == null ? "—" : `${r.usedPct}%`}
                </td>
              </tr>
            ))}
            {data && data.rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No income or expense accounts yet.
                </td>
              </tr>
            ) : null}
          </tbody>
          {data && data.rows.length ? (
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="px-3 py-3">Net (income less expense)</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatMinor(data.totals.netBudgetMinor)}</td>
                <td className="px-3 py-3 text-right tabular-nums" data-testid="budget-net-actual">
                  {formatMinor(data.totals.netActualMinor)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatMinor(data.totals.netActualMinor - data.totals.netBudgetMinor)}
                </td>
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Variance is positive when favourable: income above budget or expenses below budget.
      </p>
    </div>
  );
}
