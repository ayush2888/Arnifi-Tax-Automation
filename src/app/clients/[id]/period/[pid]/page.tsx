"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

const STAGES = [
  "DOCS_COLLECTING",
  "EXTRACTED",
  "JOURNALS_PROPOSED",
  "JOURNALS_POSTED",
  "RECONCILED",
  "CLOSE_CHECKS",
  "TB_BALANCED",
  "STATEMENTS_READY",
  "PACKS_RELEASED",
];

type Proposal = {
  id: string;
  status: string;
  confidence: number;
  memo: string;
  entryDate: string;
  warnings: string[];
  lines: { accountId: string; debitMinor: number; creditMinor: number; lineMemo?: string }[];
};

export default function PeriodWorkspacePage() {
  const params = useParams<{ id: string; pid: string }>();
  const [stage, setStage] = useState("DOCS_COLLECTING");
  const [missing, setMissing] = useState<{ code: string; ok: boolean; message: string; requestTemplate?: string }[]>(
    [],
  );
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [tb, setTb] = useState<{ balanced?: boolean; totalDebit?: number; totalCredit?: number } | null>(null);
  const [financials, setFinancials] = useState<Record<string, unknown> | null>(null);
  const [tab, setTab] = useState<"review" | "tb" | "pnl" | "bs" | "cf">("review");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function load() {
    const pid = params.pid;
    Promise.all([
      fetch(`/api/pipeline/${pid}`).then((r) => r.json()),
      fetch(`/api/pipeline/${pid}/missing-docs`).then((r) => r.json()),
      fetch(`/api/proposals?periodId=${encodeURIComponent(pid)}`).then((r) => r.json()),
      fetch(`/api/trial-balance?periodId=${encodeURIComponent(pid)}`).then((r) => r.json()),
      fetch(`/api/periods/${pid}/financials`).then((r) => r.json()).catch(() => null),
    ])
      .then(([pipeline, miss, props, trial, fin]) => {
        setStage(pipeline.stage || "DOCS_COLLECTING");
        setMissing(Array.isArray(miss) ? miss : []);
        setProposals(Array.isArray(props) ? props : []);
        setTb(trial);
        setFinancials(fin && !fin.error ? fin : null);
      })
      .catch(() => setError("Could not load period workspace."));
  }

  useEffect(() => {
    load();
  }, [params.id, params.pid]);

  async function recompute() {
    await fetch(`/api/pipeline/${params.pid}/recompute`, { method: "POST" });
    load();
  }

  async function approve(id: string) {
    setError("");
    const response = await fetch(`/api/proposals/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post: true, allowLowConfidence: true }),
    });
    if (!response.ok) {
      setError("Approve failed.");
      return;
    }
    setMessage("Proposal posted.");
    await recompute();
  }

  const stageIdx = Math.max(0, STAGES.indexOf(stage));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">
          <Link href="/dashboard" className="underline-offset-2 hover:underline">
            Dashboard
          </Link>{" "}
          / client {params.id.slice(0, 8)}…
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Period workspace</h1>
        <div className="flex flex-wrap gap-1">
          {STAGES.map((s, i) => (
            <span
              key={s}
              className={`rounded px-2 py-1 text-[11px] ${i <= stageIdx ? "bg-foreground text-background" : "bg-muted text-muted-foreground"}`}
            >
              {s}
            </span>
          ))}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={recompute}>
          Recompute pipeline
        </Button>
      </header>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Missing docs</h2>
        <ul className="space-y-2 text-sm">
          {missing.map((item) => (
            <li key={item.code} className={item.ok ? "text-muted-foreground" : ""}>
              {item.ok ? "✓" : "!"} {item.message}
              {!item.ok && item.requestTemplate ? (
                <button
                  type="button"
                  className="ml-2 underline"
                  onClick={() => navigator.clipboard.writeText(item.requestTemplate || "")}
                >
                  Copy request
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <div className="flex gap-2 text-sm">
        {(["review", "tb", "pnl", "bs", "cf"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`rounded px-3 py-1 ${tab === t ? "bg-foreground text-background" : "bg-muted"}`}
            onClick={() => setTab(t)}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {tab === "review" ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Review queue</h2>
          {proposals.map((p) => (
            <div key={p.id} className="rounded border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">
                    {p.memo} · {p.entryDate}
                  </div>
                  <div className="text-muted-foreground">
                    {p.status} · confidence {p.confidence}
                    {p.warnings?.length ? ` · ${p.warnings.join(", ")}` : ""}
                  </div>
                </div>
                {p.status === "PROPOSED" ? (
                  <Button type="button" size="sm" onClick={() => approve(p.id)}>
                    Approve & post
                  </Button>
                ) : null}
              </div>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {p.lines.map((l, idx) => (
                  <li key={idx}>
                    {l.lineMemo || l.accountId.slice(0, 8)} Dr {l.debitMinor} Cr {l.creditMinor}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {!proposals.length ? <p className="text-sm text-muted-foreground">No proposals yet.</p> : null}
        </section>
      ) : null}

      {tab === "tb" && tb ? (
        <section className="text-sm">
          <p>
            TB {tb.balanced ? "balanced" : "OUT OF BALANCE"} · Dr {tb.totalDebit} / Cr {tb.totalCredit}
          </p>
        </section>
      ) : null}

      {tab === "pnl" && financials ? (
        <pre className="overflow-auto rounded border p-3 text-xs">
          {JSON.stringify((financials as { pnl?: unknown }).pnl, null, 2)}
        </pre>
      ) : null}
      {tab === "bs" && financials ? (
        <pre className="overflow-auto rounded border p-3 text-xs">
          {JSON.stringify((financials as { balanceSheet?: unknown }).balanceSheet, null, 2)}
        </pre>
      ) : null}
      {tab === "cf" && financials ? (
        <pre className="overflow-auto rounded border p-3 text-xs">
          {JSON.stringify((financials as { cashFlow?: unknown }).cashFlow, null, 2)}
        </pre>
      ) : null}

      <p className="text-sm">
        <Link className="underline" href={`/clients/${params.id}/settings`}>
          Client settings
        </Link>
        {" · "}
        <Link className="underline" href="/reconcile">
          Reconciliation
        </Link>
        {" · "}
        <Link className="underline" href="/reports">
          Statement packs
        </Link>
      </p>
    </div>
  );
}
