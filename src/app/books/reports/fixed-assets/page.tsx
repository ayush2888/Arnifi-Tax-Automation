"use client";

import { Plus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { useBooksShell } from "@/components/books/books-shell-context";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { displayToMinor, formatMinor } from "@/lib/money";
import { ASSET_CATEGORIES } from "@/server/books/budget-assets-core";

type Asset = {
  id: string;
  name: string;
  category: string;
  acquisitionDate: string;
  costMinor: number;
  residualMinor: number;
  usefulLifeMonths: number;
  disposalDate: string | null;
  accumulatedMinor: number;
  periodChargeMinor: number;
  netBookValueMinor: number;
};

type Response = {
  asOf: string;
  assets: Asset[];
  totals: { costMinor: number; accumulatedMinor: number; periodChargeMinor: number; netBookValueMinor: number };
};

type Schedule = { name: string; schedule: { month: string; chargeMinor: number; accumulatedMinor: number; netBookValueMinor: number }[] };

const ERRORS: Record<string, string> = {
  asset_name_required: "Enter a name.",
  asset_cost_invalid: "Cost must be greater than zero.",
  asset_residual_invalid: "Residual value cannot exceed cost.",
  asset_life_invalid: "Useful life must be 1 to 600 whole months.",
  asset_date_invalid: "Enter a valid date.",
  forbidden: "Your role cannot change the asset register.",
};

const label = (v: string) => v.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

function NewAsset({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    category: "equipment",
    acquisitionDate: "",
    cost: "",
    residual: "",
    life: "60",
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    let costMinor: number | null;
    let residualMinor: number | null;
    try {
      costMinor = displayToMinor(form.cost);
      residualMinor = displayToMinor(form.residual);
    } catch {
      setError("Enter amounts with up to 2 decimals.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/books/fixed-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          category: form.category,
          acquisitionDate: form.acquisitionDate,
          costMinor,
          residualMinor: residualMinor ?? 0,
          usefulLifeMonths: Number(form.life),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(ERRORS[String(json.error)] || String(json.error || "failed").replaceAll("_", " "));
        return;
      }
      setForm((f) => ({ ...f, name: "", cost: "", residual: "" }));
      setOpen(false);
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="asset-new">
        <Plus className="size-4" />
        New asset
      </Button>
    );
  }
  return (
    <form onSubmit={submit} className="grid w-full gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-6" data-testid="asset-form">
      <div className="md:col-span-2">
        <Label htmlFor="asset-name">Name</Label>
        <Input id="asset-name" value={form.name} onChange={set("name")} required maxLength={200} />
      </div>
      <div>
        <Label htmlFor="asset-category">Category</Label>
        <select id="asset-category" className="flex h-9 w-full rounded-md border border-border bg-background px-2 text-sm" value={form.category} onChange={set("category")}>
          {ASSET_CATEGORIES.map((c) => (
            <option key={c} value={c}>{label(c)}</option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="asset-date">Acquired</Label>
        <Input id="asset-date" type="date" value={form.acquisitionDate} onChange={set("acquisitionDate")} required />
      </div>
      <div>
        <Label htmlFor="asset-cost">Cost</Label>
        <Input id="asset-cost" inputMode="decimal" value={form.cost} onChange={set("cost")} required />
      </div>
      <div>
        <Label htmlFor="asset-residual">Residual</Label>
        <Input id="asset-residual" inputMode="decimal" value={form.residual} onChange={set("residual")} placeholder="0.00" />
      </div>
      <div>
        <Label htmlFor="asset-life">Life (months)</Label>
        <Input id="asset-life" inputMode="numeric" value={form.life} onChange={set("life")} required />
      </div>
      {error ? <p className="text-sm text-destructive md:col-span-6" role="alert">{error}</p> : null}
      <div className="flex gap-2 md:col-span-6">
        <Button type="submit" size="sm" disabled={saving || !form.name.trim()}>{saving ? "Saving…" : "Save asset"}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

export default function FixedAssetsPage() {
  const { periods, periodId, setPeriodId } = useBooksShell();
  const [data, setData] = useState<Response | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!periodId) return;
    const controller = new AbortController();
    fetch(`/api/books/fixed-assets?periodId=${periodId}`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(String(json.error || "request_failed").replaceAll("_", " "));
          setData(null);
          return;
        }
        setError("");
        setData(json as Response);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name !== "AbortError") setError("Could not load the asset register.");
      });
    return () => controller.abort();
  }, [periodId, tick]);

  async function showSchedule(id: string) {
    const res = await fetch(`/api/books/fixed-assets/${id}/schedule`);
    if (res.ok) setSchedule((await res.json()) as Schedule);
  }

  async function dispose(asset: Asset) {
    const date = window.prompt(`Disposal date for ${asset.name} (YYYY-MM-DD)`, data?.asOf);
    if (!date) return;
    const res = await fetch(`/api/books/fixed-assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disposalDate: date }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) setError(ERRORS[String(json.error)] || String(json.error || "failed").replaceAll("_", " "));
    else setTick((n) => n + 1);
  }

  return (
    <div className="space-y-5 pb-10">
      <PageHeader
        title="Fixed assets"
        description="Asset register with straight-line depreciation, calculated from the acquisition month."
        actions={
          <label className="text-xs text-muted-foreground">
            Period
            <select className="ml-2 rounded-md border border-border bg-card px-2 py-1 text-sm" value={periodId} onChange={(e) => setPeriodId(e.target.value)} data-testid="asset-period">
              {periods.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
        }
      />
      <NewAsset onCreated={() => setTick((n) => n + 1)} />
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p> : null}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[900px] text-sm" data-testid="asset-table">
          <thead className="bg-muted/95">
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">Asset</th>
              <th scope="col" className="px-3 py-2 font-medium">Acquired</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Cost</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Period charge</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Accumulated</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Net book value</th>
              <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {data?.assets.map((a) => (
              <tr key={a.id} className="border-b border-border/60" data-testid="asset-row">
                <td className="px-3 py-2">
                  <span className="font-medium">{a.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{label(a.category)} · {a.usefulLifeMonths} months</span>
                  {a.disposalDate ? <span className="ml-2 text-xs text-amber-700">Disposed {a.disposalDate}</span> : null}
                </td>
                <td className="whitespace-nowrap px-3 py-2">{a.acquisitionDate}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMinor(a.costMinor)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMinor(a.periodChargeMinor)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMinor(a.accumulatedMinor)}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMinor(a.netBookValueMinor)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <Button variant="ghost" size="sm" onClick={() => showSchedule(a.id)}>Schedule</Button>
                  {!a.disposalDate ? <Button variant="ghost" size="sm" onClick={() => dispose(a)}>Dispose</Button> : null}
                </td>
              </tr>
            ))}
            {data && data.assets.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">No assets acquired by {data.asOf}.</td></tr>
            ) : null}
          </tbody>
          {data && data.assets.length ? (
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="px-3 py-3" colSpan={2}>Total as of {data.asOf}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatMinor(data.totals.costMinor)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatMinor(data.totals.periodChargeMinor)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatMinor(data.totals.accumulatedMinor)}</td>
                <td className="px-3 py-3 text-right tabular-nums" data-testid="asset-total-nbv">{formatMinor(data.totals.netBookValueMinor)}</td>
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {schedule ? (
        <div className="space-y-2" data-testid="asset-schedule">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Depreciation schedule: {schedule.name}</h2>
            <Button variant="ghost" size="sm" onClick={() => setSchedule(null)}>Close</Button>
          </div>
          <div className="max-h-96 overflow-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/95">
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">Month</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Charge</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Accumulated</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Net book value</th>
                </tr>
              </thead>
              <tbody>
                {schedule.schedule.map((s) => (
                  <tr key={s.month} className="border-b border-border/60">
                    <td className="px-3 py-1.5">{s.month}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatMinor(s.chargeMinor)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatMinor(s.accumulatedMinor)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatMinor(s.netBookValueMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        This register is for tracking and reporting. Post the depreciation charge to the ledger with a journal entry.
      </p>
    </div>
  );
}
