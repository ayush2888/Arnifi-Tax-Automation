"use client";

import { useEffect, useState } from "react";

import { UploadDropzone } from "@/components/upload-dropzone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatMinor } from "@/lib/money";

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
  proposedMapping: {
    columnMap?: Record<string, string>;
    headers?: string[];
    dateFormat?: string;
    decimalSeparator?: string;
    thousandsSeparator?: string;
    encoding?: string;
  } | null;
  events?: { stage: string; method: string; pages: number; estCostUsd: number; durationMs: number; at: string }[];
};

const FIELDS = [
  ["", "Ignore"],
  ["txn_date", "Date"],
  ["value_date", "Value date"],
  ["description", "Description"],
  ["debit", "Debit"],
  ["credit", "Credit"],
  ["balance", "Balance"],
  ["reference", "Reference"],
  ["counterparty", "Counterparty"],
];

export default function StatementsPage() {
  const [rows, setRows] = useState<Statement[] | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Statement | null>(null);

  function load() {
    fetch("/api/statements")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load statements.");
        return response.json();
      })
      .then(setRows)
      .catch((reason: Error) => setError(reason.message));
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
            window.setTimeout(tick, 1000);
          } else {
            load();
          }
        });
    };
    tick();
    return () => {
      stop = true;
    };
  }, [openId]);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-heading text-3xl tracking-tight">Statements</h1>
        <p className="text-sm text-muted-foreground">Each file keeps its extraction method, balance check, and column map.</p>
      </header>
      <UploadDropzone
        onUploaded={(id) => {
          setOpenId(id);
          load();
        }}
      />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!rows ? <p className="text-sm text-muted-foreground">Loading statements…</p> : null}
      {rows && rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">No statements for this client.</p>
      ) : null}
      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {["Bank", "Period", "Method", "Status", "Opening", "Closing", "Balance check"].map((label) => (
                  <th key={label} className="px-3 py-2 font-medium">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="cursor-pointer border-t border-border hover:bg-muted/60" onClick={() => setOpenId(row.id)}>
                  <td className="px-3 py-2">{row.bankName}</td>
                  <td className="px-3 py-2">{row.periodStart || "—"} – {row.periodEnd || "—"}</td>
                  <td className="px-3 py-2">{row.extractionMethod || "—"}</td>
                  <td className="px-3 py-2">{row.status.replaceAll("_", " ")}</td>
                  <td className="nums px-3 py-2 text-right">{formatMinor(row.openingMinor)}</td>
                  <td className="nums px-3 py-2 text-right">{formatMinor(row.closingMinor)}</td>
                  <td className="px-3 py-2">
                    <Badge variant={row.balanceCheck === "failed" ? "destructive" : "outline"}>{row.balanceCheck}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <Sheet open={Boolean(openId)} onOpenChange={(open) => !open && setOpenId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="font-heading">{detail?.fileName || "Statement"}</SheetTitle>
          </SheetHeader>
          {detail ? <StatementDetail statement={detail} onChanged={() => setOpenId(detail.id)} /> : <p>Loading…</p>}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatementDetail({ statement, onChanged }: { statement: Statement; onChanged: () => void }) {
  const proposal = statement.proposedMapping;
  const headers = proposal?.headers || [];
  const proposalKey = JSON.stringify(proposal ?? null);
  const [assigned, setAssigned] = useState<Record<string, string>>({});
  const [dateFormat, setDateFormat] = useState("%Y-%m-%d");
  const [decimalSeparator, setDecimalSeparator] = useState(".");
  const [thousandsSeparator, setThousandsSeparator] = useState(",");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const next = JSON.parse(proposalKey) as Statement["proposedMapping"];
    setAssigned(
      Object.fromEntries(Object.entries(next?.columnMap || {}).map(([field, header]) => [header, field])),
    );
    setDateFormat(next?.dateFormat || "%Y-%m-%d");
    setDecimalSeparator(next?.decimalSeparator || ".");
    setThousandsSeparator(next?.thousandsSeparator || ",");
  }, [statement.id, statement.error, proposalKey]);

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

  return (
    <div className="space-y-4 px-4 text-sm">
      <p>{statement.bankName} · {statement.accountLabel} · {statement.ibanMasked}</p>
      <p className="text-muted-foreground">
        {statement.mime} · {statement.size} bytes · {statement.extractionMethod || "not parsed"} · {statement.status.replaceAll("_", " ")}
      </p>
      {statement.error ? <p className="text-warn">Needs attention: {statement.error.replaceAll("_", " ")}</p> : null}
      {statement.validationFlags?.length ? <p>Flags: {statement.validationFlags.join(", ")}</p> : null}
      {statement.error === "password_required" || statement.error === "bad_password" ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void unlock();
          }}
        >
          <Label htmlFor="pdf-password">PDF password</Label>
          <Input id="pdf-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" />
          <Button type="submit">Unlock and parse</Button>
          <p className="text-xs text-muted-foreground">The password is sent to the worker and is not stored.</p>
        </form>
      ) : null}
      {statement.error === "mapping_unconfirmed" ? (
        <div className="space-y-3">
          <p>Confirm the column map for {statement.bankName}. The next file from this bank reuses it.</p>
          {headers.map((header) => (
            <label key={header} className="flex items-center justify-between gap-3">
              <span>{header}</span>
              <select
                className="rounded-md border border-border bg-background px-2 py-1"
                value={assigned[header] || ""}
                onChange={(event) => setAssigned((current) => ({ ...current, [header]: event.target.value }))}
              >
                {FIELDS.map(([value, label]) => (
                  <option key={value || "ignore"} value={value}>{label}</option>
                ))}
              </select>
            </label>
          ))}
          <label className="block">Date format <Input value={dateFormat} onChange={(event) => setDateFormat(event.target.value)} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label>Decimal <Input value={decimalSeparator} onChange={(event) => setDecimalSeparator(event.target.value)} /></label>
            <label>Thousands <Input value={thousandsSeparator} onChange={(event) => setThousandsSeparator(event.target.value)} /></label>
          </div>
          <Button type="button" onClick={() => void confirm()}>Confirm mapping</Button>
        </div>
      ) : null}
      <div>
        <h3 className="mb-2 font-medium">Processing</h3>
        <ul className="space-y-1 text-muted-foreground">
          {(statement.events || []).map((event, index) => (
            <li key={`${event.at}-${index}`}>
              {event.stage} · {event.method} · {event.pages} pages · ${Number(event.estCostUsd).toFixed(4)} · {event.durationMs} ms
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
