"use client";

import { useEffect, useRef, useState } from "react";
import { FileUp, Landmark, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Account = { id: string; bankName: string; label: string; ibanMasked: string; currency?: string };

export function UploadDropzone({ onUploaded }: { onUploaded?: (statementId: string) => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [adding, setAdding] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [form, setForm] = useState({ bankName: "Wio Bank", label: "USD current", currency: "USD", iban: "" });
  const inputRef = useRef<HTMLInputElement>(null);

  function loadAccounts(selectId?: string) {
    return fetch("/api/bank-accounts")
      .then((response) => response.json())
      .then((rows: Account[]) => {
        const list = Array.isArray(rows) ? rows : [];
        setAccounts(list);
        setAccountId(selectId || list[0]?.id || "");
        return list;
      })
      .catch(() => {
        setAccounts([]);
        return [] as Account[];
      });
  }

  useEffect(() => {
    void loadAccounts();
  }, []);

  async function createAccount() {
    setSavingAccount(true);
    try {
      const response = await fetch("/api/bank-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankName: form.bankName.trim(),
          label: form.label.trim(),
          currency: form.currency.trim().toUpperCase(),
          iban: form.iban.trim() || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || "Could not add account");
      toast.success(`Added ${payload.currency} · ${payload.label}`);
      setAdding(false);
      await loadAccounts(String(payload.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add account");
    } finally {
      setSavingAccount(false);
    }
  }

  async function send(file: File) {
    const chosen = accountId || accounts[0]?.id;
    if (!chosen) {
      toast.error("Add a bank account first (button below), then upload the statement for that account.");
      setAdding(true);
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("bankAccountId", chosen);
      const response = await fetch("/api/uploads", { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || "Upload failed");
      if (payload.duplicate) toast.message("This file was already uploaded.");
      else toast.success("Statement uploaded — extracting transactions…");
      onUploaded?.(payload.statementId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="ab-panel overflow-hidden">
      <div className="flex items-start gap-3 border-b border-border/80 bg-gradient-to-r from-primary-subtle via-primary-subtle/40 to-transparent px-5 py-4">
        <span className="mt-0.5 inline-flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[var(--brand-accent)] text-primary-foreground shadow-md shadow-primary/25">
          <Landmark className="size-4" />
        </span>
        <div>
          <h2 className="font-heading text-base font-semibold text-foreground">Upload a bank statement</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Pick the account this PDF belongs to (AED or USD), then drop the file. One account per upload — Wio packs
            both currencies in one PDF, so upload once for AED and once for USD.
          </p>
        </div>
      </div>

      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[14rem] flex-1 text-sm font-medium text-foreground">
            Bank account
            <select
              className="mt-1.5 block w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm transition-colors hover:border-primary/40 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            >
              {accounts.length === 0 ? <option value="">No accounts yet</option> : null}
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.currency || "AED"} · {account.bankName} · {account.label}
                  {account.ibanMasked ? ` · ${account.ibanMasked}` : ""}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" variant="outline" onClick={() => setAdding((v) => !v)}>
            <Plus className="size-3.5" />
            {adding ? "Cancel" : "Add account"}
          </Button>
        </div>

        {adding ? (
          <div className="space-y-3 rounded-xl border border-border bg-surface-muted/30 p-4">
            <p className="text-sm font-medium">New bank account</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-muted-foreground">
                Bank name
                <Input
                  className="mt-1"
                  value={form.bankName}
                  onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                  placeholder="Wio Bank"
                />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                Label
                <Input
                  className="mt-1"
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="USD current"
                />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                Currency
                <select
                  className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                >
                  <option value="AED">AED</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                IBAN (optional — we only store a masked form)
                <Input
                  className="mt-1"
                  value={form.iban}
                  onChange={(e) => setForm((f) => ({ ...f, iban: e.target.value }))}
                  placeholder="AE82 0860 0000 0986 0559 687"
                />
              </label>
            </div>
            <Button type="button" disabled={savingAccount} onClick={() => void createAccount()}>
              {savingAccount ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Save account
            </Button>
          </div>
        ) : null}

        <div
          className={cn(
            "relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-all duration-150",
            dragging
              ? "border-primary bg-primary-subtle/70 scale-[1.01]"
              : "border-border bg-surface-muted/40 hover:border-primary/40 hover:bg-primary-subtle/30",
            busy && "pointer-events-none opacity-70",
          )}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void send(file);
          }}
        >
          <span className="mb-3 inline-flex size-12 items-center justify-center rounded-2xl bg-primary-subtle text-primary">
            {busy ? <Loader2 className="size-5 animate-spin" /> : <FileUp className="size-5" />}
          </span>
          <p className="text-sm font-medium">{busy ? "Uploading…" : "Drag & drop the statement here"}</p>
          <p className="mt-1 text-xs text-muted-foreground">PDF, CSV or Excel</p>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept=".pdf,.csv,.xlsx,.xls,.png,.jpg,.jpeg"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void send(file);
            }}
          />
          <Button type="button" className="mt-4" disabled={busy} onClick={() => inputRef.current?.click()}>
            Choose file
          </Button>
        </div>
      </div>
    </div>
  );
}
