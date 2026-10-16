"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LedgerPeriodSelect, useLedgerPeriod } from "@/lib/use-ledger-period";

type Checklist = {
  period: { id: string; label: string; status: string };
  trialBalance: { totalDebit: number; totalCredit: number; balanced: boolean };
  items: Record<string, boolean>;
  ready: boolean;
};

type Accrual = { id: string; kind: string; memo: string; amountMinor: number; status: string };
type Depr = { id: string; assetCode: string; assetName: string; amountMinor: number; status: string };
type Event = { id: string; action: string; reason: string; ticketRef: string; at: string; actorName: string };
type Account = { id: string; code: string; name: string };

const EXPENSE = "a1000001-0000-4000-8000-000000000008";
const ACCRUED = "a1000001-0000-4000-8000-000000000012";
const FA = "a1000001-0000-4000-8000-000000000010";
const ACCUM = "a1000001-0000-4000-8000-000000000011";
const DEPR_EXP = "a1000001-0000-4000-8000-000000000013";

function fils(n: number) {
  return (n / 100).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ClosePage() {
  const { periods, periodId, setPeriodId } = useLedgerPeriod();
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [accruals, setAccruals] = useState<Accrual[]>([]);
  const [depr, setDepr] = useState<Depr[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [accrualMemo, setAccrualMemo] = useState("Month-end accrual");
  const [accrualAmount, setAccrualAmount] = useState("25000");
  const [reopenReason, setReopenReason] = useState("");
  const [ticketRef, setTicketRef] = useState("");

  function load() {
    if (!periodId) return;
    setError("");
    Promise.all([
      fetch(`/api/periods/${periodId}/close-checklist`).then((r) => r.json()),
      fetch(`/api/accruals?periodId=${periodId}`).then((r) => r.json()),
      fetch(`/api/depreciation?periodId=${periodId}`).then((r) => r.json()),
      fetch(`/api/periods/${periodId}/close-events`).then((r) => r.json()),
      fetch("/api/accounts").then((r) => r.json()),
    ])
      .then(([check, acc, dep, ev, accts]) => {
        setChecklist(check);
        setAccruals(acc);
        setDepr(dep);
        setEvents(ev);
        setAccounts(accts);
      })
      .catch(() => setError("Could not load close workspace. Apply db/08-close.sql and 09-close-seed.sql."));
  }

  useEffect(() => {
    if (!periodId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodId]);

  async function addAccrual() {
    setError("");
    const response = await fetch("/api/accruals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        periodId: periodId,
        kind: "ACCRUAL",
        memo: accrualMemo,
        debitAccountId: accounts.find((a) => a.code === "5000")?.id || EXPENSE,
        creditAccountId: accounts.find((a) => a.code === "2200")?.id || ACCRUED,
        amountMinor: Number(accrualAmount),
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.message || payload.error || "Create accrual failed.");
      return;
    }
    load();
  }

  async function postAccrual(id: string) {
    const response = await fetch(`/api/accruals/${id}/post`, { method: "POST" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.message || payload.error || "Post accrual failed.");
      return;
    }
    setMessage("Accrual posted.");
    load();
  }

  async function registerAsset() {
    setError("");
    const response = await fetch("/api/fixed-assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        periodId: periodId,
        code: `FA-${Date.now().toString().slice(-6)}`,
        name: "Demo laptop",
        costMinor: 120000,
        residualMinor: 0,
        lifeMonths: 36,
        inServiceOn: "2026-01-15",
        assetAccountId: accounts.find((a) => a.code === "1500")?.id || FA,
        accumDeprAccountId: accounts.find((a) => a.code === "1510")?.id || ACCUM,
        deprExpenseAccountId: accounts.find((a) => a.code === "5100")?.id || DEPR_EXP,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.message || payload.error || "Register asset failed (need FA COA seed).");
      return;
    }
    setMessage("Fixed asset registered with planned depreciation.");
    load();
  }

  async function postDepr(id: string) {
    const response = await fetch(`/api/depreciation/${id}/post`, { method: "POST" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.message || payload.error || "Post depreciation failed.");
      return;
    }
    setMessage("Depreciation posted.");
    load();
  }

  async function waiveVat() {
    await fetch(`/api/periods/${periodId}/waive-vat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Demo close without VAT release" }),
    });
    load();
  }

  async function close() {
    setError("");
    setMessage("");
    const response = await fetch(`/api/periods/${periodId}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Month-end close" }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.message || payload.error || "Close blocked — checklist incomplete.");
      return;
    }
    setMessage("Period CLOSED. Postings are blocked until reopen.");
    load();
  }

  async function reopen() {
    setError("");
    const response = await fetch(`/api/periods/${periodId}/reopen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reopenReason, ticketRef }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.message || payload.error || "Reopen failed.");
      return;
    }
    setMessage("Period REOPENED. Prior VAT packs are STALE.");
    load();
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-heading text-3xl tracking-tight">Period close</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Accruals, depreciation, trial-balance identity, and a close checklist. Closed periods reject new posts until
          a documented reopen.
        </p>
        <LedgerPeriodSelect periods={periods} periodId={periodId} onChange={setPeriodId} />
      </header>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

      {checklist ? (
        <section className="space-y-2">
          <h2 className="font-heading text-xl">
            {checklist.period.label} · {checklist.period.status}
          </h2>
          <p className="text-sm">
            TB debit {fils(checklist.trialBalance.totalDebit)} / credit {fils(checklist.trialBalance.totalCredit)} ·{" "}
            {checklist.trialBalance.balanced ? "balanced" : "NOT balanced"}
          </p>
          <ul className="text-sm">
            {Object.entries(checklist.items).map(([key, ok]) => (
              <li key={key} className={ok ? "" : "text-danger"}>
                {ok ? "✓" : "✗"} {key}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={waiveVat}>
              Waive VAT for close
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await fetch(`/api/periods/${periodId}/waive-recon`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ reason: "Demo close without recon clear" }),
                });
                load();
              }}
            >
              Waive recon for close
            </Button>
            <Button onClick={close} disabled={!checklist.ready || checklist.period.status === "CLOSED"}>
              Close period
            </Button>
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </section>
      ) : null}

      <section className="space-y-3 border-t border-border pt-4">
        <h2 className="font-heading text-xl">Accrual</h2>
        <div className="grid max-w-xl gap-2 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="memo">Memo</Label>
            <Input id="memo" value={accrualMemo} onChange={(e) => setAccrualMemo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="amt">Amount (fils)</Label>
            <Input id="amt" value={accrualAmount} onChange={(e) => setAccrualAmount(e.target.value)} />
          </div>
        </div>
        <Button variant="outline" onClick={addAccrual}>
          Create accrual draft
        </Button>
        <ul className="divide-y divide-border border border-border text-sm">
          {accruals.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                {row.kind} · {row.memo} · {fils(row.amountMinor)} · {row.status}
              </span>
              {row.status === "DRAFT" || row.status === "PROPOSED" ? (
                <Button size="sm" onClick={() => postAccrual(row.id)}>
                  Post
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 border-t border-border pt-4">
        <h2 className="font-heading text-xl">Fixed assets / depreciation</h2>
        <Button variant="outline" onClick={registerAsset}>
          Register demo asset
        </Button>
        <ul className="divide-y divide-border border border-border text-sm">
          {depr.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                {row.assetCode} · {row.assetName} · {fils(row.amountMinor)} · {row.status}
              </span>
              {row.status === "PLANNED" || row.status === "PROPOSED" ? (
                <Button size="sm" onClick={() => postDepr(row.id)}>
                  Post depr
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 border-t border-border pt-4">
        <h2 className="font-heading text-xl">Reopen</h2>
        <div className="grid max-w-xl gap-2 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="reason">Reason</Label>
            <Input id="reason" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ticket">Ticket ref</Label>
            <Input id="ticket" value={ticketRef} onChange={(e) => setTicketRef(e.target.value)} />
          </div>
        </div>
        <Button variant="outline" onClick={reopen} disabled={checklist?.period.status !== "CLOSED"}>
          Reopen period
        </Button>
      </section>

      <section className="space-y-2 border-t border-border pt-4">
        <h2 className="font-heading text-xl">Close audit</h2>
        <ul className="divide-y divide-border border border-border text-sm">
          {events.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">No close events yet.</li>
          ) : (
            events.map((event) => (
              <li key={event.id} className="px-3 py-2">
                {event.action} · {event.actorName} · {event.reason}
                {event.ticketRef ? ` · ${event.ticketRef}` : ""} · {String(event.at).slice(0, 19)}
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
