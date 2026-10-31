import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { withUser } from "@/lib/db";
import { LedgerError } from "@/server/errors";
import { assertSyntheticTenant } from "@/server/security-gate";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(year: number, month1: number) {
  return `${MONTH_LABELS[month1 - 1]} ${year}`;
}

function lastDayOfMonth(year: number, month1: number) {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Twelve calendar months for a fiscal year that starts at `startMonth` in `fiscalYear`. */
export function fiscalYearMonths(fiscalYear: number, startMonth: number) {
  const start = Math.min(12, Math.max(1, Math.trunc(startMonth) || 1));
  const months: { label: string; periodStart: string; periodEnd: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const offset = start - 1 + i;
    const month1 = (offset % 12) + 1;
    const year = fiscalYear + Math.floor(offset / 12);
    const periodStart = `${year}-${String(month1).padStart(2, "0")}-01`;
    const periodEnd = `${year}-${String(month1).padStart(2, "0")}-${String(lastDayOfMonth(year, month1)).padStart(2, "0")}`;
    months.push({ label: monthLabel(year, month1), periodStart, periodEnd });
  }
  return months;
}

const STARTER_COA: {
  code: string;
  name: string;
  accountType: string;
  isAr?: boolean;
  isAp?: boolean;
  isVatControl?: boolean;
  isBank?: boolean;
  vat201Box?: string | null;
}[] = [
  { code: "1000", name: "Bank", accountType: "asset", isBank: true },
  { code: "1100", name: "Accounts receivable", accountType: "asset", isAr: true },
  { code: "1200", name: "VAT recoverable (input)", accountType: "asset", isVatControl: true, vat201Box: "9" },
  { code: "2000", name: "Accounts payable", accountType: "liability", isAp: true },
  { code: "2100", name: "VAT payable (output)", accountType: "liability", isVatControl: true, vat201Box: "1b" },
  { code: "3000", name: "Retained earnings", accountType: "equity" },
  { code: "4000", name: "Sales revenue", accountType: "income" },
  { code: "5000", name: "Operating expenses", accountType: "expense" },
];

async function seedStarterBooks(db: PoolClient, clientId: string) {
  for (const account of STARTER_COA) {
    const existing = await db.query(`SELECT id FROM chart_accounts WHERE client_id = $1 AND code = $2`, [
      clientId,
      account.code,
    ]);
    if (existing.rowCount) continue;
    await db.query(
      `INSERT INTO chart_accounts (
         id, client_id, code, name, account_type, is_ar, is_ap, is_vat_control, is_bank, vat201_box
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        randomUUID(),
        clientId,
        account.code,
        account.name,
        account.accountType,
        Boolean(account.isAr),
        Boolean(account.isAp),
        Boolean(account.isVatControl),
        Boolean(account.isBank),
        account.vat201Box ?? null,
      ],
    );
  }
  // Bank accounts are not auto-created — accountant adds Wio AED/USD via + Add account.
}

export async function ensureAccountingMonths(
  userId: string,
  clientId: string,
  opts: { fiscalYear: number; fiscalYearStartMonth?: number },
) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    let startMonth = opts.fiscalYearStartMonth;
    if (!startMonth) {
      const row = await db.query(`SELECT fiscal_year_start_month FROM clients WHERE id = $1`, [clientId]);
      if (!row.rowCount) throw new LedgerError("client_not_found", "not_found");
      startMonth = Number(row.rows[0].fiscal_year_start_month) || 1;
    }
    const created: { id: string; label: string }[] = [];
    for (const month of fiscalYearMonths(opts.fiscalYear, startMonth)) {
      const existing = await db.query(
        `SELECT id FROM accounting_periods
         WHERE client_id = $1 AND period_start = $2::date AND period_end = $3::date`,
        [clientId, month.periodStart, month.periodEnd],
      );
      if (existing.rowCount) continue;
      const id = randomUUID();
      await db.query(
        `INSERT INTO accounting_periods (id, client_id, label, period_start, period_end, status)
         VALUES ($1,$2,$3,$4,$5,'OPEN')`,
        [id, clientId, month.label, month.periodStart, month.periodEnd],
      );
      created.push({ id, label: month.label });
    }
    return { created, fiscalYear: opts.fiscalYear, fiscalYearStartMonth: startMonth };
  });
}

export type CreateClientBody = {
  name: string;
  trn?: string | null;
  defaultCurrency?: string;
  fiscalYearStartMonth?: number;
  /** Fiscal year whose 12 months are generated on create (default: current UTC year). */
  fiscalYear?: number;
};

export async function createClient(userId: string, body: CreateClientBody) {
  const name = String(body.name || "").trim();
  if (!name) throw new LedgerError("client_name_required", "bad_request");
  if (name.length > 200) throw new LedgerError("client_name_too_long", "bad_request");

  const currency = String(body.defaultCurrency || "AED").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new LedgerError("invalid_currency", "bad_request");

  const fiscalYearStartMonth = Math.min(12, Math.max(1, Math.trunc(Number(body.fiscalYearStartMonth) || 1)));
  const fiscalYear = Math.trunc(Number(body.fiscalYear) || new Date().getUTCFullYear());
  if (fiscalYear < 2000 || fiscalYear > 2100) throw new LedgerError("invalid_fiscal_year", "bad_request");

  const trn = body.trn ? String(body.trn).trim() : null;

  return withUser(userId, async (db) => {
    const me = await db.query(`SELECT id, firm_id AS "firmId", role FROM users WHERE id = $1`, [userId]);
    if (!me.rowCount) throw new LedgerError("user_not_found", "forbidden");
    if (!["admin", "accountant"].includes(me.rows[0].role)) {
      throw new LedgerError("forbidden", "forbidden");
    }
    const firmId = me.rows[0].firmId as string;

    const id = randomUUID();
    await db.query(
      `INSERT INTO clients (id, firm_id, name, trn, default_currency, is_synthetic, fiscal_year_start_month)
       VALUES ($1,$2,$3,$4,$5,true,$6)`,
      [id, firmId, name, trn, currency, fiscalYearStartMonth],
    );

    // Grant creator + every admin and approver in the firm (approvers post under dual control).
    const peers = await db.query(
      `SELECT id FROM users WHERE firm_id = $1 AND (id = $2 OR role IN ('admin', 'approver'))`,
      [firmId, userId],
    );
    for (const peer of peers.rows) {
      await db.query(
        `INSERT INTO user_client_access (user_id, client_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [peer.id, id],
      );
    }

    await seedStarterBooks(db, id);

    const months = fiscalYearMonths(fiscalYear, fiscalYearStartMonth);
    const periodIds: string[] = [];
    for (const month of months) {
      const periodId = randomUUID();
      await db.query(
        `INSERT INTO accounting_periods (id, client_id, label, period_start, period_end, status)
         VALUES ($1,$2,$3,$4,$5,'OPEN')`,
        [periodId, id, month.label, month.periodStart, month.periodEnd],
      );
      periodIds.push(periodId);
    }

    return {
      id,
      name,
      trn,
      defaultCurrency: currency,
      isSynthetic: true,
      fiscalYearStartMonth,
      fiscalYear,
      periodCount: periodIds.length,
      firstPeriodId: periodIds[0] || null,
    };
  });
}

/** Soft-remove a synthetic client from the company switcher (keeps DB history). */
export async function archiveClient(userId: string, clientId: string) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const me = await db.query(`SELECT role FROM users WHERE id = $1`, [userId]);
    if (!me.rowCount || !["admin", "accountant"].includes(me.rows[0].role)) {
      throw new LedgerError("forbidden", "forbidden");
    }
    const row = await db.query(
      `SELECT id, name, is_synthetic AS "isSynthetic", archived_at AS "archivedAt"
       FROM clients WHERE id = $1`,
      [clientId],
    );
    if (!row.rowCount) throw new LedgerError("client_not_found", "not_found");
    if (row.rows[0].isSynthetic === false) {
      throw new LedgerError("cannot_archive_real_client", "forbidden");
    }
    if (row.rows[0].archivedAt) {
      return { id: clientId, archived: true, name: row.rows[0].name as string };
    }
    await db.query(`UPDATE clients SET archived_at = now() WHERE id = $1`, [clientId]);

    const next = await db.query(
      `SELECT c.id
       FROM clients c
       JOIN user_client_access a ON a.client_id = c.id
       WHERE a.user_id = $1 AND c.archived_at IS NULL
       ORDER BY c.name
       LIMIT 1`,
      [userId],
    );
    return {
      id: clientId,
      archived: true,
      name: row.rows[0].name as string,
      nextClientId: (next.rows[0]?.id as string | undefined) || null,
    };
  });
}
