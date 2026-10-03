"use client";

import { useEffect, useState } from "react";

import { DEMO_PERIOD_ID } from "@/config/product";
import { Button } from "@/components/ui/button";

type Draft = {
  period: { id: string; label: string; status: string };
  boxes: Record<string, { taxableMinor: number; vatMinor: number }>;
  totalOutputVat: number;
  totalInputVat: number;
  netPayable: number;
  status: string;
  note: string;
};

function fils(n: number) {
  return (n / 100).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Vat201Page() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");

  function load() {
    setError("");
    fetch(`/api/periods/${DEMO_PERIOD_ID}/vat201-draft`)
      .then(async (r) => {
        if (!r.ok) throw new Error("failed");
        return r.json();
      })
      .then(setDraft)
      .catch(() => setError("Could not load VAT201 draft. Ensure the demo period exists."));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-heading text-3xl tracking-tight">VAT201 draft</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Read-only draft from posted ledger lines for the demo period. Dual-control release and client download are Stage B.
        </p>
      </header>
      <Button variant="outline" size="sm" onClick={load}>
        Refresh
      </Button>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!draft && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {draft ? (
        <div className="space-y-4">
          <p className="text-sm">
            {draft.period.label} · {draft.status} · period {draft.period.status}
          </p>
          <table className="w-full max-w-xl border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 pr-3">Box</th>
                <th className="py-2 pr-3">Taxable (AED)</th>
                <th className="py-2">VAT (AED)</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(draft.boxes).length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-3 text-muted-foreground">
                    No VAT-tagged postings yet. Approve sales/purchase fixtures in Inbox.
                  </td>
                </tr>
              ) : (
                Object.entries(draft.boxes).map(([box, amounts]) => (
                  <tr key={box} className="border-b border-border">
                    <td className="py-2 pr-3 font-medium">{box}</td>
                    <td className="py-2 pr-3">{fils(amounts.taxableMinor)}</td>
                    <td className="py-2">{fils(amounts.vatMinor)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <dl className="grid max-w-xl gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Total output VAT</dt>
              <dd>{fils(draft.totalOutputVat)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Total input VAT</dt>
              <dd>{fils(draft.totalInputVat)}</dd>
            </div>
            <div className="flex justify-between gap-4 font-medium">
              <dt>Net payable</dt>
              <dd>{fils(draft.netPayable)}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">{draft.note}</p>
        </div>
      ) : null}
    </div>
  );
}
