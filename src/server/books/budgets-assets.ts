import { randomUUID } from "node:crypto";

import { withUser } from "@/lib/db";
import { writeBooksAudit } from "@/server/books/audit";
import {
  assetPosition,
  depreciationSchedule,
  isIsoDate,
  normalizeAssetInput,
  normalizeBudgetAmount,
  summarizeBudget,
  type BudgetAccountType,
} from "@/server/books/budget-assets-core";
import { BooksError } from "@/server/books/errors";
import { isUuid } from "@/server/books/subsidiary-ledgers";
import { assertSyntheticTenant } from "@/server/security-gate";

function writeError(error: unknown): never {
  const code = (error as { code?: string }).code;
  if (code === "42501") throw new BooksError("forbidden", "forbidden");
  throw error;
}

async function loadPeriod(db: Parameters<Parameters<typeof withUser>[1]>[0], clientId: string, periodId: string) {
  if (!isUuid(periodId)) throw new BooksError("period_not_found", "not_found");
  const r = await db.query(
    `SELECT id, label, period_start, period_end FROM books_periods WHERE id = $1 AND client_id = $2`,
    [periodId, clientId],
  );
  if (!r.rowCount) throw new BooksError("period_not_found", "not_found");
  return {
    label: String(r.rows[0].label),
    start: String(r.rows[0].period_start),
    end: String(r.rows[0].period_end),
  };
}

export async function budgetVsActual(userId: string, clientId: string, periodId: string) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const period = await loadPeriod(db, clientId, periodId);
    const res = await db.query(
      `SELECT a.id, a.code, a.name, a.account_type AS "accountType",
              COALESCE(b.amount_minor, 0)::bigint AS "budgetMinor",
              COALESCE(act.net, 0)::bigint AS "actualMinor"
       FROM books_accounts a
       LEFT JOIN books_budgets b ON b.account_id = a.id AND b.period_id = $2
       LEFT JOIN (
         SELECT l.account_id,
                SUM(CASE WHEN acc.account_type = 'income'
                         THEN l.credit_minor - l.debit_minor
                         ELSE l.debit_minor - l.credit_minor END) AS net
         FROM books_journal_lines l
         JOIN books_journal_entries e ON e.id = l.entry_id
           AND e.client_id = $1
           AND e.status IN ('posted', 'reversed')
           AND e.deleted_at IS NULL
           AND e.entry_date >= $3::date AND e.entry_date <= $4::date
         JOIN books_accounts acc ON acc.id = l.account_id
         WHERE l.client_id = $1
         GROUP BY l.account_id
       ) act ON act.account_id = a.id
       WHERE a.client_id = $1 AND a.account_type IN ('income', 'expense') AND a.is_postable
         AND (a.active OR b.amount_minor IS NOT NULL OR act.net IS NOT NULL)
       ORDER BY a.code`,
      [clientId, periodId, period.start, period.end],
    );
    return {
      periodId,
      periodLabel: period.label,
      ...summarizeBudget(
        res.rows.map((r) => ({
          accountId: String(r.id),
          code: String(r.code),
          name: String(r.name),
          accountType: r.accountType as BudgetAccountType,
          budgetMinor: Number(r.budgetMinor),
          actualMinor: Number(r.actualMinor),
        })),
      ),
    };
  });
}

export async function setBudgetLines(
  userId: string,
  clientId: string,
  periodId: string,
  lines: Array<{ accountId?: unknown; amountMinor?: unknown }>,
) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 500) {
    throw new BooksError("budget_lines_invalid", "invalid_budget");
  }
  const parsed = lines.map((l) => {
    if (!isUuid(l.accountId)) throw new BooksError("budget_account_invalid", "invalid_budget");
    return { accountId: l.accountId, amountMinor: normalizeBudgetAmount(l.amountMinor) };
  });
  if (new Set(parsed.map((p) => p.accountId)).size !== parsed.length) {
    throw new BooksError("budget_lines_duplicate", "invalid_budget");
  }
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    await loadPeriod(db, clientId, periodId);
    const valid = await db.query(
      `SELECT id FROM books_accounts
       WHERE client_id = $1 AND id = ANY($2::uuid[]) AND account_type IN ('income', 'expense')`,
      [clientId, parsed.map((p) => p.accountId)],
    );
    if (valid.rowCount !== parsed.length) throw new BooksError("budget_account_invalid", "invalid_budget");
    try {
      for (const p of parsed) {
        await db.query(
          `INSERT INTO books_budgets (client_id, period_id, account_id, amount_minor)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (period_id, account_id)
           DO UPDATE SET amount_minor = EXCLUDED.amount_minor, updated_at = now()`,
          [clientId, periodId, p.accountId, p.amountMinor],
        );
      }
    } catch (error) {
      writeError(error);
    }
    await writeBooksAudit(db, {
      clientId,
      actor: userId,
      action: "set_budget",
      entity: "books_budget",
      entityId: periodId,
      after: { lines: parsed.length },
    });
    return { saved: parsed.length };
  });
}

type AssetRow = {
  id: string;
  name: string;
  category: string;
  acquisition_date: string;
  cost_minor: number;
  residual_minor: number;
  useful_life_months: number;
  disposal_date: string | null;
};

function shapeAsset(r: AssetRow, asOf: string) {
  const core = {
    acquisitionDate: String(r.acquisition_date),
    costMinor: Number(r.cost_minor),
    residualMinor: Number(r.residual_minor),
    usefulLifeMonths: Number(r.useful_life_months),
  };
  const disposalDate = r.disposal_date ? String(r.disposal_date) : null;
  return {
    id: String(r.id),
    name: String(r.name),
    category: String(r.category),
    ...core,
    disposalDate,
    ...assetPosition(core, asOf, disposalDate),
  };
}

export async function listFixedAssets(userId: string, clientId: string, periodId: string) {
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const period = await loadPeriod(db, clientId, periodId);
    const res = await db.query(
      `SELECT id, name, category, acquisition_date, cost_minor, residual_minor, useful_life_months, disposal_date
       FROM books_fixed_assets
       WHERE client_id = $1 AND acquisition_date <= $2::date
       ORDER BY acquisition_date, name`,
      [clientId, period.end],
    );
    const assets = res.rows.map((r) => shapeAsset(r as AssetRow, period.end));
    const sum = (key: "costMinor" | "accumulatedMinor" | "periodChargeMinor" | "netBookValueMinor") =>
      assets.reduce((s, a) => s + a[key], 0);
    return {
      periodId,
      periodLabel: period.label,
      asOf: period.end,
      assets,
      totals: {
        costMinor: sum("costMinor"),
        accumulatedMinor: sum("accumulatedMinor"),
        periodChargeMinor: sum("periodChargeMinor"),
        netBookValueMinor: sum("netBookValueMinor"),
      },
    };
  });
}

export async function createFixedAsset(userId: string, clientId: string, raw: Record<string, unknown>) {
  const input = normalizeAssetInput(raw);
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const id = randomUUID();
    try {
      await db.query(
        `INSERT INTO books_fixed_assets
           (id, client_id, name, category, acquisition_date, cost_minor, residual_minor, useful_life_months)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, clientId, input.name, input.category, input.acquisitionDate, input.costMinor, input.residualMinor, input.usefulLifeMonths],
      );
    } catch (error) {
      writeError(error);
    }
    await writeBooksAudit(db, {
      clientId,
      actor: userId,
      action: "create_asset",
      entity: "books_fixed_asset",
      entityId: id,
      after: { name: input.name, costMinor: input.costMinor },
    });
    return { id, ...input };
  });
}

export async function disposeFixedAsset(userId: string, clientId: string, assetId: string, disposalDate: unknown) {
  if (!isUuid(assetId)) throw new BooksError("asset_not_found", "not_found");
  if (!isIsoDate(disposalDate)) throw new BooksError("asset_date_invalid", "invalid_asset");
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const found = await db.query(
      `SELECT acquisition_date, disposal_date FROM books_fixed_assets WHERE id = $1 AND client_id = $2 FOR UPDATE`,
      [assetId, clientId],
    );
    if (!found.rowCount) throw new BooksError("asset_not_found", "not_found");
    if (found.rows[0].disposal_date) throw new BooksError("asset_already_disposed", "conflict");
    if (disposalDate < String(found.rows[0].acquisition_date)) {
      throw new BooksError("asset_date_invalid", "invalid_asset");
    }
    try {
      const res = await db.query(
        `UPDATE books_fixed_assets SET disposal_date = $3 WHERE id = $1 AND client_id = $2`,
        [assetId, clientId, disposalDate],
      );
      if (!res.rowCount) throw new BooksError("forbidden", "forbidden");
    } catch (error) {
      if (error instanceof BooksError) throw error;
      writeError(error);
    }
    await writeBooksAudit(db, {
      clientId,
      actor: userId,
      action: "dispose_asset",
      entity: "books_fixed_asset",
      entityId: assetId,
      after: { disposalDate },
    });
    return { id: assetId, disposalDate };
  });
}

export async function fixedAssetSchedule(userId: string, clientId: string, assetId: string) {
  if (!isUuid(assetId)) throw new BooksError("asset_not_found", "not_found");
  return withUser(userId, async (db) => {
    await assertSyntheticTenant(db, clientId);
    const res = await db.query(
      `SELECT id, name, category, acquisition_date, cost_minor, residual_minor, useful_life_months, disposal_date
       FROM books_fixed_assets WHERE id = $1 AND client_id = $2`,
      [assetId, clientId],
    );
    if (!res.rowCount) throw new BooksError("asset_not_found", "not_found");
    const row = res.rows[0] as AssetRow;
    const disposal = row.disposal_date ? String(row.disposal_date) : null;
    const core = {
      acquisitionDate: String(row.acquisition_date),
      costMinor: Number(row.cost_minor),
      residualMinor: Number(row.residual_minor),
      usefulLifeMonths: Number(row.useful_life_months),
    };
    const schedule = depreciationSchedule(core).filter((s) => !disposal || `${s.month}-01` <= disposal);
    return { id: String(row.id), name: String(row.name), disposalDate: disposal, ...core, schedule };
  });
}
