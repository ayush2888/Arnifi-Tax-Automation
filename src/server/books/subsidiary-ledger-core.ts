import { csvCell } from "@/lib/csv";
import { formatMinor } from "@/lib/money";
import { BooksError } from "@/server/books/errors";

export const LEDGER_KINDS = ["sales", "purchase", "loans", "advances", "capital"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const PARTY_TYPES = [
  "customer",
  "supplier",
  "lender",
  "borrower",
  "shareholder",
  "employee",
  "other",
] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const UNASSIGNED_PARTY = "unassigned";

type NormalBalance = "debit" | "credit";

export type LedgerKindMeta = {
  label: string;
  partyLabel: string;
  description: string;
  normalBalance: NormalBalance;
  defaultPartyType: PartyType;
  /** Accounts that feed this ledger: a boolean flag column or a COA sub_type list. */
  accountFilter: { flag: "is_ar" | "is_ap" } | { subTypes: readonly string[] };
};

export const LEDGER_KIND_META: Record<LedgerKind, LedgerKindMeta> = {
  sales: {
    label: "Sales ledger",
    partyLabel: "Customer",
    description: "Receivables by customer (accounts flagged as trade receivables).",
    normalBalance: "debit",
    defaultPartyType: "customer",
    accountFilter: { flag: "is_ar" },
  },
  purchase: {
    label: "Purchase ledger",
    partyLabel: "Supplier",
    description: "Payables by supplier (accounts flagged as trade payables).",
    normalBalance: "credit",
    defaultPartyType: "supplier",
    accountFilter: { flag: "is_ap" },
  },
  loans: {
    label: "Loans ledger",
    partyLabel: "Lender / borrower",
    description: "Loan accounts by counterparty.",
    normalBalance: "credit",
    defaultPartyType: "lender",
    accountFilter: { subTypes: ["loan"] },
  },
  advances: {
    label: "Advances ledger",
    partyLabel: "Counterparty",
    description: "Employee and customer advances by counterparty.",
    normalBalance: "debit",
    defaultPartyType: "employee",
    accountFilter: { subTypes: ["advance"] },
  },
  capital: {
    label: "Capital ledger",
    partyLabel: "Shareholder / owner",
    description: "Share capital and owner accounts by shareholder.",
    normalBalance: "credit",
    defaultPartyType: "shareholder",
    accountFilter: { subTypes: ["capital", "owner"] },
  },
};

export function isLedgerKind(value: unknown): value is LedgerKind {
  return typeof value === "string" && (LEDGER_KINDS as readonly string[]).includes(value);
}

export function isPartyType(value: unknown): value is PartyType {
  return typeof value === "string" && (PARTY_TYPES as readonly string[]).includes(value);
}

/** Balance on the kind's normal side. Negative means the opposite side (e.g. a customer in credit). */
export function signedBalance(debitMinor: number, creditMinor: number, normal: NormalBalance) {
  return normal === "debit" ? debitMinor - creditMinor : creditMinor - debitMinor;
}

export type StatementLineInput = {
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
};

export type StatementLine = StatementLineInput & { balanceMinor: number };

export function buildStatement(
  opening: { debitMinor: number; creditMinor: number },
  lines: StatementLineInput[],
  normal: NormalBalance,
) {
  let runDebit = opening.debitMinor;
  let runCredit = opening.creditMinor;
  let totalDebitMinor = 0;
  let totalCreditMinor = 0;
  const out: StatementLine[] = lines.map((line) => {
    runDebit += line.debitMinor;
    runCredit += line.creditMinor;
    totalDebitMinor += line.debitMinor;
    totalCreditMinor += line.creditMinor;
    return { ...line, balanceMinor: signedBalance(runDebit, runCredit, normal) };
  });
  return {
    openingBalanceMinor: signedBalance(opening.debitMinor, opening.creditMinor, normal),
    lines: out,
    totalDebitMinor,
    totalCreditMinor,
    closingBalanceMinor: signedBalance(runDebit, runCredit, normal),
  };
}

export type PartyMovementRow = {
  partyId: string | null;
  partyName: string | null;
  partyType: string | null;
  openingDebitMinor: number;
  openingCreditMinor: number;
  periodDebitMinor: number;
  periodCreditMinor: number;
};

export type PartySummary = {
  partyId: string | null;
  partyName: string;
  partyType: string | null;
  openingBalanceMinor: number;
  periodDebitMinor: number;
  periodCreditMinor: number;
  closingBalanceMinor: number;
};

export function summarizeParties(
  rows: PartyMovementRow[],
  normal: NormalBalance,
  opts?: { includeZero?: boolean },
) {
  const parties: PartySummary[] = [];
  let openingBalanceMinor = 0;
  let periodDebitMinor = 0;
  let periodCreditMinor = 0;
  let closingBalanceMinor = 0;

  for (const row of rows) {
    const opening = signedBalance(row.openingDebitMinor, row.openingCreditMinor, normal);
    const closing = signedBalance(
      row.openingDebitMinor + row.periodDebitMinor,
      row.openingCreditMinor + row.periodCreditMinor,
      normal,
    );
    const isZero =
      opening === 0 && closing === 0 && row.periodDebitMinor === 0 && row.periodCreditMinor === 0;
    if (isZero && !opts?.includeZero) continue;
    parties.push({
      partyId: row.partyId,
      partyName: row.partyId ? row.partyName || "Unnamed" : "Unassigned",
      partyType: row.partyType,
      openingBalanceMinor: opening,
      periodDebitMinor: row.periodDebitMinor,
      periodCreditMinor: row.periodCreditMinor,
      closingBalanceMinor: closing,
    });
    openingBalanceMinor += opening;
    periodDebitMinor += row.periodDebitMinor;
    periodCreditMinor += row.periodCreditMinor;
    closingBalanceMinor += closing;
  }

  parties.sort((a, b) => {
    if ((a.partyId === null) !== (b.partyId === null)) return a.partyId === null ? 1 : -1;
    return a.partyName.localeCompare(b.partyName);
  });

  return {
    parties,
    totals: { openingBalanceMinor, periodDebitMinor, periodCreditMinor, closingBalanceMinor },
  };
}

export const AGING_BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;

export type AgingLine = { date: string; debitMinor: number; creditMinor: number };

function daysBetween(from: string, to: string) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((b - a) / 86_400_000);
}

/**
 * Open-item aging. Lines are netted to the kind's normal side; settlements (the opposite side)
 * clear the oldest charges first. Whatever settlement is left over is "unapplied" (e.g. an advance
 * receipt) and reduces the total. Lines dated after asOf are ignored.
 */
export function ageLines(lines: AgingLine[], asOf: string, normal: NormalBalance) {
  const sorted = lines
    .filter((l) => l.date <= asOf)
    .sort((a, b) => a.date.localeCompare(b.date));
  const charges: { date: string; amount: number }[] = [];
  let settlement = 0;
  for (const l of sorted) {
    const net = signedBalance(l.debitMinor, l.creditMinor, normal);
    if (net > 0) charges.push({ date: l.date, amount: net });
    else settlement += -net;
  }
  for (const c of charges) {
    if (settlement <= 0) break;
    const used = Math.min(c.amount, settlement);
    c.amount -= used;
    settlement -= used;
  }
  const buckets = [0, 0, 0, 0];
  for (const c of charges) {
    if (c.amount === 0) continue;
    const days = daysBetween(c.date, asOf);
    const idx = days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3;
    buckets[idx] += c.amount;
  }
  const outstandingMinor = buckets.reduce((s, n) => s + n, 0);
  return {
    buckets,
    unappliedMinor: settlement,
    outstandingMinor,
    totalMinor: outstandingMinor - settlement,
  };
}

export type PartyAgingRow = {
  partyId: string | null;
  partyName: string;
  partyType: string | null;
  buckets: number[];
  unappliedMinor: number;
  totalMinor: number;
};

export function summarizeAging(
  parties: Array<{
    partyId: string | null;
    partyName: string | null;
    partyType: string | null;
    lines: AgingLine[];
  }>,
  asOf: string,
  normal: NormalBalance,
) {
  const rows: PartyAgingRow[] = [];
  const totals = { buckets: [0, 0, 0, 0], unappliedMinor: 0, totalMinor: 0 };
  for (const p of parties) {
    const aged = ageLines(p.lines, asOf, normal);
    if (aged.outstandingMinor === 0 && aged.unappliedMinor === 0) continue;
    rows.push({
      partyId: p.partyId,
      partyName: p.partyId ? p.partyName || "Unnamed" : "Unassigned",
      partyType: p.partyType,
      buckets: aged.buckets,
      unappliedMinor: aged.unappliedMinor,
      totalMinor: aged.totalMinor,
    });
    aged.buckets.forEach((n, i) => (totals.buckets[i] += n));
    totals.unappliedMinor += aged.unappliedMinor;
    totals.totalMinor += aged.totalMinor;
  }
  rows.sort((a, b) => b.totalMinor - a.totalMinor || a.partyName.localeCompare(b.partyName));
  return { asOf, buckets: [...AGING_BUCKETS], parties: rows, totals };
}

export function agingCsv(aging: ReturnType<typeof summarizeAging>, partyLabel: string) {
  return toCsv(
    [partyLabel, ...aging.buckets, "Unapplied", "Total"],
    [
      ...aging.parties.map((p) => [
        p.partyName,
        ...p.buckets.map(formatMinor),
        formatMinor(-p.unappliedMinor),
        formatMinor(p.totalMinor),
      ]),
      [
        "Total",
        ...aging.totals.buckets.map(formatMinor),
        formatMinor(-aging.totals.unappliedMinor),
        formatMinor(aging.totals.totalMinor),
      ],
    ],
  );
}

export type GroupBalanceRow = {
  clientId: string;
  clientName: string;
  kind: LedgerKind;
  debitMinor: number;
  creditMinor: number;
};

/** One row per company with a signed closing balance per ledger kind, plus group totals. */
export function summarizeGroup(clients: Array<{ id: string; name: string }>, rows: GroupBalanceRow[]) {
  const totals = Object.fromEntries(LEDGER_KINDS.map((k) => [k, 0])) as Record<LedgerKind, number>;
  const companies = clients.map((c) => {
    const balances = Object.fromEntries(LEDGER_KINDS.map((k) => [k, 0])) as Record<LedgerKind, number>;
    for (const r of rows) {
      if (r.clientId !== c.id) continue;
      balances[r.kind] += signedBalance(r.debitMinor, r.creditMinor, LEDGER_KIND_META[r.kind].normalBalance);
    }
    LEDGER_KINDS.forEach((k) => (totals[k] += balances[k]));
    return { clientId: c.id, clientName: c.name, balances };
  });
  companies.sort((a, b) => a.clientName.localeCompare(b.clientName));
  return { companies, totals };
}

export function toCsv(headers: string[], rows: string[][]) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function summaryCsv(
  kind: LedgerKind,
  summary: ReturnType<typeof summarizeParties>,
) {
  const meta = LEDGER_KIND_META[kind];
  return toCsv(
    [meta.partyLabel, "Opening", "Debits", "Credits", "Closing"],
    [
      ...summary.parties.map((p) => [
        p.partyName,
        formatMinor(p.openingBalanceMinor),
        formatMinor(p.periodDebitMinor),
        formatMinor(p.periodCreditMinor),
        formatMinor(p.closingBalanceMinor),
      ]),
      [
        "Total",
        formatMinor(summary.totals.openingBalanceMinor),
        formatMinor(summary.totals.periodDebitMinor),
        formatMinor(summary.totals.periodCreditMinor),
        formatMinor(summary.totals.closingBalanceMinor),
      ],
    ],
  );
}

export function statementCsv(statement: ReturnType<typeof buildStatement>) {
  return toCsv(
    ["Date", "Entry", "Voucher", "Reference", "Account", "Description", "Debit", "Credit", "Balance"],
    [
      ["", "", "", "", "", "Opening balance", "", "", formatMinor(statement.openingBalanceMinor)],
      ...statement.lines.map((l) => [
        l.entryDate,
        l.entryNo || l.entryId.slice(0, 8),
        l.voucherType,
        l.reference,
        `${l.accountCode} ${l.accountName}`,
        l.memo,
        l.debitMinor ? formatMinor(l.debitMinor) : "",
        l.creditMinor ? formatMinor(l.creditMinor) : "",
        formatMinor(l.balanceMinor),
      ]),
      [
        "",
        "",
        "",
        "",
        "",
        "Closing balance",
        formatMinor(statement.totalDebitMinor),
        formatMinor(statement.totalCreditMinor),
        formatMinor(statement.closingBalanceMinor),
      ],
    ],
  );
}

const TRN_RE = /^1\d{14}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type PartyInput = {
  name: string;
  partyType: PartyType;
  trn: string | null;
  email: string | null;
};

export function normalizePartyInput(raw: {
  name?: unknown;
  partyType?: unknown;
  trn?: unknown;
  email?: unknown;
}): PartyInput {
  const name = String(raw.name ?? "").replace(/\s+/g, " ").trim();
  if (!name) throw new BooksError("party_name_required", "invalid_party");
  if (name.length > 200) throw new BooksError("party_name_too_long", "invalid_party");
  if (!isPartyType(raw.partyType)) throw new BooksError("party_type_invalid", "invalid_party");

  const trnRaw = raw.trn == null ? "" : String(raw.trn).replace(/\s+/g, "");
  if (trnRaw && !TRN_RE.test(trnRaw)) throw new BooksError("party_trn_invalid", "invalid_party");

  const emailRaw = raw.email == null ? "" : String(raw.email).trim();
  if (emailRaw && !EMAIL_RE.test(emailRaw)) throw new BooksError("party_email_invalid", "invalid_party");

  return { name, partyType: raw.partyType, trn: trnRaw || null, email: emailRaw || null };
}
