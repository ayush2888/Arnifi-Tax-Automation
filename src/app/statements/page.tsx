"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, FileWarning, Inbox } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { UploadDropzone } from "@/components/upload-dropzone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { highlightStyle, type BBox } from "@/lib/highlight";
import { formatMinor } from "@/lib/money";
import { formatStatementPeriod } from "@/lib/statement-period";
import { cn } from "@/lib/utils";

type StatementPage = {
  pageNo: number;
  url: string;
  width: number | null;
  height: number | null;
};

type StatementLine = {
  id: string;
  rowNo: number;
  sourcePage: number | null;
  sourceBbox?: BBox | null;
  txnDate: string | null;
  description: string;
  reference: string | null;
  debitMinor: number | null;
  creditMinor: number | null;
  balanceMinor: number | null;
  currency: string;
  txnType: string;
  reviewStatus: string;
  flags: string[];
};

type RawExtracted = {
  rowNo: number;
  sourcePage: number | null;
  sourceBbox?: BBox | null;
  cells: Record<string, string>;
  confidence: number | null;
};

type Statement = {
  id: string;
  bankName: string;
  accountLabel: string;
  ibanMasked: string;
  status: string;
  error: string | null;
  extractionMethod: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  openingMinor: number | null;
  closingMinor: number | null;
  currency: string;
  validationFlags: string[];
  balanceCheck: string;
  fileName: string;
  mime: string;
  size: number;
  sha256: string;
  fileUrl?: string | null;
  pages?: StatementPage[];
  proposedMapping: {
    columnMap?: Record<string, string>;
    headers?: string[];
    dateFormat?: string;
    decimalSeparator?: string;
    thousandsSeparator?: string;
    encoding?: string;
  } | null;
  extractedRowCount?: number | null;
  events?: { stage: string; method: string; pages: number; estCostUsd: number; durationMs: number; at: string }[];
  lines?: StatementLine[];
  rawExtracted?: RawExtracted[];
};

const FIELDS = [
  ["", "Ignore"],
  ["txn_date", "Date"],
  ["value_date", "Value date"],
  ["description", "Description"],
  ["amount", "Amount (signed: − out / + in)"],
  ["debit", "Debit"],
  ["credit", "Credit"],
  ["balance", "Balance"],
  ["reference", "Reference"],
  ["counterparty", "Counterparty"],
];

function statusTone(status: string, balanceCheck: string): "ok" | "warn" | "danger" | "info" | "neutral" {
  if (status === "failed" || balanceCheck === "failed") return "danger";
  if (status === "needs_review" || status === "parsing" || status === "uploaded") return "warn";
  if (status === "approved" || status === "parsed") return "ok";
  return "neutral";
}

function statusLabel(status: string) {
  if (status === "needs_review") return "Needs review";
  if (status === "uploaded") return "Queued";
  if (status === "parsing") return "Extracting";
  return status.replaceAll("_", " ");
}

function periodLabel(row: Statement) {
  return formatStatementPeriod(row.periodStart, row.periodEnd);
}

export default function StatementsPage() {
  const [rows, setRows] = useState<Statement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Statement | null>(null);

  function load() {
    setLoading(true);
    fetch("/api/statements")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load statements.");
        return response.json();
      })
      .then((list) => {
        setRows(Array.isArray(list) ? list : []);
        setError("");
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!openId) return;
    let stop = false;
    const tick = () => {
      fetch(`/api/statements/${openId}`)
        .then((response) => response.json())
        .then((statement) => {
          if (stop) return;
          setDetail(statement);
          if (statement.status === "uploaded" || statement.status === "parsing") {
            window.setTimeout(tick, 1200);
          } else {
            load();
          }
        })
        .catch(() => undefined);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [openId]);

  const needsReview = rows.filter((r) => r.status === "needs_review" || r.balanceCheck === "failed").length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Bank statements"
        description="Bring in money in/out from the bank. Extract → review balances → approve. Invoices stay in Inbox."
        actions={
          <Link href="/inbox" className="ab-soft-btn">
            <Inbox className="size-3.5" />
            Go to Inbox
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <StatTile
          label="Uploaded"
          value={loading && rows.length === 0 ? "…" : String(rows.length)}
          hint="For the company selected in the sidebar"
          icon={CheckCircle2}
        />
        <StatTile
          label="Needs review"
          value={loading && rows.length === 0 ? "…" : String(needsReview)}
          hint="Click a row to fix and approve"
          icon={Clock3}
          warn={needsReview > 0}
        />
      </div>

      <UploadDropzone
        onUploaded={(id) => {
          setOpenId(id);
          load();
        }}
      />

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-red-50 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}

      <section className="ab-panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-border/80 px-5 py-4">
          <div>
            <h2 className="font-heading text-base font-semibold">Your statements</h2>
            <p className="text-sm text-muted-foreground">Click a row to review extraction and approve.</p>
          </div>
        </div>

        {loading && rows.length === 0 ? (
          <div className="flex items-center gap-2 px-5 py-10 text-sm text-muted-foreground">
            <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Loading statements…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <FileWarning className="mx-auto size-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium text-foreground">No statements yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload one bank PDF or CSV above for the month you are working.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  {["Account", "Period", "Status", "Opening", "Closing", "Balance"].map((label) => (
                    <th key={label} className="px-4 py-3 font-semibold">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-b border-border/80 transition-colors last:border-0 hover:bg-primary-subtle/40"
                    onClick={() => setOpenId(row.id)}
                  >
                    <td className="px-4 py-3.5">
                      <div className="font-medium text-foreground">{row.bankName}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.accountLabel}
                        {row.fileName ? ` · ${row.fileName}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">{periodLabel(row)}</td>
                    <td className="px-4 py-3.5">
                      <StatusPill tone={statusTone(row.status, row.balanceCheck)}>
                        {statusLabel(row.status)}
                      </StatusPill>
                    </td>
                    <td className="nums px-4 py-3.5 text-right tabular-nums">{formatMinor(row.openingMinor)}</td>
                    <td className="nums px-4 py-3.5 text-right tabular-nums">{formatMinor(row.closingMinor)}</td>
                    <td className="px-4 py-3.5">
                      <StatusPill
                        tone={
                          row.balanceCheck === "failed"
                            ? "danger"
                            : row.balanceCheck === "ok" || row.balanceCheck === "passed"
                              ? "ok"
                              : "warn"
                        }
                      >
                        {row.balanceCheck === "failed"
                          ? "Mismatch"
                          : row.balanceCheck === "ok" || row.balanceCheck === "passed"
                            ? "Matched"
                            : "Review"}
                      </StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Sheet
        open={Boolean(openId)}
        onOpenChange={(open) => {
          if (!open) {
            setOpenId(null);
            setDetail(null);
          }
        }}
      >
        <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 data-[side=right]:sm:max-w-[min(96vw,72rem)]">
          <SheetHeader className="shrink-0 border-b border-border px-4 py-3">
            <SheetTitle className="font-heading">{detail?.fileName || "Statement"}</SheetTitle>
          </SheetHeader>
          {detail ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <StatementDetail statement={detail} onChanged={() => setOpenId(detail.id)} />
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
              <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Loading…
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  warn,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof CheckCircle2;
  warn?: boolean;
}) {
  return (
    <div className={cn("ab-stat", warn && "border-amber-200/80 bg-amber-50/50")}>
      <div className="mb-2 flex items-center justify-between pl-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <Icon className={cn("size-4", warn ? "text-amber-600" : "text-primary")} />
      </div>
      <p className="pl-2 font-heading text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 pl-2 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function StatementDetail({ statement, onChanged }: { statement: Statement; onChanged: () => void }) {
  const proposal = statement.proposedMapping;
  const headers = proposal?.headers || [];
  const proposalKey = JSON.stringify(proposal ?? null);
  const pages = statement.pages || [];
  const lines = statement.lines || [];
  const rawRows = statement.rawExtracted || [];
  const [assigned, setAssigned] = useState<Record<string, string>>({});
  const [dateFormat, setDateFormat] = useState("%Y-%m-%d");
  const [decimalSeparator, setDecimalSeparator] = useState(".");
  const [thousandsSeparator, setThousandsSeparator] = useState(",");
  const [password, setPassword] = useState("");
  const [activePage, setActivePage] = useState<number | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [leftMode, setLeftMode] = useState<"pages" | "pdf">("pages");

  useEffect(() => {
    const next = JSON.parse(proposalKey) as Statement["proposedMapping"];
    setAssigned(
      Object.fromEntries(Object.entries(next?.columnMap || {}).map(([field, header]) => [header, field])),
    );
    setDateFormat(next?.dateFormat || "%Y-%m-%d");
    setDecimalSeparator(next?.decimalSeparator || ".");
    setThousandsSeparator(next?.thousandsSeparator || ",");
  }, [statement.id, statement.error, proposalKey]);

  useEffect(() => {
    const first =
      (statement.lines || []).find((line) => line.sourcePage != null)?.sourcePage ??
      (statement.rawExtracted || []).find((row) => row.sourcePage != null)?.sourcePage ??
      (statement.pages || [])[0]?.pageNo ??
      null;
    setActivePage(first);
    setSelectedKey(null);
    setLeftMode((statement.pages || []).length ? "pages" : "pdf");
    // Reset compare selection when opening a different statement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statement.id]);

  const pageImage = useMemo(
    () => pages.find((page) => page.pageNo === activePage) || pages[0] || null,
    [pages, activePage],
  );

  const selectedBbox = useMemo((): BBox | null => {
    if (!selectedKey) return null;
    if (selectedKey.startsWith("line:")) {
      const line = lines.find((item) => item.id === selectedKey.slice(5));
      return (line?.sourceBbox as BBox | null | undefined) || null;
    }
    if (selectedKey.startsWith("raw:")) {
      const row = rawRows.find((item) => String(item.rowNo) === selectedKey.slice(4));
      return (row?.sourceBbox as BBox | null | undefined) || null;
    }
    return null;
  }, [selectedKey, lines, rawRows]);

  async function confirm() {
    const columnMap: Record<string, string> = {};
    for (const [header, field] of Object.entries(assigned)) {
      if (field) columnMap[field] = header;
    }
    await fetch(`/api/statements/${statement.id}/mapping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnMap, dateFormat, decimalSeparator, thousandsSeparator }),
    });
    onChanged();
  }

  async function unlock() {
    await fetch(`/api/statements/${statement.id}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setPassword("");
    onChanged();
  }

  async function approve() {
    await fetch(`/api/statements/${statement.id}/approve`, { method: "POST" });
    onChanged();
  }

  function selectLine(line: StatementLine) {
    setSelectedKey(`line:${line.id}`);
    if (line.sourcePage != null) {
      setActivePage(line.sourcePage);
      setLeftMode("pages");
    }
  }

  function selectRaw(row: RawExtracted) {
    setSelectedKey(`raw:${row.rowNo}`);
    if (row.sourcePage != null) {
      setActivePage(row.sourcePage);
      setLeftMode("pages");
    }
  }

  const isPdf = (statement.mime || "").includes("pdf");

  return (
    <div className="space-y-4 px-4 pb-6 text-sm">
      <div className="rounded-xl border border-border bg-surface-muted/50 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={statusTone(statement.status, statement.balanceCheck)}>
            {statusLabel(statement.status)}
          </StatusPill>
          <StatusPill
            tone={
              statement.balanceCheck === "failed"
                ? "danger"
                : statement.balanceCheck === "ok" || statement.balanceCheck === "passed"
                  ? "ok"
                  : "neutral"
            }
          >
            Balance: {statement.balanceCheck}
          </StatusPill>
        </div>
        <p className="mt-3 font-medium text-foreground">
          {statement.bankName} · {statement.accountLabel}
        </p>
        <p className="mt-1 text-muted-foreground">{periodLabel(statement)}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Opening</p>
            <p className="font-medium tabular-nums">{formatMinor(statement.openingMinor)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Closing</p>
            <p className="font-medium tabular-nums">{formatMinor(statement.closingMinor)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Currency</p>
            <p className="font-medium">{statement.currency || "AED"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Lines found</p>
            <p className="font-medium tabular-nums">{statement.extractedRowCount ?? "—"}</p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Left: bank statement page. Right: what we extracted. Click a line to jump to its page
          and highlight it on the scan.
        </p>
        {(statement.validationFlags || []).includes("closing_mismatch") ||
        (statement.validationFlags || []).includes("amounts_incomplete") ? (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
            Balance check failed — opening + credits − debits does not equal closing, or some amounts
            could not be read. Do not approve until the lines look right.
          </p>
        ) : null}
      </div>

      {statement.error ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
          {statement.error === "mapping_unconfirmed"
            ? "Confirm the column map so we can turn the PDF table into bank lines."
            : `Needs attention: ${statement.error.replaceAll("_", " ")}`}
        </p>
      ) : null}

      {statement.error === "password_required" || statement.error === "bad_password" ? (
        <form
          className="space-y-2 rounded-xl border border-border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void unlock();
          }}
        >
          <Label htmlFor="pdf-password">PDF password</Label>
          <Input
            id="pdf-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="off"
          />
          <Button type="submit">Unlock and parse</Button>
          <p className="text-xs text-muted-foreground">Password is sent to the worker and is not stored.</p>
        </form>
      ) : null}

      {statement.error === "mapping_unconfirmed" ? (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <p className="font-medium">Confirm columns</p>
          <p className="text-muted-foreground">
            Match each bank column to our fields. The next file from this bank can reuse this map.
          </p>
          {headers.map((header) => (
            <label key={header} className="flex items-center justify-between gap-3">
              <span className="truncate font-medium">{header}</span>
              <select
                className="rounded-md border border-border bg-background px-2 py-1.5"
                value={assigned[header] || ""}
                onChange={(event) => setAssigned((current) => ({ ...current, [header]: event.target.value }))}
              >
                {FIELDS.map(([value, label]) => (
                  <option key={value || "ignore"} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="block text-xs text-muted-foreground">
            Date format
            <Input className="mt-1" value={dateFormat} onChange={(event) => setDateFormat(event.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground">
              Decimal
              <Input
                className="mt-1"
                value={decimalSeparator}
                onChange={(event) => setDecimalSeparator(event.target.value)}
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Thousands
              <Input
                className="mt-1"
                value={thousandsSeparator}
                onChange={(event) => setThousandsSeparator(event.target.value)}
              />
            </label>
          </div>
          <Button type="button" onClick={() => void confirm()}>
            Confirm mapping
          </Button>
        </div>
      ) : null}

      <div
        className="grid gap-3 lg:grid-cols-2"
        data-testid="statement-compare"
      >
        <section className="flex min-h-[28rem] flex-col overflow-hidden rounded-xl border border-border bg-background">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <h3 className="font-medium">Bank statement</h3>
            <div className="flex flex-wrap items-center gap-1.5">
              {pages.length > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant={leftMode === "pages" ? "default" : "outline"}
                  onClick={() => setLeftMode("pages")}
                >
                  Pages
                </Button>
              ) : null}
              {statement.fileUrl ? (
                <Button
                  type="button"
                  size="sm"
                  variant={leftMode === "pdf" ? "default" : "outline"}
                  onClick={() => setLeftMode("pdf")}
                >
                  {isPdf ? "Original PDF" : "Original file"}
                </Button>
              ) : null}
            </div>
          </div>

          {leftMode === "pages" && pages.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-1 border-b border-border/80 px-3 py-2">
                {pages.map((page) => (
                  <button
                    key={page.pageNo}
                    type="button"
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium",
                      page.pageNo === (activePage ?? pageImage?.pageNo)
                        ? "bg-primary text-primary-foreground"
                        : "bg-surface-muted text-muted-foreground hover:bg-primary-subtle",
                    )}
                    onClick={() => {
                      setActivePage(page.pageNo);
                      setSelectedKey(null);
                    }}
                  >
                    Page {page.pageNo}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-auto bg-surface-muted/40 p-3">
                {pageImage ? (
                  <div className="relative mx-auto inline-block max-w-full" data-testid="statement-source-page">
                    {/* Signed URL, short-lived. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={pageImage.url}
                      alt={`Statement page ${pageImage.pageNo}`}
                      className="max-w-full rounded-md border border-border bg-white shadow-sm"
                    />
                    {selectedBbox ? (
                      <div
                        data-testid="statement-source-highlight"
                        className="pointer-events-none absolute border-2 border-brand-accent bg-brand-accent/25"
                        style={highlightStyle(selectedBbox)}
                      />
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No page image for this statement yet.</p>
                )}
              </div>
            </>
          ) : statement.fileUrl ? (
            <div className="min-h-0 flex-1 p-3">
              {isPdf ? (
                <iframe
                  title={statement.fileName}
                  src={statement.fileUrl}
                  className="h-[min(70vh,36rem)] w-full rounded-md border border-border bg-white"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={statement.fileUrl}
                  alt={statement.fileName}
                  className="max-h-[min(70vh,36rem)] w-full rounded-md border border-border object-contain"
                />
              )}
            </div>
          ) : (
            <p className="p-4 text-xs text-muted-foreground">
              Source preview is not available yet. Wait for extraction to finish.
            </p>
          )}
        </section>

        <section className="flex min-h-[28rem] flex-col overflow-hidden rounded-xl border border-border bg-background">
          <div className="border-b border-border px-3 py-2">
            <h3 className="font-medium">
              {lines.length > 0
                ? `Extracted lines (${lines.length})`
                : rawRows.length > 0
                  ? `Raw cells (${rawRows.length})`
                  : "Extracted lines"}
            </h3>
            <p className="text-xs text-muted-foreground">Click a row to highlight it on the page.</p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {lines.length > 0 ? (
              <table className="w-full min-w-[28rem] text-left text-xs">
                <thead className="sticky top-0 bg-muted/90 text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Pg</th>
                    <th className="px-2 py-1.5 font-medium">Date</th>
                    <th className="px-2 py-1.5 font-medium">Description</th>
                    <th className="px-2 py-1.5 text-right font-medium">Out</th>
                    <th className="px-2 py-1.5 text-right font-medium">In</th>
                    <th className="px-2 py-1.5 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const selected = selectedKey === `line:${line.id}`;
                    return (
                      <tr
                        key={line.id}
                        className={cn(
                          "cursor-pointer border-t border-border/70 transition-colors",
                          selected ? "bg-primary-subtle" : "hover:bg-surface-muted/70",
                          line.flags?.length && !selected ? "bg-amber-50/60" : "",
                        )}
                        onClick={() => selectLine(line)}
                      >
                        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                          {line.sourcePage ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
                          {line.txnDate ? String(line.txnDate).slice(0, 10) : "—"}
                        </td>
                        <td className="max-w-[12rem] truncate px-2 py-1.5" title={line.description}>
                          {line.description || "—"}
                          {line.reference ? (
                            <span className="mt-0.5 block text-[10px] text-muted-foreground">{line.reference}</span>
                          ) : null}
                          {line.flags?.length ? (
                            <span className="mt-0.5 block text-[10px] text-amber-800">
                              {line.flags.join(", ")}
                            </span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                          {line.debitMinor ? formatMinor(line.debitMinor) : ""}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                          {line.creditMinor ? formatMinor(line.creditMinor) : ""}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                          {line.balanceMinor != null ? formatMinor(line.balanceMinor) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : rawRows.length > 0 ? (
              <table className="w-full min-w-[28rem] text-left text-xs">
                <thead className="sticky top-0 bg-muted/90 text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Pg</th>
                    <th className="px-2 py-1.5 font-medium">#</th>
                    <th className="px-2 py-1.5 font-medium">Cells</th>
                  </tr>
                </thead>
                <tbody>
                  {rawRows.map((row) => {
                    const selected = selectedKey === `raw:${row.rowNo}`;
                    const summary = Object.entries(row.cells)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(" · ");
                    return (
                      <tr
                        key={row.rowNo}
                        className={cn(
                          "cursor-pointer border-t border-border/70 transition-colors",
                          selected ? "bg-primary-subtle" : "hover:bg-surface-muted/70",
                        )}
                        onClick={() => selectRaw(row)}
                      >
                        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                          {row.sourcePage ?? "—"}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">{row.rowNo}</td>
                        <td className="max-w-[18rem] truncate px-2 py-1.5" title={summary}>
                          {summary || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : statement.status === "uploaded" || statement.status === "parsing" ? (
              <p className="p-4 text-xs text-muted-foreground">Extracting… lines will appear here.</p>
            ) : (
              <p className="p-4 text-xs text-muted-foreground">No bank lines were materialised yet.</p>
            )}
          </div>
        </section>
      </div>

      {statement.status === "needs_review" && !statement.error ? (
        <Button type="button" className="w-full" onClick={() => void approve()}>
          Approve statement
        </Button>
      ) : null}

      {(statement.events || []).length > 0 ? (
        <div>
          <h3 className="mb-2 font-medium">Processing log</h3>
          <ul className="space-y-1.5 text-muted-foreground">
            {(statement.events || []).map((event, index) => (
              <li key={`${event.at}-${index}`} className="rounded-lg bg-surface-muted/60 px-3 py-2 text-xs">
                {event.stage} · {event.method} · {event.pages} page(s) · {event.durationMs} ms
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
