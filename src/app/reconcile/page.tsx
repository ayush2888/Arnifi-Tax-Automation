"use client";

import { useEffect, useState } from "react";

import { DEMO_PERIOD_ID } from "@/config/product";
import { Button } from "@/components/ui/button";

type OpenItem = {
  id: string;
  side: string;
  reference: string;
  originalMinor: number;
  outstandingMinor: number;
  status: string;
  partyName: string;
};

type BankRow = {
  id: string;
  txnDate: string | null;
  description: string;
  debitMinor: number | null;
  creditMinor: number | null;
};

type Control = {
  balanced: boolean;
  ar: { subledgerMinor: number; controlMinor: number; deltaMinor: number; balanced: boolean };
  ap: { subledgerMinor: number; controlMinor: number; deltaMinor: number; balanced: boolean };
};

type ExceptionRow = {
  id: string;
  kind: string;
  message: string;
  status: string;
};

type Group = { id: string; status: string; matchKind: string; note: string };

function fils(n: number) {
  return (n / 100).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ReconcilePage() {
  const [openItems, setOpenItems] = useState<OpenItem[]>([]);
  const [bank, setBank] = useState<BankRow[]>([]);
  const [control, setControl] = useState<Control | null>(null);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedBank, setSelectedBank] = useState<string | null>(null);
  const [selectedOpen, setSelectedOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function load() {
    setError("");
    Promise.all([
      fetch(`/api/open-items?periodId=${DEMO_PERIOD_ID}`).then((r) => r.json()),
      fetch("/api/recon-bank").then((r) => r.json()),
      fetch(`/api/periods/${DEMO_PERIOD_ID}/control-check`).then((r) => r.json()),
      fetch("/api/recon-exceptions?status=OPEN").then((r) => r.json()),
      fetch("/api/recon-groups").then((r) => r.json()),
    ])
      .then(([items, bankRows, check, excs, grp]) => {
        setOpenItems(items);
        setBank(bankRows);
        setControl(check);
        setExceptions(excs);
        setGroups(grp);
      })
      .catch(() => setError("Could not load reconcile workspace. Apply db/07-recon.sql if needed."));
  }

  useEffect(() => {
    load();
  }, []);

  async function proposeAndConfirm() {
    setError("");
    setMessage("");
    if (!selectedBank || !selectedOpen) {
      setError("Select one bank row and one open item.");
      return;
    }
    const proposed = await fetch("/api/recon-matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        periodId: DEMO_PERIOD_ID,
        bankTransactionIds: [selectedBank],
        openItemIds: [selectedOpen],
      }),
    });
    const body = await proposed.json().catch(() => ({}));
    if (!proposed.ok) {
      setError(body.message || body.error || "Propose failed.");
      return;
    }
    const confirmed = await fetch(`/api/recon-matches/${body.id}/confirm`, { method: "POST" });
    if (!confirmed.ok) {
      const payload = await confirmed.json().catch(() => ({}));
      setError(payload.message || payload.error || "Confirm failed.");
      return;
    }
    setSelectedBank(null);
    setSelectedOpen(null);
    setMessage("Match confirmed.");
    load();
  }

  async function autoPropose() {
    setError("");
    setMessage("");
    const response = await fetch(`/api/periods/${DEMO_PERIOD_ID}/recon-auto`, { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.message || payload.error || "Auto-propose failed.");
      return;
    }
    setMessage(`Auto-proposed ${payload.proposedCount} exact match(es). Confirm from the groups list.`);
    load();
  }

  async function flagControlBreak() {
    if (!control || control.balanced) return;
    await fetch("/api/recon-exceptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "CONTROL_BREAK",
        periodId: DEMO_PERIOD_ID,
        message: `AR delta ${control.ar.deltaMinor}, AP delta ${control.ap.deltaMinor}`,
      }),
    });
    load();
  }

  async function resolveExc(id: string) {
    await fetch(`/api/recon-exceptions/${id}/resolve`, { method: "POST" });
    load();
  }

  async function confirmGroup(id: string) {
    const response = await fetch(`/api/recon-matches/${id}/confirm`, { method: "POST" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.message || payload.error || "Confirm failed.");
      return;
    }
    setMessage("Group confirmed.");
    load();
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-heading text-3xl tracking-tight">Reconcile</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          AR/AP open items versus bank rows. Confirm matches, watch control vs sub-ledger, and work the exception queue.
        </p>
      </header>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

      <section className="space-y-2">
        <h2 className="font-heading text-xl">Control check</h2>
        {control ? (
          <div className="grid max-w-2xl gap-2 text-sm">
            <p className={control.balanced ? "" : "text-danger"}>
              {control.balanced ? "Sub-ledger matches control within tolerance." : "Control break — investigate."}
            </p>
            <p>
              AR sub {fils(control.ar.subledgerMinor)} · control {fils(control.ar.controlMinor)} · Δ{" "}
              {fils(control.ar.deltaMinor)}
            </p>
            <p>
              AP sub {fils(control.ap.subledgerMinor)} · control {fils(control.ap.controlMinor)} · Δ{" "}
              {fils(control.ap.deltaMinor)}
            </p>
            {!control.balanced ? (
              <Button size="sm" variant="outline" onClick={flagControlBreak}>
                Flag control break
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={autoPropose}>
          Auto-propose exact amounts
        </Button>
        <Button onClick={proposeAndConfirm} disabled={!selectedBank || !selectedOpen}>
          Match selected &amp; confirm
        </Button>
        <Button variant="outline" onClick={load}>
          Refresh
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <h2 className="font-heading text-xl">Open items</h2>
          <ul className="divide-y divide-border border border-border text-sm">
            {openItems.length === 0 ? (
              <li className="px-3 py-2 text-muted-foreground">No open items. Post invoices from Inbox.</li>
            ) : (
              openItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left ${
                      selectedOpen === item.id ? "bg-muted" : "hover:bg-muted/50"
                    }`}
                    onClick={() => setSelectedOpen(item.id)}
                  >
                    <span className="font-medium">
                      {item.side} · {item.partyName} · {item.reference || "(no ref)"}
                    </span>
                    <span className="text-muted-foreground">
                      {item.status} · outstanding {fils(item.outstandingMinor)} / {fils(item.originalMinor)}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-heading text-xl">Unmatched bank</h2>
          <ul className="divide-y divide-border border border-border text-sm">
            {bank.length === 0 ? (
              <li className="px-3 py-2 text-muted-foreground">No unmatched bank rows (or none loaded yet).</li>
            ) : (
              bank.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left ${
                      selectedBank === row.id ? "bg-muted" : "hover:bg-muted/50"
                    }`}
                    onClick={() => setSelectedBank(row.id)}
                  >
                    <span className="font-medium">{row.description || "(no description)"}</span>
                    <span className="text-muted-foreground">
                      {row.txnDate || "—"} ·{" "}
                      {row.debitMinor
                        ? `Dr ${fils(row.debitMinor)}`
                        : row.creditMinor
                          ? `Cr ${fils(row.creditMinor)}`
                          : "0.00"}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>

      <section className="space-y-2 border-t border-border pt-4">
        <h2 className="font-heading text-xl">Proposed / confirmed groups</h2>
        <ul className="divide-y divide-border border border-border text-sm">
          {groups.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">No recon groups yet.</li>
          ) : (
            groups.map((group) => (
              <li key={group.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  {group.matchKind} · {group.status}
                  {group.note ? ` · ${group.note}` : ""}
                </span>
                {group.status === "PROPOSED" ? (
                  <Button size="sm" variant="outline" onClick={() => confirmGroup(group.id)}>
                    Confirm
                  </Button>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="space-y-2 border-t border-border pt-4">
        <h2 className="font-heading text-xl">Exception queue</h2>
        <ul className="divide-y divide-border border border-border text-sm">
          {exceptions.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">No open exceptions.</li>
          ) : (
            exceptions.map((exc) => (
              <li key={exc.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  {exc.kind} · {exc.message}
                </span>
                <Button size="sm" variant="outline" onClick={() => resolveExc(exc.id)}>
                  Resolve
                </Button>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
