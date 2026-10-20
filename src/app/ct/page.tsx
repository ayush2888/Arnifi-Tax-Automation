"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LedgerPeriodSelect, useLedgerPeriod } from "@/lib/use-ledger-period";

type CtReport = {
  periodLabel: string;
  accountingProfitMinor: number;
  ledgerNetIncomeMinor: number;
  reconciledToLedger: boolean;
  addBacksMinor: number;
  deductsMinor: number;
  taxableIncomeMinor: number;
  rateBps: number;
  ctPayableMinor: number;
  note: string;
  adjustments: { id: string; direction: string; amountMinor: number; reason: string }[];
};

type Pack = { id: string; version: number; status: string; kind: string };

function fils(n: number) {
  return (n / 100).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CtPage() {
  const { periods, periodId, setPeriodId } = useLedgerPeriod();
  const [report, setReport] = useState<CtReport | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [direction, setDirection] = useState<"ADD_BACK" | "DEDUCT">("ADD_BACK");
  const [amount, setAmount] = useState("5000");
  const [reason, setReason] = useState("Entertainment disallowed");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function load() {
    if (!periodId) return;
    setError("");
    Promise.all([
      fetch(`/api/periods/${periodId}/ct`).then(async (r) => {
        if (!r.ok) throw new Error("ct");
        return r.json();
      }),
      fetch(`/api/release-packs?periodId=${periodId}`).then((r) => r.json()),
    ])
      .then(([ct, packList]) => {
        setReport(ct);
        setPacks(packList.filter((p: Pack) => p.kind === "CT"));
      })
      .catch(() => setError("Could not load CT report. Apply db/11-ct.sql if needed."));
  }

  useEffect(() => {
    if (!periodId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodId]);

  async function addAdjustment() {
    setError("");
    const response = await fetch("/api/ct-adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        periodId: periodId,
        direction,
        amountMinor: Number(amount),
        reason,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.message || payload.error || "Add adjustment failed.");
      return;
    }
    load();
  }

  async function removeAdjustment(id: string) {
    await fetch(`/api/ct-adjustments/${id}`, { method: "DELETE" });
    load();
  }

  async function prepare() {
    setError("");
    setMessage("");
    const response = await fetch(`/api/periods/${periodId}/ct-prepare`, { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.message || payload.error || "Prepare failed.");
      return;
    }
    setMessage(`Prepared CT v${payload.version}. Switch Role to Approver in the sidebar before download.`);
    load();
  }

  async function approve(packId: string) {
    setError("");
    const response = await fetch(`/api/release-packs/${packId}/approve-ct`, { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.message || payload.error || "Approve failed.");
      return;
    }
    setMessage("CT pack RELEASED — download unlocked.");
    load();
  }

  async function download(packId: string, version: number) {
    setError("");
    const response = await fetch(`/api/release-packs/${packId}/download-ct`, { method: "POST" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.message || payload.error || "Download blocked until RELEASED.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ct-v${version}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Download logged. File CT outside arnibooks.");
    load();
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-heading text-3xl tracking-tight">Corporate tax</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Computation report from ledger accounting profit plus an adjustments trail. Approve before download — the
          product never submits to the FTA.
        </p>
        <LedgerPeriodSelect periods={periods} periodId={periodId} onChange={setPeriodId} />
      </header>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

      {report ? (
        <section className="space-y-2 text-sm">
          <h2 className="font-heading text-xl">{report.periodLabel}</h2>
          <p>
            Accounting profit {fils(report.accountingProfitMinor)} · ledger NI {fils(report.ledgerNetIncomeMinor)} ·{" "}
            <span className={report.reconciledToLedger ? "" : "text-danger"}>
              {report.reconciledToLedger ? "reconciled to ledger" : "NOT reconciled"}
            </span>
          </p>
          <p>+ Add-backs {fils(report.addBacksMinor)}</p>
          <p>− Deducts {fils(report.deductsMinor)}</p>
          <p>Taxable income {fils(report.taxableIncomeMinor)}</p>
          <p className="font-medium">
            CT payable {fils(report.ctPayableMinor)} @ {(report.rateBps / 100).toFixed(2)}%
          </p>
          <p className="text-xs text-muted-foreground">{report.note}</p>
        </section>
      ) : null}

      <section className="space-y-3 border-t border-border pt-4">
        <h2 className="font-heading text-xl">Adjustments trail</h2>
        <div className="grid max-w-2xl gap-2 md:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="dir">Direction</Label>
            <select
              id="dir"
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={direction}
              onChange={(e) => setDirection(e.target.value as "ADD_BACK" | "DEDUCT")}
            >
              <option value="ADD_BACK">Add-back</option>
              <option value="DEDUCT">Deduct</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="amt">Amount (fils)</Label>
            <Input id="amt" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reason">Reason</Label>
            <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <Button variant="outline" onClick={addAdjustment}>
          Add adjustment
        </Button>
        <ul className="divide-y divide-border border border-border text-sm">
          {(report?.adjustments || []).length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">No adjustments yet.</li>
          ) : (
            report!.adjustments.map((adj) => (
              <li key={adj.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  {adj.direction} · {fils(adj.amountMinor)} · {adj.reason}
                </span>
                <Button size="sm" variant="outline" onClick={() => removeAdjustment(adj.id)}>
                  Remove
                </Button>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="space-y-2 border-t border-border pt-4">
        <h2 className="font-heading text-xl">CT packs</h2>
        <Button onClick={prepare} disabled={!report?.reconciledToLedger}>
          Prepare CT pack
        </Button>
        <ul className="divide-y divide-border border border-border text-sm">
          {packs.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">No CT packs yet.</li>
          ) : (
            packs.map((pack) => (
              <li key={pack.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  v{pack.version} · {pack.status}
                </span>
                <div className="flex gap-2">
                  {pack.status === "PENDING_APPROVAL" ? (
                    <Button size="sm" variant="outline" onClick={() => approve(pack.id)}>
                      Approve
                    </Button>
                  ) : null}
                  {pack.status === "RELEASED" ? (
                    <Button size="sm" onClick={() => download(pack.id, pack.version)}>
                      Download
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">download locked</span>
                  )}
                </div>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
