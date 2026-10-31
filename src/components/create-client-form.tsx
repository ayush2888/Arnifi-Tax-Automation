"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

export function CreateClientForm({ onCreated }: { onCreated?: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [fiscalYearStartMonth, setFiscalYearStartMonth] = useState(1);
  const [fiscalYear, setFiscalYear] = useState(new Date().getUTCFullYear());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          fiscalYearStartMonth,
          fiscalYear,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.message || payload.error || "Could not create company.");
        return;
      }
      onCreated?.();
      router.refresh();
      window.location.assign("/dashboard");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <div>
        <h3 className="font-heading text-sm font-semibold text-foreground">New company</h3>
        <p className="mt-1 text-sm text-muted-foreground">Creates empty books and 12 open months.</p>
      </div>
      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-red-50 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm font-medium md:col-span-1">
          Name
          <input
            className="mt-1.5 block w-full rounded-lg border border-border bg-background px-3 py-2 transition-colors hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Company name"
            required
            maxLength={200}
          />
        </label>
        <label className="text-sm font-medium">
          Fiscal year starts
          <select
            className="mt-1.5 block w-full rounded-lg border border-border bg-background px-3 py-2 transition-colors hover:border-primary/40"
            value={fiscalYearStartMonth}
            onChange={(e) => setFiscalYearStartMonth(Number(e.target.value))}
          >
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Year
          <input
            type="number"
            min={2000}
            max={2100}
            className="mt-1.5 block w-full rounded-lg border border-border bg-background px-3 py-2 transition-colors hover:border-primary/40"
            value={fiscalYear}
            onChange={(e) => setFiscalYear(Number(e.target.value))}
          />
        </label>
      </div>
      <Button type="submit" disabled={busy || !name.trim()}>
        {busy ? "Creating…" : "Create company"}
      </Button>
    </form>
  );
}

export function EnsurePeriodsForm() {
  const router = useRouter();
  const [fiscalYear, setFiscalYear] = useState(new Date().getUTCFullYear());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/periods/ensure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fiscalYear }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.message || payload.error || "Could not generate months.");
        return;
      }
      const n = Array.isArray(payload.created) ? payload.created.length : 0;
      setMessage(n ? `Added ${n} month(s).` : `Months for ${fiscalYear} already exist.`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
      <label className="text-sm font-medium">
        Add months for year
        <input
          type="number"
          min={2000}
          max={2100}
          className="mt-1.5 block w-28 rounded-lg border border-border bg-background px-3 py-2"
          value={fiscalYear}
          onChange={(e) => setFiscalYear(Number(e.target.value))}
        />
      </label>
      <Button type="submit" variant="outline" disabled={busy}>
        {busy ? "Working…" : "Generate"}
      </Button>
      {error ? <p className="w-full text-sm text-destructive">{error}</p> : null}
      {message ? <p className="w-full text-sm text-muted-foreground">{message}</p> : null}
    </form>
  );
}
