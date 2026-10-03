"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { UploadDropzone } from "@/components/upload-dropzone";
import { formatMinor } from "@/lib/money";

type Dashboard = {
  statements: number;
  transactions: number;
  needsReview: number;
  balanceFailures: number;
  recent: Statement[];
};

type Statement = {
  id: string;
  bankName: string;
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  openingMinor: number | null;
  closingMinor: number | null;
  currency: string;
  extractionMethod: string | null;
};

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/dashboard")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load the dashboard.");
        return response.json();
      })
      .then(setData)
      .catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-3xl tracking-tight">Clients</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Current client workspace. Use Journals, Inbox, and VAT draft for the Stage A ledger slice; statements remain available below.
        </p>
      </header>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card label="Statements uploaded" value={data ? String(data.statements) : "…"} />
        <Card label="Transactions parsed" value={data ? String(data.transactions) : "…"} />
        <Card label="Rows needing review" value={data ? String(data.needsReview) : "…"} tone={data && data.needsReview ? "warn" : "ok"} />
        <Card label="Balance-check failures" value={data ? String(data.balanceFailures) : "…"} tone={data && data.balanceFailures ? "danger" : "ok"} />
      </section>
      <UploadDropzone onUploaded={() => load()} />
      <section>
        <h2 className="mb-2 font-heading text-xl">Recent statements</h2>
        {!data ? <p className="text-sm text-muted-foreground">Loading statements…</p> : null}
        {data && data.recent.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            No statements for this client yet. Drop a file above to start.
          </p>
        ) : null}
        {data && data.recent.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {data.recent.map((statement) => (
              <li key={statement.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div>
                  <Link href="/statements" className="font-medium">
                    {statement.bankName}
                  </Link>
                  <p className="text-muted-foreground">
                    {statement.periodStart || "Period unknown"} to {statement.periodEnd || "—"} · {statement.extractionMethod || "queued"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="nums">{formatMinor(statement.closingMinor)} {statement.currency}</p>
                  <p className="text-muted-foreground">{statement.status.replaceAll("_", " ")}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

function Card({ label, value, tone = "ok" }: { label: string; value: string; tone?: "ok" | "warn" | "danger" }) {
  const color = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-foreground";
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-2 font-heading text-3xl ${color}`}>{value}</p>
    </article>
  );
}
