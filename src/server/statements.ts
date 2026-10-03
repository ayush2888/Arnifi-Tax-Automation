import { createHash, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { withUser } from "@/lib/db";
import { LedgerError } from "@/server/errors";
import { dualControlRequired, markVatPacksStale } from "@/server/release";

export type StatementLine = {
  accountId: string;
  code: string;
  name: string;
  accountType: string;
  amountMinor: number;
};

export type IntegrityGates = {
  tbBalanced: boolean;
  accountingEquation: boolean;
  reRollForward: boolean;
  ready: boolean;
  deltas: {
    tbDeltaMinor: number;
    equationDeltaMinor: number;
    reRollDeltaMinor: number;
  };
};

export type FinancialStatements = {
  period: { id: string; label: string; periodStart: string; periodEnd: string; status: string };
  pnl: { lines: StatementLine[]; incomeMinor: number; expenseMinor: number; netIncomeMinor: number };
  balanceSheet: {
    assets: StatementLine[];
    liabilities: StatementLine[];
    equity: StatementLine[];
    totalAssetsMinor: number;
    totalLiabilitiesMinor: number;
    totalEquityMinor: number;
  };
  cashFlow: {
    method: "indirect_demo";
    netIncomeMinor: number;
    netCashMinor: number;
    openingCashMinor: number;
    closingCashMinor: number;
    note: string;
  };
  retainedEarnings: {
    openingMinor: number;
    netIncomeMinor: number;
    dividendsMinor: number;
    closingMinor: number;
    yearEndClosed: boolean;
  };
  integrity: IntegrityGates;
  ruleVersion: string;
};

function netForType(accountType: string, debit: number, credit: number) {
  if (accountType === "asset" || accountType === "expense") return debit - credit;
  return credit - debit;
}

async function periodAccounts(db: PoolClient, clientId: string, periodId: string) {
  const rows = await db.query(
    `SELECT a.id AS "accountId", a.code, a.name, a.account_type AS "accountType",
            COALESCE(SUM(l.debit_minor), 0)::bigint AS "debitMinor",
            COALESCE(SUM(l.credit_minor), 0)::bigint AS "creditMinor"
     FROM chart_accounts a
     LEFT JOIN (
       SELECT l.account_id, l.debit_minor, l.credit_minor
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       WHERE e.client_id = $1 AND e.period_id = $2 AND e.status = 'posted'
     ) l ON l.account_id = a.id
     WHERE a.client_id = $1 AND a.active
     GROUP BY a.id
     ORDER BY a.code`,
    [clientId, periodId],
  );
  return rows.rows.map((row) => ({
    accountId: String(row.accountId),
    code: String(row.code),
    name: String(row.name),
    accountType: String(row.accountType),
    debitMinor: Number(row.debitMinor),
    creditMinor: Number(row.creditMinor),
    netMinor: netForType(String(row.accountType), Number(row.debitMinor), Number(row.creditMinor)),
  }));
}

async function openingBalance(
  db: PoolClient,
  clientId: string,
  accountId: string,
  beforeDate: string,
) {
  const row = await db.query(
    `SELECT COALESCE(SUM(l.debit_minor), 0)::bigint AS debit,
            COALESCE(SUM(l.credit_minor), 0)::bigint AS credit,
            a.account_type
     FROM chart_accounts a
     LEFT JOIN (
       SELECT l.account_id, l.debit_minor, l.credit_minor
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       WHERE e.client_id = $1 AND e.status = 'posted' AND e.entry_date < $3::date
     ) l ON l.account_id = a.id
     WHERE a.id = $2 AND a.client_id = $1
     GROUP BY a.account_type`,
    [clientId, accountId, beforeDate],
  );
  if (!row.rowCount) return 0;
  return netForType(String(row.rows[0].account_type), Number(row.rows[0].debit), Number(row.rows[0].credit));
}

export function evaluateIntegrity(args: {
  totalDebit: number;
  totalCredit: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  openingRe: number;
  netIncome: number;
  dividends: number;
  closingRe: number;
}): IntegrityGates {
  const tbDelta = args.totalDebit - args.totalCredit;
  const equationDelta = args.totalAssets - (args.totalLiabilities + args.totalEquity);
  const reExpected = args.openingRe + args.netIncome - args.dividends;
  const reDelta = args.closingRe - reExpected;
  const tbBalanced = tbDelta === 0;
  const accountingEquation = equationDelta === 0;
  const reRollForward = reDelta === 0;
  return {
    tbBalanced,
    accountingEquation,
    reRollForward,
    ready: tbBalanced && accountingEquation && reRollForward,
    deltas: {
      tbDeltaMinor: tbDelta,
      equationDeltaMinor: equationDelta,
      reRollDeltaMinor: reDelta,
    },
  };
}

export async function buildFinancialStatements(
  db: PoolClient,
  clientId: string,
  periodId: string,
): Promise<FinancialStatements> {
  const period = await db.query(
    `SELECT id, label, period_start AS "periodStart", period_end AS "periodEnd", status
     FROM accounting_periods WHERE id = $1 AND client_id = $2`,
    [periodId, clientId],
  );
  if (!period.rowCount) throw new LedgerError("period_not_found", "not_found");
  const p = period.rows[0];
  const accounts = await periodAccounts(db, clientId, periodId);

  const incomeLines = accounts
    .filter((a) => a.accountType === "income" && a.netMinor !== 0)
    .map((a) => ({
      accountId: a.accountId,
      code: a.code,
      name: a.name,
      accountType: a.accountType,
      amountMinor: a.netMinor,
    }));
  const expenseLines = accounts
    .filter((a) => a.accountType === "expense" && a.netMinor !== 0)
    .map((a) => ({
      accountId: a.accountId,
      code: a.code,
      name: a.name,
      accountType: a.accountType,
      amountMinor: a.netMinor,
    }));
  const incomeMinor = incomeLines.reduce((s, l) => s + l.amountMinor, 0);
  const expenseMinor = expenseLines.reduce((s, l) => s + l.amountMinor, 0);
  const netIncomeMinor = incomeMinor - expenseMinor;

  const ye = await db.query(
    `SELECT id, net_income_minor AS "netIncomeMinor"
     FROM year_end_closes WHERE client_id = $1 AND period_id = $2`,
    [clientId, periodId],
  );
  const yearEndClosed = Boolean(ye.rowCount);
  const closedNiMinor = yearEndClosed ? Number(ye.rows[0].netIncomeMinor) : null;

  const assets = accounts
    .filter((a) => a.accountType === "asset" && a.netMinor !== 0)
    .map((a) => ({
      accountId: a.accountId,
      code: a.code,
      name: a.name,
      accountType: a.accountType,
      amountMinor: a.netMinor,
    }));
  const liabilities = accounts
    .filter((a) => a.accountType === "liability" && a.netMinor !== 0)
    .map((a) => ({
      accountId: a.accountId,
      code: a.code,
      name: a.name,
      accountType: a.accountType,
      amountMinor: a.netMinor,
    }));
  const equityBase = accounts
    .filter((a) => a.accountType === "equity" && a.netMinor !== 0)
    .map((a) => ({
      accountId: a.accountId,
      code: a.code,
      name: a.name,
      accountType: a.accountType,
      amountMinor: a.netMinor,
    }));
  const equity = [...equityBase];
  if (!yearEndClosed && netIncomeMinor !== 0) {
    equity.push({
      accountId: "current-period-ni",
      code: "NI",
      name: "Current period surplus/(deficit)",
      accountType: "equity",
      amountMinor: netIncomeMinor,
    });
  }

  const totalAssetsMinor = assets.reduce((s, l) => s + l.amountMinor, 0);
  const totalLiabilitiesMinor = liabilities.reduce((s, l) => s + l.amountMinor, 0);
  const totalEquityMinor = equity.reduce((s, l) => s + l.amountMinor, 0);

  const reAccount = accounts.find((a) => a.code === "3000");
  const openingRe = reAccount
    ? await openingBalance(db, clientId, reAccount.accountId, String(p.periodStart))
    : 0;
  const dividendsMinor = 0;
  const niForRoll = yearEndClosed ? Number(closedNiMinor) : netIncomeMinor;
  // Before YE close: closing RE = opening + NI. After: opening + period RE movement (the close entry).
  const closingReComputed = yearEndClosed
    ? openingRe + (reAccount?.netMinor || 0)
    : openingRe + niForRoll - dividendsMinor;

  const bank = accounts.find((a) => a.code === "1000");
  const openingCash = bank ? await openingBalance(db, clientId, bank.accountId, String(p.periodStart)) : 0;
  const closingCash = openingCash + (bank?.netMinor || 0);

  const totalDebit = accounts.reduce((s, a) => s + a.debitMinor, 0);
  const totalCredit = accounts.reduce((s, a) => s + a.creditMinor, 0);

  const integrity = evaluateIntegrity({
    totalDebit,
    totalCredit,
    totalAssets: totalAssetsMinor,
    totalLiabilities: totalLiabilitiesMinor,
    totalEquity: totalEquityMinor,
    openingRe,
    netIncome: niForRoll,
    dividends: dividendsMinor,
    closingRe: closingReComputed,
  });

  return {
    period: {
      id: p.id,
      label: p.label,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      status: p.status,
    },
    pnl: {
      lines: [...incomeLines, ...expenseLines],
      incomeMinor,
      expenseMinor,
      netIncomeMinor,
    },
    balanceSheet: {
      assets,
      liabilities,
      equity,
      totalAssetsMinor,
      totalLiabilitiesMinor,
      totalEquityMinor,
    },
    cashFlow: {
      method: "indirect_demo",
      netIncomeMinor,
      netCashMinor: closingCash - openingCash,
      openingCashMinor: openingCash,
      closingCashMinor: closingCash,
      note: "Demo CF uses bank control movement for the period (not a full IAS 7 worksheet).",
    },
    retainedEarnings: {
      openingMinor: openingRe,
      netIncomeMinor: niForRoll,
      dividendsMinor,
      closingMinor: closingReComputed,
      yearEndClosed,
    },
    integrity,
    ruleVersion: "statements-demo-v1",
  };
}

export function hashStatementsPayload(payload: FinancialStatements) {
  const canonical = JSON.stringify({
    kind: "STATEMENTS",
    periodId: payload.period.id,
    netIncomeMinor: payload.pnl.netIncomeMinor,
    totalAssetsMinor: payload.balanceSheet.totalAssetsMinor,
    totalLiabilitiesMinor: payload.balanceSheet.totalLiabilitiesMinor,
    totalEquityMinor: payload.balanceSheet.totalEquityMinor,
    closingReMinor: payload.retainedEarnings.closingMinor,
    integrity: payload.integrity,
    ruleVersion: payload.ruleVersion,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export async function getFinancialStatements(userId: string, clientId: string, periodId: string) {
  return withUser(userId, async (db) => buildFinancialStatements(db, clientId, periodId));
}

export async function yearEndCloseToRE(userId: string, clientId: string, periodId: string, note = "") {
  return withUser(userId, async (db) => {
    const existing = await db.query(
      `SELECT id FROM year_end_closes WHERE client_id = $1 AND period_id = $2`,
      [clientId, periodId],
    );
    if (existing.rowCount) throw new LedgerError("year_end_already_closed", "conflict");

    const period = await db.query(
      `SELECT id, status, period_end FROM accounting_periods WHERE id = $1 AND client_id = $2`,
      [periodId, clientId],
    );
    if (!period.rowCount) throw new LedgerError("period_not_found", "not_found");
    if (!["OPEN", "REOPENED"].includes(period.rows[0].status)) {
      throw new LedgerError("period_closed", "period_closed");
    }

    const statements = await buildFinancialStatements(db, clientId, periodId);
    if (!statements.integrity.tbBalanced) {
      throw new LedgerError("tb_not_balanced", "conflict");
    }

    const accounts = await periodAccounts(db, clientId, periodId);
    const re = accounts.find((a) => a.code === "3000");
    if (!re) throw new LedgerError("missing_re_account", "coa_incomplete");

    const lines: { accountId: string; debitMinor?: number; creditMinor?: number }[] = [];
    for (const a of accounts.filter((row) => row.accountType === "income" && row.netMinor !== 0)) {
      lines.push({ accountId: a.accountId, debitMinor: a.netMinor });
    }
    for (const a of accounts.filter((row) => row.accountType === "expense" && row.netMinor !== 0)) {
      lines.push({ accountId: a.accountId, creditMinor: a.netMinor });
    }
    const ni = statements.pnl.netIncomeMinor;
    if (ni > 0) lines.push({ accountId: re.accountId, creditMinor: ni });
    else if (ni < 0) lines.push({ accountId: re.accountId, debitMinor: Math.abs(ni) });
    else throw new LedgerError("nothing_to_close", "bad_request");

    let debit = 0;
    let credit = 0;
    for (const line of lines) {
      debit += line.debitMinor ?? 0;
      credit += line.creditMinor ?? 0;
    }
    if (debit !== credit) throw new LedgerError("journal_unbalanced", "journal_unbalanced");

    const entryId = randomUUID();
    await db.query(
      `INSERT INTO journal_entries (
         id, client_id, period_id, memo, entry_date, status, created_by, posted_at
       ) VALUES ($1,$2,$3,$4,$5,'posted',$6,now())`,
      [entryId, clientId, periodId, "Year-end close P&L to RE", period.rows[0].period_end, userId],
    );
    for (const line of lines) {
      await db.query(
        `INSERT INTO journal_lines (
           id, entry_id, client_id, account_id, debit_minor, credit_minor, currency, line_memo
         ) VALUES ($1,$2,$3,$4,$5,$6,'AED',$7)`,
        [
          randomUUID(),
          entryId,
          clientId,
          line.accountId,
          line.debitMinor ?? 0,
          line.creditMinor ?? 0,
          "YE close",
        ],
      );
    }
    await db.query(
      `INSERT INTO year_end_closes (
         id, client_id, period_id, journal_entry_id, net_income_minor, actor_id, note
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), clientId, periodId, entryId, ni, userId, note || ""],
    );
    await markVatPacksStale(db, clientId, periodId);
    const after = await buildFinancialStatements(db, clientId, periodId);
    return { journalEntryId: entryId, netIncomeMinor: ni, statements: after };
  });
}

export async function prepareStatementsPack(userId: string, clientId: string, periodId: string) {
  return withUser(userId, async (db) => {
    const payload = await buildFinancialStatements(db, clientId, periodId);
    if (!payload.integrity.ready) {
      throw new LedgerError("integrity_gates_failed", "conflict");
    }
    const contentHash = hashStatementsPayload(payload);
    const versionRow = await db.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next
       FROM release_packs
       WHERE client_id = $1 AND period_id = $2 AND kind = 'STATEMENTS'`,
      [clientId, periodId],
    );
    const version = Number(versionRow.rows[0].next);
    const id = randomUUID();
    await db.query(
      `INSERT INTO release_packs (
         id, client_id, period_id, kind, version, status, content_hash, payload_json, prepared_by
       ) VALUES ($1,$2,$3,'STATEMENTS',$4,'PENDING_APPROVAL',$5,$6::jsonb,$7)`,
      [id, clientId, periodId, version, contentHash, JSON.stringify(payload), userId],
    );
    await db.query(
      `INSERT INTO pack_approvals (id, pack_id, client_id, actor_id, role, content_hash)
       VALUES ($1,$2,$3,$4,'preparer',$5)`,
      [randomUUID(), id, clientId, userId, contentHash],
    );
    return {
      id,
      version,
      status: "PENDING_APPROVAL",
      contentHash,
      integrity: payload.integrity,
      dualControlRequired: dualControlRequired(),
    };
  });
}

export async function approveStatementsPack(userId: string, clientId: string, packId: string) {
  return withUser(userId, async (db) => {
    const pack = await db.query(
      `SELECT id, period_id, status, content_hash, prepared_by
       FROM release_packs WHERE id = $1 AND client_id = $2 AND kind = 'STATEMENTS'`,
      [packId, clientId],
    );
    if (!pack.rowCount) throw new LedgerError("pack_not_found", "not_found");
    const row = pack.rows[0];
    if (row.status === "STALE") throw new LedgerError("pack_stale", "conflict");
    if (row.status === "RELEASED") throw new LedgerError("already_released", "conflict");
    if (row.status !== "PENDING_APPROVAL" && row.status !== "DRAFT") {
      throw new LedgerError("pack_not_approvable", "conflict");
    }

    const live = await buildFinancialStatements(db, clientId, row.period_id);
    if (!live.integrity.ready) throw new LedgerError("integrity_gates_failed", "conflict");
    const liveHash = hashStatementsPayload(live);
    if (liveHash !== row.content_hash) {
      await db.query(`UPDATE release_packs SET status = 'STALE' WHERE id = $1`, [packId]);
      throw new LedgerError("pack_stale_hash_mismatch", "conflict");
    }
    if (dualControlRequired() && String(row.prepared_by) === String(userId)) {
      throw new LedgerError("preparer_cannot_approve", "forbidden");
    }

    await db.query(
      `UPDATE release_packs
       SET status = 'RELEASED', approved_by = $2, approved_at = now(), released_at = now(),
           payload_json = $3::jsonb
       WHERE id = $1`,
      [packId, userId, JSON.stringify(live)],
    );
    await db.query(
      `INSERT INTO pack_approvals (id, pack_id, client_id, actor_id, role, content_hash)
       VALUES ($1,$2,$3,$4,'approver',$5)`,
      [randomUUID(), packId, clientId, userId, liveHash],
    );
    return { id: packId, status: "RELEASED", contentHash: liveHash };
  });
}
