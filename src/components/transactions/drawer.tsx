"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { highlightStyle, type BBox } from "@/lib/highlight";
import { displayToMinor, formatMinor, MoneyTypeError } from "@/lib/money";

import type { Category, Txn } from "./types";

type Detail = Txn & {
  audit: { action: string; actor: string; diff: unknown; at: string }[];
  corrections: { field: string; oldValue: string | null; newValue: string | null; savedAsRule: boolean; at: string }[];
};

export function RecordDrawer({
  id,
  canWrite,
  categories,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onSaved,
}: {
  id: string;
  canWrite: boolean;
  categories: Category[];
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  onSaved: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");
  const [source, setSource] = useState<{ url: string; bbox: BBox | null } | null>(null);
  const [form, setForm] = useState({
    descriptionClean: "",
    counterparty: "",
    categoryId: "",
    txnDate: "",
    debit: "",
    credit: "",
    balance: "",
    reviewStatus: "ok",
    reference: "",
  });
  const [ruleType, setRuleType] = useState("contains");
  const [rulePattern, setRulePattern] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let stop = false;
    setDetail(null);
    setSource(null);
    setError("");
    setNotice("");
    fetch(`/api/transactions/${id}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("This row is not visible for the current client.");
        return response.json();
      })
      .then((row: Detail) => {
        if (stop) return;
        setDetail(row);
        setForm({
          descriptionClean: row.descriptionClean,
          counterparty: row.counterparty || "",
          categoryId: row.categoryId || "",
          txnDate: row.txnDate || "",
          debit: formatMinor(row.debitMinor),
          credit: formatMinor(row.creditMinor),
          balance: formatMinor(row.balanceMinor),
          reviewStatus: row.reviewStatus,
          reference: row.reference || "",
        });
        setRulePattern(row.descriptionClean);
      })
      .catch((reason: Error) => setError(reason.message));
    return () => {
      stop = true;
    };
  }, [id]);

  useEffect(() => {
    if (tab !== "source") return;
    let stop = false;
    fetch(`/api/transactions/${id}/source`)
      .then(async (response) => {
        if (!response.ok) throw new Error("No page image is stored for this row.");
        return response.json();
      })
      .then((payload) => {
        if (!stop) setSource({ url: payload.url, bbox: payload.bbox });
      })
      .catch((reason: Error) => {
        if (!stop) setError(reason.message);
      });
    return () => {
      stop = true;
    };
  }, [id, tab]);

  async function save() {
    if (!detail) return;
    setError("");
    try {
      const body: Record<string, unknown> = {};
      if (form.descriptionClean !== detail.descriptionClean) body.descriptionClean = form.descriptionClean;
      if (form.counterparty !== (detail.counterparty || "")) body.counterparty = form.counterparty || null;
      if (form.categoryId !== (detail.categoryId || "")) body.categoryId = form.categoryId || null;
      if (form.txnDate !== (detail.txnDate || "")) body.txnDate = form.txnDate || null;
      if (form.reference !== (detail.reference || "")) body.reference = form.reference || null;
      if (form.reviewStatus !== detail.reviewStatus) body.reviewStatus = form.reviewStatus;
      const debit = displayToMinor(form.debit);
      const credit = displayToMinor(form.credit);
      const balance = displayToMinor(form.balance);
      if (debit !== detail.debitMinor) body.debitMinor = debit;
      if (credit !== detail.creditMinor) body.creditMinor = credit;
      if (balance !== detail.balanceMinor) body.balanceMinor = balance;
      const response = await fetch(`/api/transactions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("The correction was not saved.");
      setNotice("Correction saved. No rule was created.");
      onSaved();
      const fresh = await fetch(`/api/transactions/${id}`).then((item) => item.json());
      setDetail(fresh);
    } catch (reason) {
      setError(reason instanceof MoneyTypeError ? "Enter amounts like 1,234.50." : (reason as Error).message);
    }
  }

  async function saveRule() {
    if (!form.categoryId || !rulePattern.trim()) {
      setError("A rule needs a pattern and a category.");
      return;
    }
    setError("");
    const response = await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchType: ruleType,
        pattern: rulePattern,
        categoryId: form.categoryId,
        transactionId: id,
      }),
    });
    if (!response.ok) {
      setError("The rule was not saved.");
      return;
    }
    setNotice("Rule saved. Future rows that match this pattern will be proposed, not confirmed.");
    const fresh = await fetch(`/api/transactions/${id}`).then((item) => item.json());
    setDetail(fresh);
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader className="border-b border-border pb-3">
          <div className="flex items-center justify-between gap-2 pr-8">
            <SheetTitle className="font-heading text-xl">Transaction</SheetTitle>
            <div className="flex gap-1">
              <Button variant="outline" size="icon-sm" disabled={!hasPrev} onClick={onPrev} aria-label="Previous transaction">
                <ChevronLeft />
              </Button>
              <Button variant="outline" size="icon-sm" disabled={!hasNext} onClick={onNext} aria-label="Next transaction">
                <ChevronRight />
              </Button>
            </div>
          </div>
        </SheetHeader>
        {error ? <p className="px-4 text-sm text-danger">{error}</p> : null}
        {notice ? <p className="px-4 text-sm text-ok">{notice}</p> : null}
        {!detail ? <p className="px-4 text-sm text-muted-foreground">Loading the row…</p> : null}
        {detail ? (
          <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="min-h-0 flex-1 overflow-hidden px-4 pb-4">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="source">Source</TabsTrigger>
              <TabsTrigger value="audit">Audit</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="mt-3 space-y-3 overflow-y-auto">
              <p className="text-xs text-muted-foreground" dir="auto">{detail.descriptionRaw}</p>
              <Field label="Description">
                <Input dir="auto" value={form.descriptionClean} disabled={!canWrite} onChange={(event) => setForm({ ...form, descriptionClean: event.target.value })} />
              </Field>
              <Field label="Counterparty">
                <Input dir="auto" value={form.counterparty} disabled={!canWrite} onChange={(event) => setForm({ ...form, counterparty: event.target.value })} />
              </Field>
              <Field label="Reference">
                <Input value={form.reference} disabled={!canWrite} onChange={(event) => setForm({ ...form, reference: event.target.value })} />
              </Field>
              <Field label="Date">
                <Input type="date" value={form.txnDate} disabled={!canWrite} onChange={(event) => setForm({ ...form, txnDate: event.target.value })} />
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Debit">
                  <Input className="nums text-right" value={form.debit} disabled={!canWrite} onChange={(event) => setForm({ ...form, debit: event.target.value })} />
                </Field>
                <Field label="Credit">
                  <Input className="nums text-right" value={form.credit} disabled={!canWrite} onChange={(event) => setForm({ ...form, credit: event.target.value })} />
                </Field>
                <Field label="Balance">
                  <Input className="nums text-right" value={form.balance} disabled={!canWrite} onChange={(event) => setForm({ ...form, balance: event.target.value })} />
                </Field>
              </div>
              <Field label="Category">
                <select className="h-8 w-full rounded-lg border border-input bg-card px-2 text-sm" value={form.categoryId} disabled={!canWrite} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
                  <option value="">Unclassified</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Review">
                <select className="h-8 w-full rounded-lg border border-input bg-card px-2 text-sm" value={form.reviewStatus} disabled={!canWrite} onChange={(event) => setForm({ ...form, reviewStatus: event.target.value })}>
                  <option value="ok">ok</option>
                  <option value="needs_review">needs review</option>
                  <option value="approved">approved</option>
                </select>
              </Field>
              <p className="text-xs text-muted-foreground">
                Classification is {detail.classStatus}. Match stays Unmatched until a later phase. Saving a correction does not create a rule.
              </p>
              {canWrite ? <Button onClick={save}>Save correction</Button> : <p className="text-sm text-muted-foreground">Viewers can read this row. They cannot edit it.</p>}
              {canWrite ? (
                <div className="space-y-2 rounded-lg border border-border bg-muted p-3">
                  <p className="text-sm font-medium">Save as rule</p>
                  <p className="text-xs text-muted-foreground">This button is the only way a correction becomes a rule.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <select className="h-8 rounded-lg border border-input bg-card px-2 text-sm" value={ruleType} onChange={(event) => setRuleType(event.target.value)}>
                      <option value="contains">contains</option>
                      <option value="exact">exact</option>
                      <option value="regex">regex</option>
                    </select>
                    <Input dir="auto" value={rulePattern} onChange={(event) => setRulePattern(event.target.value)} />
                  </div>
                  <Button variant="outline" onClick={saveRule}>Save as rule</Button>
                </div>
              ) : null}
            </TabsContent>
            <TabsContent value="source" className="mt-3 overflow-y-auto">
              {!source ? <p className="text-sm text-muted-foreground">Loading the source page…</p> : null}
              {source ? (
                <div className="relative inline-block max-w-full">
                  {/* Signed URL, short-lived. The file itself stays private. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={source.url} alt="Statement page with the selected row" className="max-w-full rounded-md border border-border" />
                  {source.bbox ? (
                    <div
                      data-testid="source-highlight"
                      className="pointer-events-none absolute border-2 border-brand-accent bg-brand-accent/25"
                      style={highlightStyle(source.bbox)}
                    />
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">This row has no stored coordinates.</p>
                  )}
                </div>
              ) : null}
            </TabsContent>
            <TabsContent value="audit" className="mt-3 space-y-3 overflow-y-auto">
              <h3 className="text-sm font-medium">Corrections</h3>
              {detail.corrections.length === 0 ? <p className="text-sm text-muted-foreground">No corrections yet.</p> : null}
              <ul className="space-y-2">
                {detail.corrections.map((item, index) => (
                  <li key={`${item.at}-${index}`} className="rounded-md border border-border px-3 py-2 text-xs">
                    <p>{item.field}: {item.oldValue || "—"} → {item.newValue || "—"}</p>
                    <p className="text-muted-foreground">{item.savedAsRule ? "Saved as a rule" : "Correction only"} · {new Date(item.at).toLocaleString()}</p>
                  </li>
                ))}
              </ul>
              <h3 className="text-sm font-medium">Audit log</h3>
              {detail.audit.length === 0 ? <p className="text-sm text-muted-foreground">No audit entries yet.</p> : null}
              <ul className="space-y-2">
                {detail.audit.map((item, index) => (
                  <li key={`${item.at}-${index}`} className="rounded-md border border-border px-3 py-2 text-xs">
                    <p>{item.action}</p>
                    <p className="font-mono text-muted-foreground">{JSON.stringify(item.diff)}</p>
                  </li>
                ))}
              </ul>
            </TabsContent>
          </Tabs>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Label className="block space-y-1 text-xs text-muted-foreground">
      {label}
      {children}
    </Label>
  );
}
