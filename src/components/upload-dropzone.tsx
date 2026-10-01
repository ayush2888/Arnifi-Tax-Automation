"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type Account = { id: string; bankName: string; label: string; ibanMasked: string };

export function UploadDropzone({ onUploaded }: { onUploaded?: (statementId: string) => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  async function ensureAccounts() {
    if (ready) return accounts;
    const rows = await fetch("/api/bank-accounts").then((response) => response.json());
    setAccounts(rows);
    setAccountId(rows[0]?.id || "");
    setReady(true);
    return rows as Account[];
  }

  async function send(file: File) {
    const known = await ensureAccounts();
    const chosen = accountId || known[0]?.id;
    if (!chosen) {
      toast.error("This client has no bank account yet.");
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("bankAccountId", chosen);
      const response = await fetch("/api/uploads", { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || "upload_failed");
      if (payload.duplicate) toast.message("This file was already uploaded. No new processing was started.");
      else toast.success("Statement queued. Parsing runs in the background.");
      onUploaded?.(payload.statementId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "upload_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="rounded-lg border border-dashed border-border bg-card p-4"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files?.[0];
        if (file) void send(file);
      }}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <label className="text-sm">
          Bank account
          <select
            className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1"
            value={accountId}
            onFocus={() => void ensureAccounts()}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="">{ready ? "Choose an account" : "Load accounts"}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.bankName} · {account.label} · {account.ibanMasked}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Statement file
          <input
            className="mt-1 block text-sm"
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.tif,.tiff,.heic"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void send(file);
            }}
          />
        </label>
        <Button type="button" disabled={busy} onClick={() => void ensureAccounts()}>
          {busy ? "Uploading" : "Prepare upload"}
        </Button>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Drop a CSV, Excel file, PDF, or photo. The worker picks the cheapest reliable reader. Synthetic files only.
      </p>
    </form>
  );
}
