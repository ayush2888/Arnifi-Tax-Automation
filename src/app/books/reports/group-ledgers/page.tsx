"use client";

import { useEffect, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { formatMinor } from "@/lib/money";

type GroupResponse = {
  asOf: string;
  ledgers: { kind: string; label: string }[];
  companies: { clientId: string; clientName: string; balances: Record<string, number> }[];
  totals: Record<string, number>;
};

const today = () => new Date().toISOString().slice(0, 10);

export default function GroupLedgersPage() {
  const [asOf, setAsOf] = useState(today);
  const [data, setData] = useState<GroupResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/books/group-ledgers?asOf=${asOf}`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(String(json.error || "request_failed").replaceAll("_", " "));
          setData(null);
          return;
        }
        setData(json as GroupResponse);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        setError("Could not load the group overview. Check your connection and try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [asOf]);

  return (
    <div className="space-y-5 pb-10">
      <PageHeader
        title="Group overview"
        description="Receivables, payables, loans, advances and capital across every company you can access."
        actions={
          <label className="text-xs text-muted-foreground">
            As of
            <input
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="ml-2 rounded-md border border-border bg-card px-2 py-1 text-sm"
              data-testid="group-as-of"
            />
          </label>
        }
      />

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[760px] text-sm" data-testid="group-table">
          <thead className="bg-muted/95">
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">Company</th>
              {(data?.ledgers || []).map((l) => (
                <th key={l.kind} scope="col" className="px-3 py-2 text-right font-medium">
                  {l.label.replace(" ledger", "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.companies.map((c) => (
              <tr key={c.clientId} className="border-b border-border/60" data-testid="group-row">
                <td className="px-3 py-2 font-medium">{c.clientName}</td>
                {data.ledgers.map((l) => (
                  <td key={l.kind} className="px-3 py-2 text-right tabular-nums">
                    {c.balances[l.kind] ? formatMinor(c.balances[l.kind]) : "—"}
                  </td>
                ))}
              </tr>
            ))}
            {data && data.companies.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No companies to show.
                </td>
              </tr>
            ) : null}
            {!data && loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  Loading group overview…
                </td>
              </tr>
            ) : null}
          </tbody>
          {data && data.companies.length ? (
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="px-3 py-3">Group total</td>
                {data.ledgers.map((l) => (
                  <td key={l.kind} className="px-3 py-3 text-right tabular-nums" data-testid={`group-total-${l.kind}`}>
                    {formatMinor(data.totals[l.kind] || 0)}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Balances are posted journals up to the chosen date, each on its ledger&apos;s normal side. Amounts
        are summed in each company&apos;s own currency, so use this as an overview for single-currency
        groups.
      </p>
    </div>
  );
}
