import { BooksError } from "@/server/books/errors";

export type BudgetAccountType = "income" | "expense";

/**
 * Favourable variance is positive: income above budget or expense below budget.
 * Actuals and budgets are positive amounts on the account's natural side.
 */
export function budgetVariance(accountType: BudgetAccountType, budgetMinor: number, actualMinor: number) {
  return accountType === "income" ? actualMinor - budgetMinor : budgetMinor - actualMinor;
}

export type BudgetLineInput = {
  accountId: string;
  code: string;
  name: string;
  accountType: BudgetAccountType;
  budgetMinor: number;
  actualMinor: number;
};

export function summarizeBudget(lines: BudgetLineInput[]) {
  const rows = lines
    .map((l) => ({
      ...l,
      varianceMinor: budgetVariance(l.accountType, l.budgetMinor, l.actualMinor),
      usedPct: l.budgetMinor > 0 ? Math.round((l.actualMinor / l.budgetMinor) * 1000) / 10 : null,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const sum = (type: BudgetAccountType, key: "budgetMinor" | "actualMinor") =>
    rows.filter((r) => r.accountType === type).reduce((s, r) => s + r[key], 0);
  const totals = {
    incomeBudgetMinor: sum("income", "budgetMinor"),
    incomeActualMinor: sum("income", "actualMinor"),
    expenseBudgetMinor: sum("expense", "budgetMinor"),
    expenseActualMinor: sum("expense", "actualMinor"),
  };
  return {
    rows,
    totals: {
      ...totals,
      netBudgetMinor: totals.incomeBudgetMinor - totals.expenseBudgetMinor,
      netActualMinor: totals.incomeActualMinor - totals.expenseActualMinor,
    },
  };
}

export function normalizeBudgetAmount(raw: unknown) {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) {
    throw new BooksError("budget_amount_invalid", "invalid_budget");
  }
  return n;
}

export const ASSET_CATEGORIES = [
  "furniture",
  "equipment",
  "vehicles",
  "it_hardware",
  "buildings",
  "leasehold",
  "other",
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export type AssetInput = {
  name: string;
  category: AssetCategory;
  acquisitionDate: string;
  costMinor: number;
  residualMinor: number;
  usefulLifeMonths: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" && DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

export function normalizeAssetInput(raw: Record<string, unknown>): AssetInput {
  const name = String(raw.name ?? "").replace(/\s+/g, " ").trim();
  if (!name) throw new BooksError("asset_name_required", "invalid_asset");
  if (name.length > 200) throw new BooksError("asset_name_too_long", "invalid_asset");
  const category = raw.category as AssetCategory;
  if (!(ASSET_CATEGORIES as readonly string[]).includes(category)) {
    throw new BooksError("asset_category_invalid", "invalid_asset");
  }
  if (!isIsoDate(raw.acquisitionDate)) throw new BooksError("asset_date_invalid", "invalid_asset");
  const costMinor = Number(raw.costMinor);
  const residualMinor = raw.residualMinor == null || raw.residualMinor === "" ? 0 : Number(raw.residualMinor);
  const usefulLifeMonths = Number(raw.usefulLifeMonths);
  if (!Number.isSafeInteger(costMinor) || costMinor <= 0) throw new BooksError("asset_cost_invalid", "invalid_asset");
  if (!Number.isSafeInteger(residualMinor) || residualMinor < 0 || residualMinor > costMinor) {
    throw new BooksError("asset_residual_invalid", "invalid_asset");
  }
  if (!Number.isInteger(usefulLifeMonths) || usefulLifeMonths < 1 || usefulLifeMonths > 600) {
    throw new BooksError("asset_life_invalid", "invalid_asset");
  }
  return { name, category, acquisitionDate: raw.acquisitionDate, costMinor, residualMinor, usefulLifeMonths };
}

function monthIndex(date: string) {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

/**
 * Straight line, full-month convention: depreciation starts in the month of acquisition and
 * stops after the useful life or in the month of disposal. Integer maths, exact at the end of life.
 */
export function accumulatedDepreciation(
  asset: Pick<AssetInput, "acquisitionDate" | "costMinor" | "residualMinor" | "usefulLifeMonths">,
  asOf: string,
  disposalDate?: string | null,
) {
  const end = disposalDate && disposalDate < asOf ? disposalDate : asOf;
  const months = Math.min(
    asset.usefulLifeMonths,
    Math.max(0, monthIndex(end) - monthIndex(asset.acquisitionDate) + 1),
  );
  const base = asset.costMinor - asset.residualMinor;
  if (months >= asset.usefulLifeMonths) return base;
  return Math.floor((base * months) / asset.usefulLifeMonths);
}

export function assetPosition(
  asset: Pick<AssetInput, "acquisitionDate" | "costMinor" | "residualMinor" | "usefulLifeMonths">,
  asOf: string,
  disposalDate?: string | null,
) {
  const accumulatedMinor = accumulatedDepreciation(asset, asOf, disposalDate);
  const priorEnd = `${new Date(Date.parse(`${asOf.slice(0, 7)}-01T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10)}`;
  const priorMinor = accumulatedDepreciation(asset, priorEnd, disposalDate);
  return {
    accumulatedMinor,
    periodChargeMinor: accumulatedMinor - priorMinor,
    netBookValueMinor: asset.costMinor - accumulatedMinor,
  };
}

export function depreciationSchedule(
  asset: Pick<AssetInput, "acquisitionDate" | "costMinor" | "residualMinor" | "usefulLifeMonths">,
) {
  const start = monthIndex(asset.acquisitionDate);
  const rows: { month: string; chargeMinor: number; accumulatedMinor: number; netBookValueMinor: number }[] = [];
  let previous = 0;
  for (let i = 0; i < asset.usefulLifeMonths; i++) {
    const idx = start + i;
    const month = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
    const accumulatedMinor = accumulatedDepreciation(asset, `${month}-01`);
    rows.push({
      month,
      chargeMinor: accumulatedMinor - previous,
      accumulatedMinor,
      netBookValueMinor: asset.costMinor - accumulatedMinor,
    });
    previous = accumulatedMinor;
  }
  return rows;
}
