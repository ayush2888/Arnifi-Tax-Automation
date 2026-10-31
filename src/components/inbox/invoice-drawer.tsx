"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { BooksSideDrawer } from "@/components/books/side-drawer";
import { Button } from "@/components/ui/button";
import { displayToMinor, formatMinor } from "@/lib/money";
import { cn } from "@/lib/utils";

export type DrawerPeriod = { id: string; label: string; status: string };

type Line = {
  accountCode: string;
  accountName: string;
  debitMinor?: number;
  creditMinor?: number;
  originalCurrency?: string | null;
  originalMinor?: number | null;
  vat201Box?: string | null;
};

type Facts = {
  docKind?: string | null;
  invoiceNumber?: string | null;
  entryDate?: string | null;
  dueDate?: string | null;
  issuerName?: string | null;
  issuerTrn?: string | null;
  customerName?: string | null;
  customerTrn?: string | null;
  counterparty?: string | null;
  counterpartyTrn?: string | null;
  supplierTrn?: string | null;
  currency?: string | null;
  originalSubtotalMinor?: number | null;
  originalVatMinor?: number | null;
  fxRateScaled?: number | null;
  fxSource?: string | null;
  taxableMinor?: number | null;
  vatMinor?: number | null;
  totalMinor?: number | null;
  lineItems?: string[];
  method?: string;
  overallConfidence?: number;
  duplicateOf?: { documentId: string; periodLabel: string };
  editedBy?: string[];
};

export type DocumentDetail = {
  id: string;
  docType: string;
  originalName: string;
  status: string;
  periodId: string;
  periodLabel: string;
  createdBy: string;
  jobStatus: string | null;
  jobError: string | null;
  facts: Facts | null;
  warnings: string[];
  blockers: string[];
  fileUrl: string | null;
  mime: string | null;
  preview: { lines: Line[]; memo: string; vatRecoverable: boolean; totalAed: number } | null;
  previewError: string | null;
  posted: { entryId: string; entryDate: string; memo: string; lines: Line[] } | null;
  history: { action: string; at: string; actor: string | null; diff: Record<string, unknown> | null }[];
};

const MESSAGES: Record<string, string> = {
  not_a_tax_invoice: "This is a proforma / quotation, not a tax invoice. Upload the final tax invoice instead; proformas are never posted.",
  not_an_invoice: "We could not find the word “invoice” in this file. Check the document type.",
  missing_tax_invoice_title: "The document does not say “Tax Invoice”. UAE VAT rules require that title on tax invoices.",
  invoice_number_missing: "Invoice number is missing.",
  invoice_number_not_found: "We could not read the invoice number. Please type it in.",
  date_missing: "Invoice date is missing.",
  date_not_found: "We could not read the invoice date. Please type it in.",
  date_outside_month: "The invoice date is not in the selected month. Move it to the right month or correct the date.",
  fx_rate_needed: "Foreign currency: enter the AED exchange rate for the invoice date.",
  fx_rate_defaulted: "USD converted at the fixed CBUAE peg 3.6725. Change the rate if you used a different one.",
  amount_missing: "Net amount is missing.",
  total_not_found: "We could not read the total. Please type in the net amount and VAT.",
  vat_not_found: "No VAT amount found. If VAT was charged, type it in; otherwise leave it at 0.",
  prices_include_tax_not_split: "The document says prices include tax, but VAT is not shown separately.",
  totals_dont_add_up: "Net + VAT does not equal the total printed on the invoice. Please check the amounts.",
  vat_rate_not_5pct: "VAT is not 5% of the net amount. Check whether part of the invoice is zero-rated or exempt.",
  supplier_trn_missing: "No supplier TRN: input VAT cannot be recovered, so VAT will be booked as part of the expense.",
  possible_government_fees: "Contains government fees. These are pass-through costs with no VAT.",
  looks_like_purchase: "Your company is the customer on this invoice, so it looks like a purchase. Change the type to Purchase.",
  looks_like_sales: "Your company is the issuer on this invoice, so it looks like a sale. Change the type to Sales.",
  wrong_direction: "Sales/Purchase type does not match who issued the invoice.",
  company_not_issuer: "We could not find your company name as the issuer. Make sure this invoice belongs to this company.",
  company_not_customer: "We could not find your company name as the customer. Make sure this bill belongs to this company.",
  duplicate_invoice_number: "Another document already has this invoice number.",
  ocr_low_confidence: "This was a scan, read with OCR. Please double-check every field.",
  currency_assumed_aed: "No currency shown; assumed AED.",
  unsupported_doc_type: "Only sales and purchase invoices can be posted from here.",
};

const DOC_KINDS = [
  ["TAX_INVOICE", "Tax invoice"],
  ["INVOICE", "Invoice (no “Tax Invoice” title)"],
  ["PROFORMA", "Proforma (not postable)"],
  ["QUOTATION", "Quotation (not postable)"],
  ["CREDIT_NOTE", "Credit note"],
  ["UNKNOWN", "Not an invoice"],
] as const;

function rateToText(scaled: number | null | undefined) {
  if (!scaled) return "";
  const s = String(scaled).padStart(9, "0");
  const int = s.slice(0, -8);
  const frac = s.slice(-8).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

function textToRate(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d+(\.\d{1,8})?$/.test(t)) throw new Error("Exchange rate must be a number like 3.6725");
  const [int, frac = ""] = t.split(".");
  return Number(int) * 100_000_000 + Number(frac.padEnd(8, "0"));
}

function money(minor: number | null | undefined) {
  return minor === null || minor === undefined ? "" : formatMinor(minor);
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-xs font-medium text-muted-foreground">
      {label}
      <div className="mt-1 text-sm text-foreground">{children}</div>
      {hint ? <span className="mt-0.5 block text-[11px] font-normal">{hint}</span> : null}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-muted/40";

function LinesTable({ lines }: { lines: Line[] }) {
  const dr = lines.reduce((a, l) => a + (l.debitMinor ?? 0), 0);
  const cr = lines.reduce((a, l) => a + (l.creditMinor ?? 0), 0);
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs text-muted-foreground">
          <th className="py-1.5 font-medium">Account</th>
          <th className="py-1.5 text-right font-medium">Debit (AED)</th>
          <th className="py-1.5 text-right font-medium">Credit (AED)</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i} className="border-b border-border/60 align-top">
            <td className="py-1.5">
              <div>
                {l.accountCode} · {l.accountName}
              </div>
              {l.originalCurrency && l.originalMinor != null ? (
                <div className="text-[11px] text-muted-foreground">
                  {l.originalCurrency} {formatMinor(l.originalMinor)}
                </div>
              ) : null}
              {l.vat201Box ? <div className="text-[11px] text-muted-foreground">VAT return box {l.vat201Box}</div> : null}
            </td>
            <td className="py-1.5 text-right tabular-nums">{l.debitMinor ? formatMinor(l.debitMinor) : ""}</td>
            <td className="py-1.5 text-right tabular-nums">{l.creditMinor ? formatMinor(l.creditMinor) : ""}</td>
          </tr>
        ))}
        <tr className="font-medium">
          <td className="py-1.5">Total</td>
          <td className="py-1.5 text-right tabular-nums">{formatMinor(dr)}</td>
          <td className="py-1.5 text-right tabular-nums">{formatMinor(cr)}</td>
        </tr>
      </tbody>
    </table>
  );
}

export function InvoiceDrawer({
  documentId,
  onClose,
  onChanged,
  periods,
  me,
}: {
  documentId: string | null;
  onClose: () => void;
  onChanged: () => void;
  periods: DrawerPeriod[];
  me: { id: string; role: string } | null;
}) {
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [tab, setTab] = useState("extracted");
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sessionMe, setSessionMe] = useState(me);

  useEffect(() => {
    setSessionMe(me);
  }, [me]);

  async function refreshMe() {
    try {
      const s = await fetch("/api/session").then((r) => r.json());
      if (s?.me) setSessionMe({ id: String(s.me.id), role: String(s.me.role) });
    } catch {
      /* keep last known */
    }
  }

  async function load(id: string) {
    const res = await fetch(`/api/documents/${id}`);
    const body = await res.json();
    if (!res.ok) {
      setError(body.message || body.error || "Could not load document.");
      return null;
    }
    setDetail(body);
    const f: Facts = body.facts || {};
    setForm({
      docType: body.docType,
      periodId: body.periodId,
      docKind: f.docKind || "",
      invoiceNumber: f.invoiceNumber || "",
      entryDate: f.entryDate || "",
      dueDate: f.dueDate || "",
      counterparty: f.counterparty || "",
      counterpartyTrn: f.counterpartyTrn || "",
      supplierTrn: f.supplierTrn || "",
      currency: f.currency || "AED",
      net: money(f.originalSubtotalMinor),
      vat: money(f.originalVatMinor ?? 0),
      rate: rateToText(f.fxRateScaled),
    });
    return body as DocumentDetail;
  }

  useEffect(() => {
    setDetail(null);
    setError("");
    setNotice("");
    setTab("extracted");
    if (!documentId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const d = await load(documentId);
      const reading = d && (d.jobStatus === "queued" || d.jobStatus === "running");
      if (!stop && reading) timer = setTimeout(tick, 1500);
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  useEffect(() => {
    if (!documentId) return;
    void refreshMe();
    const onFocus = () => void refreshMe();
    window.addEventListener("focus", onFocus);
    window.addEventListener("arnibooks:session", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("arnibooks:session", onFocus);
    };
  }, [documentId, tab]);

  const posted = detail?.status === "posted";
  const removed = detail?.status === "rejected";
  const reading = detail?.jobStatus === "queued" || detail?.jobStatus === "running";
  const editable = Boolean(detail && !posted && !removed && detail.facts);
  const isSales = form.docType === "SALES_INVOICE";
  const foreign = (form.currency || "AED").toUpperCase() !== "AED";

  const preparers = new Set([detail?.createdBy, ...(detail?.facts?.editedBy || [])]);
  const canApproveRole = sessionMe?.role === "admin" || sessionMe?.role === "approver";
  const isPreparer = Boolean(sessionMe && preparers.has(sessionMe.id));
  const blockers = detail?.blockers || [];

  async function call(label: string, url: string, init: RequestInit, okText: string) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const raw = String(body.message || body.error || "Request failed");
        const keys = raw.startsWith("not_ready:") ? raw.slice(10).split(",") : [raw];
        setError(keys.map((k) => MESSAGES[k] || k.replace(/_/g, " ")).join(" "));
        return false;
      }
      setNotice(okText);
      onChanged();
      if (documentId) await load(documentId);
      return true;
    } finally {
      setBusy("");
    }
  }

  async function save() {
    if (!detail) return;
    let facts: Record<string, unknown>;
    try {
      facts = {
        docKind: form.docKind || null,
        invoiceNumber: form.invoiceNumber.trim() || null,
        entryDate: form.entryDate || null,
        dueDate: form.dueDate || null,
        counterparty: form.counterparty.trim() || null,
        counterpartyTrn: form.counterpartyTrn.trim() || null,
        supplierTrn: isSales ? (detail.facts?.supplierTrn ?? null) : form.counterpartyTrn.trim() || null,
        currency: (form.currency || "AED").toUpperCase(),
        originalSubtotalMinor: displayToMinor(form.net),
        originalVatMinor: displayToMinor(form.vat) ?? 0,
        fxRateScaled: foreign ? textToRate(form.rate) : null,
      };
    } catch (e) {
      setError(e instanceof Error && e.message.includes("rate") ? e.message : "Amounts must look like 1,234.50");
      return;
    }
    await call(
      "save",
      `/api/documents/${detail.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          facts,
          docType: form.docType !== detail.docType ? form.docType : undefined,
          periodId: form.periodId !== detail.periodId ? form.periodId : undefined,
        }),
      },
      "Saved. The journal preview has been updated.",
    );
  }

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const title = detail
    ? `${isSales ? "Sales invoice" : "Purchase invoice"} · ${detail.periodLabel}`
    : "Loading…";

  return (
    <BooksSideDrawer
      open={Boolean(documentId)}
      onOpenChange={(open) => (!open ? onClose() : undefined)}
      title={title}
      entryNo={detail?.facts?.invoiceNumber || detail?.originalName || "Document"}
      className="data-[side=right]:sm:max-w-3xl"
      tabs={[
        { id: "extracted", label: "What we read" },
        { id: "journal", label: posted ? "Posted journal" : "Journal preview" },
        { id: "file", label: "File" },
        { id: "history", label: "History" },
      ]}
      activeTab={tab}
      onTabChange={setTab}
    >
      {!detail ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-4" data-testid="invoice-drawer">
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-red-50 px-3 py-2 text-sm text-destructive">{error}</p>
          ) : null}
          {notice ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>
          ) : null}

          {tab === "extracted" ? (
            <>
              {reading ? (
                <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary-subtle/40 px-3 py-3 text-sm">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  Reading the invoice… this usually takes a few seconds.
                </div>
              ) : null}
              {detail.jobStatus === "failed" ? (
                <div className="rounded-md border border-destructive/30 bg-red-50 px-3 py-2 text-sm text-destructive">
                  We could not read this file ({detail.jobError || "unknown error"}). Try “Read again”, or type the fields in.
                </div>
              ) : null}
              {!detail.facts && !reading && detail.jobStatus !== "failed" ? (
                <p className="text-sm text-muted-foreground">
                  Not read yet. Click “Read again” to extract the invoice fields.
                </p>
              ) : null}

              {posted ? (
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  <CheckCircle2 className="size-4" /> Posted to the journal. Posted entries cannot be edited; corrections
                  are made with a reversal.
                </div>
              ) : null}
              {removed ? (
                <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                  Removed. It is kept for the audit trail but will never be posted.
                </p>
              ) : null}

              {detail.facts && (blockers.length || detail.warnings.length) && !posted ? (
                <div className="space-y-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
                  {blockers.map((b) => (
                    <p key={`b-${b}`} className="flex gap-2 text-sm text-amber-900">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      <span>
                        <strong>Must fix before posting:</strong>{" "}
                        {b === "wrong_direction"
                          ? MESSAGES[isSales ? "looks_like_purchase" : "looks_like_sales"]
                          : MESSAGES[b] || b}
                      </span>
                    </p>
                  ))}
                  {detail.warnings
                    .filter((w) => !blockers.includes(w))
                    .filter((w) => !(blockers.includes("wrong_direction") && w.startsWith("looks_like_")))
                    .map((w) => (
                      <p key={`w-${w}`} className="text-sm text-amber-900">
                        • {MESSAGES[w] || w}
                        {w === "duplicate_invoice_number" && detail.facts?.duplicateOf
                          ? ` (in ${detail.facts.duplicateOf.periodLabel})`
                          : ""}
                      </p>
                    ))}
                </div>
              ) : null}

              {detail.facts ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Type">
                    <select className={inputCls} value={form.docType} onChange={set("docType")} disabled={!editable}>
                      <option value="SALES_INVOICE">Sales (we issued it)</option>
                      <option value="PURCHASE_INVOICE">Purchase (we received it)</option>
                    </select>
                  </Field>
                  <Field label="Month">
                    <select className={inputCls} value={form.periodId} onChange={set("periodId")} disabled={!editable}>
                      {periods.map((p) => (
                        <option key={p.id} value={p.id} disabled={p.status !== "OPEN" && p.status !== "REOPENED"}>
                          {p.label}
                          {p.status !== "OPEN" && p.status !== "REOPENED" ? " (locked)" : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Document">
                    <select className={inputCls} value={form.docKind} onChange={set("docKind")} disabled={!editable}>
                      {DOC_KINDS.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Invoice number">
                    <input className={inputCls} value={form.invoiceNumber} onChange={set("invoiceNumber")} disabled={!editable} />
                  </Field>
                  <Field label="Invoice date">
                    <input type="date" className={inputCls} value={form.entryDate} onChange={set("entryDate")} disabled={!editable} />
                  </Field>
                  <Field label="Due date">
                    <input type="date" className={inputCls} value={form.dueDate} onChange={set("dueDate")} disabled={!editable} />
                  </Field>
                  <Field label={isSales ? "Customer" : "Supplier"}>
                    <input className={inputCls} value={form.counterparty} onChange={set("counterparty")} disabled={!editable} />
                  </Field>
                  <Field
                    label={isSales ? "Customer TRN" : "Supplier TRN"}
                    hint={isSales ? undefined : "Needed to recover input VAT."}
                  >
                    <input className={inputCls} value={form.counterpartyTrn} onChange={set("counterpartyTrn")} disabled={!editable} />
                  </Field>
                  <Field label="Currency">
                    <input className={inputCls} value={form.currency} onChange={set("currency")} maxLength={3} disabled={!editable} />
                  </Field>
                  {foreign ? (
                    <Field
                      label={`Rate (AED per 1 ${form.currency.toUpperCase()})`}
                      hint={detail.facts.fxSource === "usd_peg_default" ? "Default: CBUAE USD peg." : undefined}
                    >
                      <input className={inputCls} value={form.rate} onChange={set("rate")} disabled={!editable} />
                    </Field>
                  ) : (
                    <div />
                  )}
                  <Field label={`Net amount (${form.currency || "AED"})`}>
                    <input className={cn(inputCls, "text-right tabular-nums")} value={form.net} onChange={set("net")} disabled={!editable} />
                  </Field>
                  <Field label={`VAT (${form.currency || "AED"})`}>
                    <input className={cn(inputCls, "text-right tabular-nums")} value={form.vat} onChange={set("vat")} disabled={!editable} />
                  </Field>
                  <div className="rounded-md bg-muted/40 px-3 py-2 text-sm sm:col-span-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total in AED</span>
                      <span className="font-medium tabular-nums">AED {money(detail.facts.totalMinor)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Net AED {money(detail.facts.taxableMinor)}</span>
                      <span>VAT AED {money(detail.facts.vatMinor)}</span>
                    </div>
                  </div>
                  {detail.facts.lineItems?.length ? (
                    <div className="sm:col-span-2">
                      <p className="text-xs font-medium text-muted-foreground">Line items on the invoice</p>
                      <ul className="mt-1 list-disc pl-5 text-sm">
                        {detail.facts.lineItems.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <p className="text-[11px] text-muted-foreground sm:col-span-2">
                    Issuer: {detail.facts.issuerName || "—"} {detail.facts.issuerTrn ? `(TRN ${detail.facts.issuerTrn})` : ""} · Bill
                    to: {detail.facts.customerName || "—"} {detail.facts.customerTrn ? `(TRN ${detail.facts.customerTrn})` : ""} · Read
                    from {detail.facts.method === "ocr" ? "a scan (OCR)" : "the PDF text"}
                  </p>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                {editable ? (
                  <Button size="sm" onClick={() => void save()} disabled={Boolean(busy)}>
                    {busy === "save" ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Save changes
                  </Button>
                ) : null}
                {!posted ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={Boolean(busy) || reading}
                    onClick={() =>
                      void call("extract", `/api/documents/${detail.id}/extract`, { method: "POST", body: "{}" }, "Reading the file again…")
                    }
                  >
                    <RefreshCw className="size-3.5" /> Read again
                  </Button>
                ) : null}
                {!posted && !removed ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void call(
                        "remove",
                        `/api/documents/${detail.id}/remove`,
                        { method: "POST", body: JSON.stringify({ reason: "removed from inbox" }) },
                        "Removed. It will not be posted.",
                      )
                    }
                  >
                    <Trash2 className="size-3.5" /> Remove
                  </Button>
                ) : null}
                {editable ? (
                  <Button size="sm" variant="ghost" onClick={() => setTab("journal")}>
                    Next: check the journal →
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}

          {tab === "journal" ? (
            <div className="space-y-3">
              {posted && detail.posted ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Posted on {detail.posted.entryDate}: {detail.posted.memo}
                  </p>
                  <LinesTable lines={detail.posted.lines} />
                  <Link href="/journals" className="text-sm font-medium text-primary hover:underline">
                    Open in Journals →
                  </Link>
                </>
              ) : detail.preview ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    This is the entry that will be posted when an approver clicks “Approve &amp; post”. Amounts are in AED;
                    the original currency is kept on each line.
                  </p>
                  <LinesTable lines={detail.preview.lines} />
                  {!isSales && (detail.facts?.vatMinor ?? 0) > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {detail.preview.vatRecoverable
                        ? "Input VAT is recoverable (supplier TRN present) and goes to VAT return box 9."
                        : "Input VAT is NOT recoverable (no supplier TRN / not a tax invoice), so it is added to the expense."}
                    </p>
                  ) : null}
                  <div className="space-y-2 border-t border-border pt-3">
                    {blockers.length ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        <p className="font-medium">Cannot post yet — fix these on “What we read”:</p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                          {blockers.map((b) => (
                            <li key={b}>{MESSAGES[b] || b.replace(/_/g, " ")}</li>
                          ))}
                        </ul>
                      </div>
                    ) : !canApproveRole ? (
                      <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                        <p className="font-medium">Ready — needs an approver</p>
                        <p className="mt-1 text-muted-foreground">
                          You are signed in as an accountant. In the top bar (or bottom of the left sidebar), open{" "}
                          <strong>Working as</strong> and choose <strong>Layla Hassan · Approver</strong>, then click
                          Approve &amp; post.
                        </p>
                      </div>
                    ) : isPreparer ? (
                      <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                        <p className="font-medium">Dual control: you cannot post this one</p>
                        <p className="mt-1 text-muted-foreground">
                          You uploaded or edited this document. Use <strong>Working as</strong> in the top bar and pick
                          Layla Hassan · Approver, then Approve &amp; post.
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Looks good. Click Approve &amp; post to write the journal entry.
                      </p>
                    )}
                    <Button
                      size="sm"
                      disabled={Boolean(busy) || blockers.length > 0 || !canApproveRole || isPreparer}
                      title={
                        blockers.length
                          ? "Fix blockers on What we read first"
                          : !canApproveRole
                            ? "Switch to an approver user (Layla) first"
                            : isPreparer
                              ? "A different approver must post (dual control)"
                              : "Post to the journal"
                      }
                      onClick={() =>
                        void call(
                          "post",
                          `/api/documents/${detail.id}/approve-post`,
                          { method: "POST", body: "{}" },
                          "Posted. The journal, trial balance and VAT for this month now include this invoice.",
                        )
                      }
                    >
                      {busy === "post" ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      Approve &amp; post
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {detail.previewError ? `Cannot build the entry: ${detail.previewError}` : "No journal yet: the invoice has not been read."}
                </p>
              )}
            </div>
          ) : null}

          {tab === "file" ? (
            detail.fileUrl ? (
              detail.mime?.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={detail.fileUrl} alt={detail.originalName} className="w-full rounded-md border border-border" />
              ) : (
                <iframe title={detail.originalName} src={detail.fileUrl} className="h-[75vh] w-full rounded-md border border-border" />
              )
            ) : (
              <p className="text-sm text-muted-foreground">File preview is not available.</p>
            )
          ) : null}

          {tab === "history" ? (
            <ul className="space-y-2 text-sm">
              {detail.history.length === 0 ? <li className="text-muted-foreground">No history yet.</li> : null}
              {detail.history.map((h, i) => (
                <li key={i} className="rounded-md border border-border px-3 py-2">
                  <div className="flex justify-between">
                    <span className="font-medium">{h.action.replace(/_/g, " ")}</span>
                    <span className="text-xs text-muted-foreground">{new Date(h.at).toLocaleString()}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{h.actor || "system (worker)"}</div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </BooksSideDrawer>
  );
}
