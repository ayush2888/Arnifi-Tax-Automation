"use client";

import { Download, Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";

import { useBooksShell } from "@/components/books/books-shell-context";
import { PageHeader } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMinor } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  isLedgerKind,
  LEDGER_KIND_META,
  LEDGER_KINDS,
  PARTY_TYPES,
  UNASSIGNED_PARTY,
  type LedgerKind,
} from "@/server/books/subsidiary-ledger-core";

type PartyRow = {
  partyId: string | null;
  partyName: string;
  partyType: string | null;
  openingBalanceMinor: number;
  periodDebitMinor: number;
  periodCreditMinor: number;
  closingBalanceMinor: number;
};

type SummaryResponse = {
  partyLabel: string;
  periodLabel: string;
  accounts: { id: string; code: string; name: string }[];
  parties: PartyRow[];
  totals: {
    openingBalanceMinor: number;
    periodDebitMinor: number;
    periodCreditMinor: number;
    closingBalanceMinor: number;
  };
};

type AgingResponse = {
  partyLabel: string;
  periodLabel: string;
  asOf: string;
  buckets: string[];
  parties: {
    partyId: string | null;
    partyName: string;
    partyType: string | null;
    buckets: number[];
    unappliedMinor: number;
    totalMinor: number;
  }[];
  totals: { buckets: number[]; unappliedMinor: number; totalMinor: number };
};

type StatementLine = {
  entryId: string;
  entryNo: string | null;
  entryDate: string;
  voucherType: string;
  reference: string;
  memo: string;
  accountCode: string;
  accountName: string;
  debitMinor: number;
  creditMinor: number;
  balanceMinor: number;
};

type StatementResponse = {
  partyLabel: string;
  periodLabel: string;
  party: { id: string | null; name: string; partyType: string | null; trn: string | null };
  openingBalanceMinor: number;
  lines: StatementLine[];
  totalDebitMinor: number;
  totalCreditMinor: number;
  closingBalanceMinor: number;
};

const ERROR_TEXT: Record<string, string> = {
  party_exists: "A party with that name and type already exists.",
  party_name_required: "Enter a name.",
  party_trn_invalid: "A UAE TRN has 15 digits and starts with 1.",
  party_email_invalid: "Enter a valid email address.",
  forbidden: "Your role cannot add parties.",
  period_not_found: "That period no longer exists.",
};

function errorText(code: unknown) {
  const key = String(code || "request_failed");
  return ERROR_TEXT[key] || key.replaceAll("_", " ");
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function NewPartyForm({
  defaultType,
  onCreated,
}: {
  defaultType: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [partyType, setPartyType] = useState(defaultType);
  const [trn, setTrn] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => setPartyType(defaultType), [defaultType]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/books/parties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, partyType, trn: trn || null, email: email || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(errorText(json.error));
        return;
      }
      setName("");
      setTrn("");
      setEmail("");
      setOpen(false);
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="party-new">
        <Plus className="size-4" />
        New party
      </Button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="grid w-full gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-5"
      data-testid="party-form"
    >
      <div className="md:col-span-2">
        <Label htmlFor="party-name">Name</Label>
        <Input id="party-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
      </div>
      <div>
        <Label htmlFor="party-type">Type</Label>
        <select
          id="party-type"
          className="flex h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          value={partyType}
          onChange={(e) => setPartyType(e.target.value)}
        >
          {PARTY_TYPES.map((t) => (
            <option key={t} value={t}>
              {titleCase(t)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="party-trn">TRN (optional)</Label>
        <Input id="party-trn" value={trn} onChange={(e) => setTrn(e.target.value)} inputMode="numeric" />
      </div>
      <div>
        <Label htmlFor="party-email">Email (optional)</Label>
        <Input id="party-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {error ? (
        <p className="text-sm text-destructive md:col-span-5" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2 md:col-span-5">
        <Button type="submit" size="sm" disabled={saving || !name.trim()}>
          {saving ? "Saving…" : "Save party"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function SubsidiaryLedgersInner() {
  const { periods, periodId, setPeriodId } = useBooksShell();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const kindParam = params.get("kind");
  const kind: LedgerKind = isLedgerKind(kindParam) ? kindParam : "sales";
  const partyKey = params.get("partyId") || "";
  const meta = LEDGER_KIND_META[kind];

  const [hideZero, setHideZero] = useState(true);
  const view = params.get("view") === "aging" ? "aging" : "balances";
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [aging, setAging] = useState<AgingResponse | null>(null);
  const [statement, setStatement] = useState<StatementResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  const navigate = useCallback(
    (next: { kind?: LedgerKind; partyId?: string | null; view?: "balances" | "aging" }) => {
      const qs = new URLSearchParams(params.toString());
      if (next.kind) qs.set("kind", next.kind);
      if (next.view === "aging") qs.set("view", "aging");
      else if (next.view === "balances") qs.delete("view");
      if (next.partyId === null) qs.delete("partyId");
      else if (next.partyId) qs.set("partyId", next.partyId);
      router.replace(`${pathname}?${qs}`, { scroll: false });
    },
    [params, pathname, router],
  );

  useEffect(() => {
    if (!periodId) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const qs = new URLSearchParams({ kind, periodId });
    if (partyKey) qs.set("partyId", partyKey);
    else if (view === "aging") qs.set("view", "aging");
    else if (!hideZero) qs.set("includeZero", "1");

    fetch(`/api/books/subsidiary-ledger?${qs}`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(errorText(json.error));
          setSummary(null);
          setStatement(null);
          setAging(null);
          return;
        }
        if (partyKey) {
          setStatement(json as StatementResponse);
          setSummary(null);
          setAging(null);
        } else if (view === "aging") {
          setAging(json as AgingResponse);
          setSummary(null);
          setStatement(null);
        } else {
          setSummary(json as SummaryResponse);
          setStatement(null);
          setAging(null);
        }
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        setError("Could not load the ledger. Check your connection and try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [kind, periodId, partyKey, view, hideZero, reloadTick]);

  const csvHref = periodId
    ? `/api/books/subsidiary-ledger?${new URLSearchParams({
        kind,
        periodId,
        format: "csv",
        ...(partyKey
          ? { partyId: partyKey }
          : view === "aging"
            ? { view: "aging" }
            : hideZero
              ? {}
              : { includeZero: "1" }),
      })}`
    : "#";

  return (
    <div className="space-y-5 pb-10">
      <PageHeader
        title="Subsidiary ledgers"
        description="Sales, purchase, loans, advances and capital ledgers, built from posted journal lines grouped by party."
        actions={
          <>
            <label className="text-xs text-muted-foreground">
              Period
              <select
                className="ml-2 rounded-md border border-border bg-card px-2 py-1 text-sm"
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
                data-testid="sl-period"
              >
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <a
              href={csvHref}
              download
              aria-disabled={!periodId}
              tabIndex={periodId ? undefined : -1}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                !periodId && "pointer-events-none opacity-50",
              )}
              data-testid="sl-export"
            >
              <Download className="size-4" />
              Export CSV
            </a>
          </>
        }
      />

      <div role="tablist" aria-label="Ledger type" className="flex flex-wrap gap-2 border-b border-border pb-2">
        {LEDGER_KINDS.map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={k === kind}
            data-testid={`sl-tab-${k}`}
            onClick={() => navigate({ kind: k, partyId: null })}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              k === kind
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-muted",
            )}
          >
            {LEDGER_KIND_META[k].label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{meta.description}</p>
        {!partyKey ? (
          <div role="group" aria-label="Report view" className="flex gap-1 rounded-md border border-border p-0.5">
            {(["balances", "aging"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                data-testid={`sl-view-${v}`}
                onClick={() => navigate({ view: v })}
                className={cn(
                  "rounded px-3 py-1 text-xs transition-colors",
                  view === v ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
                )}
              >
                {v === "balances" ? "Balances" : "Aging"}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      {partyKey ? (
        <StatementView
          data={statement}
          loading={loading}
          onBack={() => navigate({ partyId: null })}
        />
      ) : view === "aging" ? (
        <AgingView data={aging} loading={loading} onOpen={(key) => navigate({ partyId: key })} />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
              Hide parties with no balance or activity
            </label>
            <NewPartyForm defaultType={meta.defaultPartyType} onCreated={() => setReloadTick((n) => n + 1)} />
          </div>

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[720px] text-sm" data-testid="sl-summary">
              <thead className="bg-muted/95">
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">
                    {meta.partyLabel}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Type
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Opening
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Debits
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Credits
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Closing
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary?.parties.map((p) => {
                  const key = p.partyId || UNASSIGNED_PARTY;
                  return (
                    <tr
                      key={key}
                      className="cursor-pointer border-b border-border/60 hover:bg-muted/30 focus-within:bg-muted/30"
                      onClick={() => navigate({ partyId: key })}
                      data-testid="sl-party-row"
                    >
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-left font-medium text-primary underline-offset-2 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate({ partyId: key });
                          }}
                        >
                          {p.partyName}
                        </button>
                        {!p.partyId ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            lines not tagged to a party
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {p.partyType ? titleCase(p.partyType) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMinor(p.openingBalanceMinor)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMinor(p.periodDebitMinor)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMinor(p.periodCreditMinor)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {formatMinor(p.closingBalanceMinor)}
                      </td>
                    </tr>
                  );
                })}
                {summary && summary.parties.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                      No postings to these accounts for {summary.periodLabel}. Tag journal lines with a{" "}
                      {meta.partyLabel.toLowerCase()} when creating an entry, or untick the filter above.
                    </td>
                  </tr>
                ) : null}
                {!summary && loading ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                      Loading ledger…
                    </td>
                  </tr>
                ) : null}
              </tbody>
              {summary && summary.parties.length ? (
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="px-3 py-3" colSpan={2}>
                      Total
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatMinor(summary.totals.openingBalanceMinor)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatMinor(summary.totals.periodDebitMinor)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatMinor(summary.totals.periodCreditMinor)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums" data-testid="sl-total-closing">
                      {formatMinor(summary.totals.closingBalanceMinor)}
                    </td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>

          {summary?.accounts.length ? (
            <p className="text-xs text-muted-foreground">
              Includes accounts: {summary.accounts.map((a) => `${a.code} ${a.name}`).join(" · ")}. A negative
              balance sits on the opposite side to normal. The total ties to the trial balance for these
              accounts.
            </p>
          ) : summary ? (
            <p className="text-xs text-muted-foreground">
              No active accounts match this ledger. Flag a trade receivable or payable account, or use the
              loan, advance or capital account types in the chart of accounts.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function AgingView({
  data,
  loading,
  onOpen,
}: {
  data: AgingResponse | null;
  loading: boolean;
  onOpen: (key: string) => void;
}) {
  return (
    <div className="space-y-2" data-testid="sl-aging">
      {data ? (
        <p className="text-xs text-muted-foreground">
          Open items as of {data.asOf}. Receipts and payments clear the oldest items first; an unapplied
          amount is a credit on account.
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/95">
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">
                {data?.partyLabel || "Party"}
              </th>
              {(data?.buckets || ["0-30", "31-60", "61-90", "90+"]).map((b) => (
                <th key={b} scope="col" className="px-3 py-2 text-right font-medium">
                  {b} days
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right font-medium">Unapplied</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {data?.parties.map((p) => (
              <tr key={p.partyId || UNASSIGNED_PARTY} className="border-b border-border/60" data-testid="sl-aging-row">
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-left font-medium text-primary underline-offset-2 hover:underline"
                    onClick={() => onOpen(p.partyId || UNASSIGNED_PARTY)}
                  >
                    {p.partyName}
                  </button>
                </td>
                {p.buckets.map((n, i) => (
                  <td key={i} className="px-3 py-2 text-right tabular-nums">
                    {n ? formatMinor(n) : "—"}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums">
                  {p.unappliedMinor ? formatMinor(-p.unappliedMinor) : "—"}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMinor(p.totalMinor)}</td>
              </tr>
            ))}
            {data && data.parties.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  Nothing outstanding as of {data.asOf}.
                </td>
              </tr>
            ) : null}
            {!data && loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  Loading aging…
                </td>
              </tr>
            ) : null}
          </tbody>
          {data && data.parties.length ? (
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="px-3 py-3">Total</td>
                {data.totals.buckets.map((n, i) => (
                  <td key={i} className="px-3 py-3 text-right tabular-nums">
                    {formatMinor(n)}
                  </td>
                ))}
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatMinor(-data.totals.unappliedMinor)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums" data-testid="sl-aging-total">
                  {formatMinor(data.totals.totalMinor)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

function StatementView({
  data,
  loading,
  onBack,
}: {
  data: StatementResponse | null;
  loading: boolean;
  onBack: () => void;
}) {
  return (
    <div className="space-y-3" data-testid="sl-statement">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack} data-testid="sl-back">
            ← All parties
          </Button>
          {data ? (
            <>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">{data.party.name}</h2>
              <p className="text-sm text-muted-foreground">
                {data.party.partyType ? titleCase(data.party.partyType) : "Unassigned lines"}
                {data.party.trn ? ` · TRN ${data.party.trn}` : ""} · {data.periodLabel}
              </p>
            </>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="bg-muted/95">
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-medium">Date</th>
              <th scope="col" className="px-3 py-2 font-medium">Entry</th>
              <th scope="col" className="px-3 py-2 font-medium">Voucher</th>
              <th scope="col" className="px-3 py-2 font-medium">Reference</th>
              <th scope="col" className="px-3 py-2 font-medium">Account</th>
              <th scope="col" className="px-3 py-2 font-medium">Description</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Debit</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Credit</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {data ? (
              <tr className="border-b border-border/60 bg-muted/20 text-xs">
                <td className="px-3 py-2" colSpan={8}>
                  Opening balance
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMinor(data.openingBalanceMinor)}</td>
              </tr>
            ) : null}
            {data?.lines.map((l, i) => (
              <tr key={`${l.entryId}-${i}`} className="border-b border-border/60" data-testid="sl-line">
                <td className="whitespace-nowrap px-3 py-2">{l.entryDate}</td>
                <td className="px-3 py-2 font-mono text-xs">{l.entryNo || l.entryId.slice(0, 8)}</td>
                <td className="px-3 py-2">{l.voucherType}</td>
                <td className="px-3 py-2">{l.reference || "—"}</td>
                <td className="px-3 py-2">
                  <span className="tabular-nums text-muted-foreground">{l.accountCode}</span> {l.accountName}
                </td>
                <td className="px-3 py-2">{l.memo}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.debitMinor ? formatMinor(l.debitMinor) : ""}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.creditMinor ? formatMinor(l.creditMinor) : ""}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMinor(l.balanceMinor)}</td>
              </tr>
            ))}
            {data && data.lines.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No movements in this period. The closing balance equals the opening balance.
                </td>
              </tr>
            ) : null}
            {!data && loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Loading statement…
                </td>
              </tr>
            ) : null}
          </tbody>
          {data ? (
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="px-3 py-3" colSpan={6}>
                  Closing balance
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{formatMinor(data.totalDebitMinor)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatMinor(data.totalCreditMinor)}</td>
                <td className="px-3 py-3 text-right tabular-nums" data-testid="sl-closing">
                  {formatMinor(data.closingBalanceMinor)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

export default function SubsidiaryLedgersPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading subsidiary ledgers…</p>}>
      <SubsidiaryLedgersInner />
    </Suspense>
  );
}
