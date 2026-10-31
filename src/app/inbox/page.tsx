"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, FileText, Landmark, Loader2, Upload } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { useBooksShell } from "@/components/books/books-shell-context";
import { InvoiceDrawer } from "@/components/inbox/invoice-drawer";
import { formatMinor } from "@/lib/money";
import { cn } from "@/lib/utils";

type DocumentRow = {
  id: string;
  periodId: string;
  periodLabel: string;
  periodStart: string;
  docType: string;
  originalName: string;
  status: string;
  createdAt: string;
  jobStatus: string | null;
  invoiceNumber: string | null;
  entryDate: string | null;
  counterparty: string | null;
  currency: string | null;
  originalTotalMinor: number | null;
  totalAedMinor: number | null;
  docKind: string | null;
  warnings: string[];
  blockers: string[];
};

type DocType = "SALES_INVOICE" | "PURCHASE_INVOICE";

function docTypeLabel(type: string) {
  if (type === "SALES_INVOICE") return "Sales";
  if (type === "PURCHASE_INVOICE") return "Purchase";
  return type;
}

function stage(doc: DocumentRow): { label: string; tone: "ok" | "warn" | "danger" | "info" | "neutral" } {
  if (doc.status === "posted") return { label: "Posted", tone: "ok" };
  if (doc.status === "rejected") return { label: "Removed", tone: "neutral" };
  if (doc.jobStatus === "queued" || doc.jobStatus === "running") return { label: "Reading…", tone: "info" };
  if (doc.jobStatus === "failed") return { label: "Could not read", tone: "danger" };
  if (doc.status === "uploaded") return { label: "Not read yet", tone: "neutral" };
  if (doc.blockers.length) return { label: "Needs fixing", tone: "warn" };
  return { label: "Ready for approval", tone: "info" };
}

const STEPS = [
  ["Upload", "Pick the month and Sales / Purchase, then drop the PDFs."],
  ["We read it", "Invoice no., date, customer or supplier, TRNs, currency, net, VAT and total."],
  ["You check", "Click a row: fix anything wrong, see the warnings and the journal preview."],
  ["Approver posts", "A second person clicks Approve & post (dual control)."],
  ["Books update", "Journal → ledger → trial balance → VAT return for that month."],
] as const;

export default function InboxPage() {
  const { periods, periodId, setPeriodId } = useBooksShell();
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [docType, setDocType] = useState<DocType>("SALES_INVOICE");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [monthFilter, setMonthFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showRemoved, setShowRemoved] = useState(false);
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetch("/api/documents/all")
      .then((r) => r.json())
      .then((rows) => setDocuments(Array.isArray(rows) ? rows : []))
      .catch(() => setError("Could not load documents."))
      .finally(() => setLoadingDocs(false));
  }, []);

  useEffect(() => {
    load();
    fetch("/api/session")
      .then((r) => r.json())
      .then((s) => setMe(s?.me ? { id: String(s.me.id), role: String(s.me.role) } : null))
      .catch(() => setMe(null));
  }, [load]);

  // Deep link from Journals: /inbox?document=<uuid>
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = new URLSearchParams(window.location.search).get("document");
    if (id && /^[0-9a-f-]{36}$/i.test(id)) setOpenId(id);
  }, []);

  const anyReading = documents.some((d) => d.jobStatus === "queued" || d.jobStatus === "running");
  useEffect(() => {
    if (!anyReading) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [anyReading, load]);

  async function onUpload(files: FileList | null) {
    if (!files?.length || !periodId) return;
    setError("");
    setMessage("");
    setBusy(true);
    const monthLabel = periods.find((p) => p.id === periodId)?.label || "the selected month";
    const notes: string[] = [];
    try {
      const session = await fetch("/api/session").then((r) => r.json());
      const clientId = String(session.clientId || "");
      if (!clientId) {
        setError("No company selected. Create or switch to a company from Home.");
        return;
      }
      for (const file of Array.from(files)) {
        const buf = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]!);
        const upload = await fetch("/api/inbox/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            originalName: file.name,
            detectedMime: file.type || "application/octet-stream",
            contentBase64: btoa(binary),
          }),
        });
        if (!upload.ok) {
          setError(`Upload failed for ${file.name}`);
          return;
        }
        const payload = await upload.json();
        const inboxId = payload.id || payload.inboxId;
        const routed = await fetch("/api/inbox/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inboxId, clientId, periodId, docType }),
        });
        const result = await routed.json().catch(() => ({}));
        if (!routed.ok) {
          setError(`Could not attach ${file.name}: ${result.message || result.error || "error"}`);
          return;
        }
        if (result.duplicate) notes.push(`${file.name} was already uploaded (${result.duplicatePeriodLabel}); not added twice.`);
      }
      setMessage(
        [
          `Uploaded to ${monthLabel}. We are reading the invoice now; click a row to see what was extracted.`,
          ...notes,
        ].join(" "),
      );
      setMonthFilter("all");
      load();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const visible = useMemo(
    () =>
      documents.filter(
        (d) =>
          (monthFilter === "all" || d.periodId === monthFilter) &&
          (typeFilter === "all" || d.docType === typeFilter) &&
          (showRemoved || d.status !== "rejected"),
      ),
    [documents, monthFilter, typeFilter, showRemoved],
  );

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; start: string; rows: DocumentRow[] }>();
    for (const d of visible) {
      const g = map.get(d.periodId) || { label: d.periodLabel, start: d.periodStart, rows: [] };
      g.rows.push(d);
      map.set(d.periodId, g);
    }
    return [...map.entries()].sort((a, b) => a[1].start.localeCompare(b[1].start));
  }, [visible]);

  const monthsWithDocs = useMemo(() => {
    const seen = new Map<string, { label: string; start: string; count: number }>();
    for (const d of documents) {
      if (d.status === "rejected" && !showRemoved) continue;
      const m = seen.get(d.periodId) || { label: d.periodLabel, start: d.periodStart, count: 0 };
      m.count += 1;
      seen.set(d.periodId, m);
    }
    return [...seen.entries()].sort((a, b) => a[1].start.localeCompare(b[1].start));
  }, [documents, showRemoved]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Inbox"
        description="Sales invoices and purchase bills. Upload, check what we read, then an approver posts them to the journal."
        actions={
          <Link href="/statements" className="ab-soft-btn">
            <Landmark className="size-3.5" />
            Bank statements
          </Link>
        }
      />

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-red-50 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}
      {message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>
      ) : null}

      <section className="ab-panel overflow-hidden">
        <div className="flex items-start gap-3 border-b border-border/80 bg-gradient-to-r from-primary-subtle via-primary-subtle/40 to-transparent px-5 py-4">
          <span className="mt-0.5 inline-flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[var(--brand-accent)] text-primary-foreground shadow-md shadow-primary/25">
            <FileText className="size-4" />
          </span>
          <div>
            <h2 className="font-heading text-base font-semibold">Upload invoices</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Choose the month the invoice belongs to and its type, then drop PDFs or images. Bank files go to Bank
              statements.
            </p>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-medium">
              Month
              <select
                className="mt-1.5 block w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm transition-colors hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
              >
                {periods.length === 0 ? <option value="">No months yet</option> : null}
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.status})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Document type
              <select
                className="mt-1.5 block w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm transition-colors hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={docType}
                onChange={(e) => setDocType(e.target.value as DocType)}
              >
                <option value="SALES_INVOICE">Sales invoice (we issued it)</option>
                <option value="PURCHASE_INVOICE">Purchase invoice (we received it)</option>
              </select>
            </label>
          </div>

          <div
            className={cn(
              "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-all",
              dragging
                ? "border-primary bg-primary-subtle/70"
                : "border-border bg-surface-muted/40 hover:border-primary/40 hover:bg-primary-subtle/30",
              (busy || !periodId) && "opacity-70",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void onUpload(e.dataTransfer.files);
            }}
          >
            <span className="mb-3 inline-flex size-12 items-center justify-center rounded-2xl bg-primary-subtle text-primary">
              {busy ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
            </span>
            <p className="text-sm font-medium">{busy ? "Uploading…" : "Drag & drop invoices here"}</p>
            <p className="mt-1 text-xs text-muted-foreground">PDF or image · multiple files OK</p>
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.heic"
              disabled={busy || !periodId}
              onChange={(e) => void onUpload(e.target.files)}
            />
            <Button type="button" className="mt-4" disabled={busy || !periodId} onClick={() => inputRef.current?.click()}>
              Choose files
            </Button>
          </div>

          <ol className="grid gap-2 text-xs sm:grid-cols-5" aria-label="What happens after upload">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="rounded-lg border border-border bg-background px-3 py-2">
                <div className="font-medium text-foreground">
                  {i + 1}. {title}
                </div>
                <div className="mt-0.5 text-muted-foreground">{body}</div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="ab-panel overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/80 px-5 py-4">
          <div>
            <h2 className="font-heading text-base font-semibold">All documents</h2>
            <p className="text-sm text-muted-foreground">Every month is listed. Click a row to see what we extracted.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter by month">
              <button
                type="button"
                className={cn("ab-chip", monthFilter === "all" && "ab-chip-active")}
                onClick={() => setMonthFilter("all")}
              >
                All months
              </button>
              {monthsWithDocs.map(([id, m]) => (
                <button
                  key={id}
                  type="button"
                  className={cn("ab-chip", monthFilter === id && "ab-chip-active")}
                  onClick={() => setMonthFilter(id)}
                >
                  {m.label} · {m.count}
                </button>
              ))}
            </div>
            <select
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Filter by type"
            >
              <option value="all">Sales + Purchase</option>
              <option value="SALES_INVOICE">Sales only</option>
              <option value="PURCHASE_INVOICE">Purchase only</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} />
              Show removed
            </label>
          </div>
        </div>

        {loadingDocs && documents.length === 0 ? (
          <div className="flex items-center gap-2 px-5 py-10 text-sm text-muted-foreground">
            <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Loading…
          </div>
        ) : groups.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">No sales or purchase documents yet.</p>
        ) : (
          groups.map(([pid, group]) => (
            <div key={pid}>
              <div className="flex items-center justify-between bg-muted/40 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span>{group.label}</span>
                <span>
                  {group.rows.filter((r) => r.docType === "SALES_INVOICE").length} sales ·{" "}
                  {group.rows.filter((r) => r.docType === "PURCHASE_INVOICE").length} purchase ·{" "}
                  {group.rows.filter((r) => r.status === "posted").length} posted
                </span>
              </div>
              <ul className="divide-y divide-border">
                {group.rows.map((doc) => {
                  const s = stage(doc);
                  return (
                    <li key={doc.id}>
                      <button
                        type="button"
                        className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3 text-left text-sm transition-colors hover:bg-primary-subtle/30"
                        onClick={() => setOpenId(doc.id)}
                        data-testid="inbox-doc-row"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-foreground">
                              {doc.invoiceNumber || doc.originalName}
                            </span>
                            <StatusPill tone="info">{docTypeLabel(doc.docType)}</StatusPill>
                            <StatusPill tone={s.tone}>
                              {s.label === "Reading…" ? <Loader2 className="mr-1 inline size-3 animate-spin" /> : null}
                              {s.label}
                            </StatusPill>
                            {doc.docKind === "PROFORMA" ? <StatusPill tone="warn">Proforma</StatusPill> : null}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {[doc.entryDate, doc.counterparty, doc.invoiceNumber ? doc.originalName : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          {doc.blockers.length || doc.warnings.length ? (
                            <span className="flex items-center gap-1 text-xs text-amber-700">
                              <AlertTriangle className="size-3.5" />
                              {doc.blockers.length ? `${doc.blockers.length} to fix` : `${doc.warnings.length} note(s)`}
                            </span>
                          ) : null}
                          {doc.originalTotalMinor != null ? (
                            <div className="text-right tabular-nums">
                              <div className="font-medium">
                                {doc.currency} {formatMinor(doc.originalTotalMinor)}
                              </div>
                              {doc.currency !== "AED" && doc.totalAedMinor != null ? (
                                <div className="text-xs text-muted-foreground">AED {formatMinor(doc.totalAedMinor)}</div>
                              ) : null}
                            </div>
                          ) : null}
                          <ChevronRight className="size-4 text-muted-foreground" />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>

      <InvoiceDrawer
        documentId={openId}
        onClose={() => setOpenId(null)}
        onChanged={load}
        periods={periods}
        me={me}
      />
    </div>
  );
}
