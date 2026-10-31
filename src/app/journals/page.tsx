"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { useBooksShell } from "@/components/books/books-shell-context";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type Account = { id: string; code: string; name: string };
type Journal = {
  id: string;
  memo: string;
  entryDate: string;
  status: string;
  entryNo?: string | null;
  voucherType?: string | null;
  sourceDocumentId: string | null;
  sourceDocumentName?: string | null;
  sourceDocType?: string | null;
  periodId?: string;
  periodLabel: string;
  debitMinor?: string | number;
  creditMinor?: string | number;
};

type JournalDetail = Journal & {
  lines: {
    id: string;
    accountCode: string;
    accountName: string;
    debitMinor: number;
    creditMinor: number;
    lineMemo: string;
    vat201Box?: string | null;
  }[];
};

type LineDraft = { accountId: string; debitMinor: string; creditMinor: string };

function statusTone(status: string): "ok" | "warn" | "neutral" | "info" {
  const s = status.toLowerCase();
  if (s === "posted") return "ok";
  if (s === "draft") return "warn";
  if (s === "reversed") return "info";
  return "neutral";
}

function fils(n: number) {
  return (n / 100).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function JournalsPage() {
  // Same period as the top-bar switcher (invoice posts land in the invoice month).
  const { periods, periodId, setPeriodId } = useBooksShell();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journals, setJournals] = useState<Journal[] | null>(null);
  const [otherPeriods, setOtherPeriods] = useState<{ periodId: string; periodLabel: string; count: number }[]>([]);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JournalDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [memo, setMemo] = useState("Office rent");
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<LineDraft[]>([
    { accountId: "", debitMinor: "8000", creditMinor: "0" },
    { accountId: "", debitMinor: "0", creditMinor: "8000" },
  ]);

  function load(nextPeriodId = periodId) {
    if (!nextPeriodId) return;
    Promise.all([
      fetch("/api/accounts").then((r) => r.json()),
      fetch(`/api/journals?periodId=${encodeURIComponent(nextPeriodId)}`).then((r) => r.json()),
      fetch("/api/journals").then((r) => r.json()),
    ])
      .then(([accountList, journalList, allList]) => {
        const accountsSafe = Array.isArray(accountList) ? accountList : [];
        const inPeriod = Array.isArray(journalList) ? journalList : [];
        setAccounts(accountsSafe);
        setJournals(inPeriod);
        const counts = new Map<string, { periodId: string; periodLabel: string; count: number }>();
        for (const row of Array.isArray(allList) ? (allList as Journal[]) : []) {
          if (!row.periodId || row.periodId === nextPeriodId) continue;
          const prev = counts.get(row.periodId);
          if (prev) prev.count += 1;
          else counts.set(row.periodId, { periodId: row.periodId, periodLabel: row.periodLabel || "Period", count: 1 });
        }
        setOtherPeriods([...counts.values()].sort((a, b) => a.periodLabel.localeCompare(b.periodLabel)));
        // Prefer expense + bank for a friendly first journal
        const expense =
          accountsSafe.find((a: Account) => /rent|expense/i.test(`${a.code} ${a.name}`)) || accountsSafe[0];
        const bank =
          accountsSafe.find((a: Account) => /bank|cash/i.test(`${a.code} ${a.name}`)) || accountsSafe[1] || accountsSafe[0];
        setLines((current) => [
          { ...current[0]!, accountId: current[0]?.accountId || expense?.id || "" },
          { ...current[1]!, accountId: current[1]?.accountId || bank?.id || "" },
        ]);
      })
      .catch(() => setError("Could not load journals."));
  }

  useEffect(() => {
    if (!periodId) return;
    load(periodId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodId]);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    let stop = false;
    setDetailLoading(true);
    fetch(`/api/journals/${openId}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.message || body.error || "Could not load journal.");
        if (!stop) setDetail(body as JournalDetail);
      })
      .catch((err: Error) => {
        if (!stop) setError(err.message);
      })
      .finally(() => {
        if (!stop) setDetailLoading(false);
      });
    return () => {
      stop = true;
    };
  }, [openId]);

  async function createAndPost() {
    if (!periodId) {
      setError("Select an open period before posting.");
      return;
    }
    setError("");
    const body = {
      periodId,
      memo,
      entryDate,
      post: true,
      lines: lines.map((line) => ({
        accountId: line.accountId,
        debitMinor: Number(line.debitMinor || 0),
        creditMinor: Number(line.creditMinor || 0),
      })),
    };
    const response = await fetch("/api/journals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.message || payload.error || "Journal could not be posted.");
      return;
    }
    setShowForm(false);
    load(periodId);
  }

  const debitTotal = lines.reduce((s, l) => s + Number(l.debitMinor || 0), 0);
  const creditTotal = lines.reduce((s, l) => s + Number(l.creditMinor || 0), 0);
  const balanced = debitTotal === creditTotal && debitTotal > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Journals"
        description="Every posted voucher for the period, as debits and credits. Balances and reports are built from these."
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="period" className="text-xs text-muted-foreground">
                Period
              </Label>
              <select
                id="period"
                className="flex h-9 min-w-48 rounded-md border border-input bg-card px-2 text-sm"
                value={periodId}
                onChange={(event) => setPeriodId(event.target.value)}
              >
                {periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.label} ({period.status})
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Hide form" : "Create entry"}</Button>
            <Link
              href="/reports?tab=daybook"
              className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
            >
              Day book
            </Link>
          </div>
        }
      />

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-red-50 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {showForm ? (
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-base font-semibold">Create & post journal</h2>
            <StatusPill tone={balanced ? "ok" : "warn"}>
              {balanced ? "Balanced" : "Debits must equal credits"} · amounts in fils
            </StatusPill>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="memo">Description</Label>
              <Input id="memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="entryDate">Entry date</Label>
              <Input id="entryDate" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <div className="hidden grid-cols-[1fr_7rem_7rem] gap-2 text-xs font-medium text-muted-foreground md:grid">
              <span>Account</span>
              <span>Debit (fils)</span>
              <span>Credit (fils)</span>
            </div>
            {lines.map((line, index) => (
              <div key={index} className="grid gap-2 md:grid-cols-[1fr_7rem_7rem]">
                <select
                  className="flex h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={line.accountId}
                  onChange={(e) => {
                    const next = [...lines];
                    next[index] = { ...line, accountId: e.target.value };
                    setLines(next);
                  }}
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} · {account.name}
                    </option>
                  ))}
                </select>
                <Input
                  inputMode="numeric"
                  placeholder="Debit"
                  className="tabular-nums"
                  value={line.debitMinor}
                  onChange={(e) => {
                    const next = [...lines];
                    next[index] = { ...line, debitMinor: e.target.value, creditMinor: "0" };
                    setLines(next);
                  }}
                />
                <Input
                  inputMode="numeric"
                  placeholder="Credit"
                  className="tabular-nums"
                  value={line.creditMinor}
                  onChange={(e) => {
                    const next = [...lines];
                    next[index] = { ...line, creditMinor: e.target.value, debitMinor: "0" };
                    setLines(next);
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              Dr {fils(debitTotal)} · Cr {fils(creditTotal)}
            </span>
            <Button onClick={createAndPost} disabled={!balanced}>
              Post journal
            </Button>
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-heading text-base font-semibold">Posted & draft entries</h2>
          <Link href="/reports?tab=tb" className="text-sm font-medium text-primary hover:underline">
            Trial balance →
          </Link>
        </div>
        {journals === null ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">Loading…</p>
        ) : journals.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium text-foreground">No journals in this period yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Invoice posts appear under the invoice’s month (e.g. a June sales invoice → Jun 2026), not today’s month.
              Change the period above or in the top bar.
            </p>
            {otherPeriods.length > 0 ? (
              <div className="mx-auto mt-4 flex max-w-md flex-wrap justify-center gap-2">
                {otherPeriods.map((p) => (
                  <Button key={p.periodId} type="button" variant="outline" size="sm" onClick={() => setPeriodId(p.periodId)}>
                    {p.periodLabel} ({p.count})
                  </Button>
                ))}
              </div>
            ) : (
              <Button className="mt-3" onClick={() => setShowForm(true)}>
                Create your first entry
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Voucher</th>
                  <th className="px-3 py-3 font-medium">Date</th>
                  <th className="px-3 py-3 font-medium">Type</th>
                  <th className="px-3 py-3 font-medium">Description</th>
                  <th className="px-3 py-3 text-right font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {journals.map((journal) => (
                  <tr
                    key={journal.id}
                    className="cursor-pointer hover:bg-primary-subtle/40"
                    onClick={() => setOpenId(journal.id)}
                  >
                    <td className="whitespace-nowrap px-5 py-3 font-medium tabular-nums text-foreground">
                      {journal.entryNo || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums text-muted-foreground">
                      {journal.entryDate}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{journal.voucherType || "Journal"}</td>
                    <td className="max-w-[22rem] truncate px-3 py-3 font-medium text-foreground" title={journal.memo}>
                      {journal.memo || "(no memo)"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      {fils(Number(journal.debitMinor || journal.creditMinor || 0))} AED
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill tone={statusTone(journal.status)}>{journal.status}</StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Sheet
        open={Boolean(openId)}
        onOpenChange={(open) => {
          if (!open) {
            setOpenId(null);
            setDetail(null);
          }
        }}
      >
        <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="font-heading">
              {detail?.entryNo || (detailLoading ? "Loading…" : "Journal")}
            </SheetTitle>
          </SheetHeader>
          {detailLoading && !detail ? (
            <p className="px-4 py-8 text-sm text-muted-foreground">Loading entry…</p>
          ) : detail ? (
            <JournalEntryPanel detail={detail} />
          ) : (
            <p className="px-4 py-8 text-sm text-muted-foreground">Could not load this journal.</p>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function JournalEntryPanel({ detail }: { detail: JournalDetail }) {
  const debit = detail.lines.reduce((s, l) => s + Number(l.debitMinor || 0), 0);
  const credit = detail.lines.reduce((s, l) => s + Number(l.creditMinor || 0), 0);
  return (
    <div className="space-y-4 px-4 pb-6 text-sm">
      <div className="rounded-xl border border-border bg-surface-muted/50 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={statusTone(detail.status)}>{detail.status}</StatusPill>
          <StatusPill tone="neutral">{detail.voucherType || "Journal"}</StatusPill>
        </div>
        <p className="mt-3 font-medium text-foreground">{detail.memo || "(no memo)"}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Voucher</p>
            <p className="font-medium tabular-nums">{detail.entryNo || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Date</p>
            <p className="font-medium tabular-nums">{detail.entryDate}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Period</p>
            <p className="font-medium">{detail.periodLabel || "—"}</p>
          </div>
        </div>
        {detail.sourceDocumentId ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Source: {detail.sourceDocumentName || "Invoice"}{" "}
            <Link
              href={`/inbox?document=${detail.sourceDocumentId}`}
              className="font-medium text-primary hover:underline"
            >
              Open in Inbox →
            </Link>
          </p>
        ) : null}
      </div>

      <div>
        <h3 className="mb-2 font-medium">Debit &amp; credit lines</h3>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[28rem] text-left text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 text-right font-medium">Debit</th>
                <th className="px-3 py-2 text-right font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((line) => (
                <tr key={line.id} className="border-t border-border/70">
                  <td className="px-3 py-2">
                    <span className="font-medium tabular-nums">{line.accountCode}</span>
                    <span className="text-muted-foreground"> · {line.accountName}</span>
                    {line.vat201Box ? (
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">VAT box {line.vat201Box}</span>
                    ) : null}
                  </td>
                  <td className={cn("px-3 py-2 text-right tabular-nums", line.debitMinor ? "font-medium" : "text-muted-foreground")}>
                    {line.debitMinor ? fils(Number(line.debitMinor)) : ""}
                  </td>
                  <td className={cn("px-3 py-2 text-right tabular-nums", line.creditMinor ? "font-medium" : "text-muted-foreground")}>
                    {line.creditMinor ? fils(Number(line.creditMinor)) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/30 font-medium">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{fils(debit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fils(credit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {debit !== credit ? (
          <p className="mt-2 text-xs text-destructive">Debits and credits do not match — this should not happen on a posted entry.</p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Balanced · amounts in AED.</p>
        )}
      </div>
    </div>
  );
}
