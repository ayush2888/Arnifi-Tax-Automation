"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PARTY_TYPES } from "@/server/books/subsidiary-ledger-core";

type Party = {
  id: string;
  name: string;
  partyType: string;
  trn: string | null;
  email: string | null;
  active: boolean;
};

const ERRORS: Record<string, string> = {
  party_exists: "A party with that name and type already exists.",
  party_name_required: "Enter a name.",
  party_trn_invalid: "A UAE TRN has 15 digits and starts with 1.",
  party_email_invalid: "Enter a valid email address.",
  forbidden: "Your role cannot change parties.",
};

const titleCase = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

export default function PartiesPage() {
  const [parties, setParties] = useState<Party[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", partyType: "customer", trn: "", email: "" });

  useEffect(() => {
    const controller = new AbortController();
    const qs = new URLSearchParams();
    if (showInactive) qs.set("includeInactive", "1");
    if (typeFilter) qs.set("type", typeFilter);
    setLoading(true);
    fetch(`/api/books/parties?${qs}`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(ERRORS[String(json.error)] || String(json.error || "request_failed").replaceAll("_", " "));
          return;
        }
        setError("");
        setParties(json as Party[]);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name !== "AbortError") setError("Could not load parties.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [showInactive, typeFilter, tick]);

  const send = useCallback(async (url: string, method: string, body: unknown) => {
    setError("");
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(ERRORS[String(json.error)] || String(json.error || "failed").replaceAll("_", " "));
      return false;
    }
    setTick((n) => n + 1);
    return true;
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    const ok = await send("/api/books/parties", "POST", {
      name: draft.name,
      partyType: draft.partyType,
      trn: draft.trn || null,
      email: draft.email || null,
    });
    if (ok) setDraft((d) => ({ ...d, name: "", trn: "", email: "" }));
  }

  const [edit, setEdit] = useState({ name: "", partyType: "customer", trn: "", email: "" });
  function startEdit(p: Party) {
    setEditing(p.id);
    setEdit({ name: p.name, partyType: p.partyType, trn: p.trn || "", email: p.email || "" });
  }
  async function saveEdit(id: string) {
    const ok = await send(`/api/books/parties/${id}`, "PATCH", {
      name: edit.name,
      partyType: edit.partyType,
      trn: edit.trn || null,
      email: edit.email || null,
    });
    if (ok) setEditing(null);
  }

  const select = "h-9 rounded-md border border-border bg-background px-2 text-sm";

  return (
    <div className="space-y-5 pb-10">
      <PageHeader
        title="Parties"
        description="Customers, suppliers, lenders, shareholders and other counterparties used to tag journal lines."
      />
      <form onSubmit={create} className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-5" data-testid="party-create">
        <div className="md:col-span-2">
          <Label htmlFor="np-name">Name</Label>
          <Input id="np-name" value={draft.name} maxLength={200} required onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="np-type">Type</Label>
          <select id="np-type" className={`${select} w-full`} value={draft.partyType} onChange={(e) => setDraft({ ...draft, partyType: e.target.value })}>
            {PARTY_TYPES.map((t) => (
              <option key={t} value={t}>{titleCase(t)}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="np-trn">TRN</Label>
          <Input id="np-trn" inputMode="numeric" value={draft.trn} onChange={(e) => setDraft({ ...draft, trn: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="np-email">Email</Label>
          <Input id="np-email" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
        </div>
        <div className="md:col-span-5">
          <Button type="submit" size="sm" disabled={!draft.name.trim()}>Add party</Button>
        </div>
      </form>

      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          Type
          <select className={select} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} data-testid="party-filter">
            <option value="">All</option>
            {PARTY_TYPES.map((t) => (
              <option key={t} value={t}>{titleCase(t)}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[720px] text-sm" data-testid="party-table">
          <thead className="bg-muted/95">
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">Name</th>
              <th scope="col" className="px-3 py-2 font-medium">Type</th>
              <th scope="col" className="px-3 py-2 font-medium">TRN</th>
              <th scope="col" className="px-3 py-2 font-medium">Email</th>
              <th scope="col" className="px-3 py-2 font-medium">Status</th>
              <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {parties.map((p) =>
              editing === p.id ? (
                <tr key={p.id} className="border-b border-border/60 bg-muted/20" data-testid="party-row">
                  <td className="px-3 py-2"><Input aria-label="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></td>
                  <td className="px-3 py-2">
                    <select aria-label="Type" className={select} value={edit.partyType} onChange={(e) => setEdit({ ...edit, partyType: e.target.value })}>
                      {PARTY_TYPES.map((t) => (
                        <option key={t} value={t}>{titleCase(t)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2"><Input aria-label="TRN" value={edit.trn} onChange={(e) => setEdit({ ...edit, trn: e.target.value })} /></td>
                  <td className="px-3 py-2"><Input aria-label="Email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></td>
                  <td />
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <Button size="sm" onClick={() => saveEdit(p.id)}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </td>
                </tr>
              ) : (
                <tr key={p.id} className="border-b border-border/60" data-testid="party-row">
                  <td className="px-3 py-2 font-medium">{p.name}</td>
                  <td className="px-3 py-2">{titleCase(p.partyType)}</td>
                  <td className="px-3 py-2 tabular-nums">{p.trn || "—"}</td>
                  <td className="px-3 py-2">{p.email || "—"}</td>
                  <td className="px-3 py-2">{p.active ? "Active" : <span className="text-amber-700">Inactive</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(p)}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => send(`/api/books/parties/${p.id}`, "PATCH", { active: !p.active })}>
                      {p.active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </td>
                </tr>
              ),
            )}
            {!loading && parties.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">No parties yet. Add one above.</td></tr>
            ) : null}
            {loading && parties.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">Loading parties…</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Deactivating a party hides it from the journal entry picker. Its past postings and statements stay intact.
      </p>
    </div>
  );
}
