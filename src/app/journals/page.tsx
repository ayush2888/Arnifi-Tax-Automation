"use client";

import { useEffect, useState } from "react";

import { DEMO_PERIOD_ID } from "@/config/product";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Period = { id: string; label: string; status: string };
type Account = { id: string; code: string; name: string };
type Journal = {
  id: string;
  memo: string;
  entryDate: string;
  status: string;
  sourceDocumentId: string | null;
  periodLabel: string;
};

type LineDraft = { accountId: string; debitMinor: string; creditMinor: string };

export default function JournalsPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journals, setJournals] = useState<Journal[] | null>(null);
  const [periodId, setPeriodId] = useState(DEMO_PERIOD_ID);
  const [error, setError] = useState("");
  const [memo, setMemo] = useState("Manual journal");
  const [entryDate, setEntryDate] = useState("2026-01-15");
  const [lines, setLines] = useState<LineDraft[]>([
    { accountId: "", debitMinor: "10000", creditMinor: "0" },
    { accountId: "", debitMinor: "0", creditMinor: "10000" },
  ]);

  function load(nextPeriodId = periodId) {
    Promise.all([
      fetch("/api/periods").then((r) => r.json()),
      fetch("/api/accounts").then((r) => r.json()),
      fetch(`/api/journals?periodId=${encodeURIComponent(nextPeriodId)}`).then((r) => r.json()),
    ])
      .then(([periodList, accountList, journalList]) => {
        setPeriods(periodList);
        setAccounts(accountList);
        setJournals(journalList);
        if (!periodList.some((p: Period) => p.id === nextPeriodId) && periodList[0]) {
          setPeriodId(periodList[0].id);
        }
        setLines((current) =>
          current.map((line, index) => ({
            ...line,
            accountId: line.accountId || accountList[index]?.id || accountList[0]?.id || "",
          })),
        );
      })
      .catch(() => setError("Could not load journals."));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createAndPost() {
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
    load(periodId);
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-heading text-3xl tracking-tight">Journals</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Double-entry journals for the current client. Posted entries must balance in app code and in the database.
        </p>
      </header>
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="period">Period</Label>
          <select
            id="period"
            className="flex h-9 min-w-48 rounded-md border border-input bg-background px-2 text-sm"
            value={periodId}
            onChange={(event) => {
              setPeriodId(event.target.value);
              load(event.target.value);
            }}
          >
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.label} ({period.status})
              </option>
            ))}
          </select>
        </div>
      </div>

      <section className="space-y-3 border-t border-border pt-4">
        <h2 className="font-heading text-xl">Post balanced journal</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="memo">Memo</Label>
            <Input id="memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="entryDate">Entry date</Label>
            <Input id="entryDate" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </div>
        </div>
        {lines.map((line, index) => (
          <div key={index} className="grid gap-2 md:grid-cols-3">
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
              placeholder="Debit fils"
              value={line.debitMinor}
              onChange={(e) => {
                const next = [...lines];
                next[index] = { ...line, debitMinor: e.target.value };
                setLines(next);
              }}
            />
            <Input
              inputMode="numeric"
              placeholder="Credit fils"
              value={line.creditMinor}
              onChange={(e) => {
                const next = [...lines];
                next[index] = { ...line, creditMinor: e.target.value };
                setLines(next);
              }}
            />
          </div>
        ))}
        <Button onClick={createAndPost}>Post journal</Button>
      </section>

      <section className="space-y-2 border-t border-border pt-4">
        <h2 className="font-heading text-xl">Entries</h2>
        {journals === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : journals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No journals in this period yet.</p>
        ) : (
          <ul className="divide-y divide-border border border-border">
            {journals.map((journal) => (
              <li key={journal.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{journal.memo || "(no memo)"}</div>
                  <div className="text-muted-foreground">
                    {journal.entryDate} · {journal.status}
                    {journal.sourceDocumentId ? " · source-linked" : ""}
                  </div>
                </div>
                <code className="text-xs text-muted-foreground">{journal.id.slice(0, 8)}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
