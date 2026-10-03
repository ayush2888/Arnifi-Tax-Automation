"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

type FirmRow = {
  clientId: string;
  clientName: string;
  periodId: string | null;
  periodLabel: string | null;
  status: {
    stage: string;
    counts: Record<string, number>;
    blockers: { code: string; message: string; severity: string }[];
    assigneeUserId: string | null;
  };
};

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

export default function DashboardPage() {
  const [rows, setRows] = useState<FirmRow[]>([]);
  const [stageFilter, setStageFilter] = useState("all");
  const [error, setError] = useState("");

  function load() {
    fetch("/api/pipeline/firm")
      .then((r) => r.json())
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setError("Could not load firm dashboard."));
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (stageFilter === "all") return rows;
    return rows.filter((r) => r.status.stage === stageFilter);
  }, [rows, stageFilter]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Books pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Firm view of clients × periods. RLS limits what each user can see.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded border px-2 py-1 text-sm"
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
          >
            <option value="all">All stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button type="button" variant="outline" onClick={load}>
            Refresh
          </Button>
        </div>
      </header>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="py-2 pr-3">Client</th>
              <th className="py-2 pr-3">Period</th>
              <th className="py-2 pr-3">Stage</th>
              <th className="py-2 pr-3">Docs</th>
              <th className="py-2 pr-3">Review</th>
              <th className="py-2 pr-3">Unmatched</th>
              <th className="py-2 pr-3">Suspense</th>
              <th className="py-2 pr-3">Blockers</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const idx = Math.max(0, STAGES.indexOf(row.status.stage));
              const pct = Math.round(((idx + 1) / STAGES.length) * 100);
              return (
                <tr key={`${row.clientId}-${row.periodId}`} className="border-b">
                  <td className="py-3 pr-3">
                    {row.periodId ? (
                      <Link
                        className="font-medium underline-offset-2 hover:underline"
                        href={`/clients/${row.clientId}/period/${row.periodId}`}
                      >
                        {row.clientName}
                      </Link>
                    ) : (
                      row.clientName
                    )}
                  </td>
                  <td className="py-3 pr-3">{row.periodLabel || "—"}</td>
                  <td className="py-3 pr-3">
                    <div className="mb-1 text-xs">{row.status.stage}</div>
                    <div className="h-1.5 w-36 rounded bg-muted">
                      <div className="h-1.5 rounded bg-foreground/80" style={{ width: `${pct}%` }} />
                    </div>
                  </td>
                  <td className="py-3 pr-3">{row.status.counts.docs ?? 0}</td>
                  <td className="py-3 pr-3">{row.status.counts.proposed ?? 0}</td>
                  <td className="py-3 pr-3">{row.status.counts.unmatched ?? 0}</td>
                  <td className="py-3 pr-3">{row.status.counts.suspense ?? 0}</td>
                  <td className="py-3 pr-3 text-xs text-muted-foreground">
                    {row.status.blockers.slice(0, 2).map((b) => b.code).join(", ") || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
