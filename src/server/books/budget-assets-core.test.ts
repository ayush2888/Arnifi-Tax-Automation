import assert from "node:assert/strict";
import test from "node:test";

import {
  accumulatedDepreciation,
  assetPosition,
  budgetVariance,
  depreciationSchedule,
  isIsoDate,
  normalizeAssetInput,
  normalizeBudgetAmount,
  summarizeBudget,
} from "./budget-assets-core";

const asset = { acquisitionDate: "2026-01-15", costMinor: 1_200_00, residualMinor: 0, usefulLifeMonths: 12 };

test("budgetVariance is positive when favourable", () => {
  assert.equal(budgetVariance("income", 1000, 1200), 200);
  assert.equal(budgetVariance("income", 1000, 800), -200);
  assert.equal(budgetVariance("expense", 1000, 800), 200);
  assert.equal(budgetVariance("expense", 1000, 1300), -300);
});

test("summarizeBudget sorts by code, computes used% and totals", () => {
  const out = summarizeBudget([
    { accountId: "2", code: "5100", name: "Rent", accountType: "expense", budgetMinor: 1000, actualMinor: 1500 },
    { accountId: "1", code: "4100", name: "Sales", accountType: "income", budgetMinor: 5000, actualMinor: 4000 },
    { accountId: "3", code: "5200", name: "Misc", accountType: "expense", budgetMinor: 0, actualMinor: 10 },
  ]);
  assert.deepEqual(out.rows.map((r) => r.code), ["4100", "5100", "5200"]);
  assert.equal(out.rows[1].varianceMinor, -500);
  assert.equal(out.rows[1].usedPct, 150);
  assert.equal(out.rows[2].usedPct, null);
  assert.equal(out.totals.netBudgetMinor, 4000);
  assert.equal(out.totals.netActualMinor, 2490);
});

test("normalizeBudgetAmount accepts integer minor units only", () => {
  assert.equal(normalizeBudgetAmount("2500"), 2500);
  assert.equal(normalizeBudgetAmount(0), 0);
  for (const bad of [-1, 1.5, "abc", "", null, Number.NaN]) {
    assert.throws(() => normalizeBudgetAmount(bad), /budget_amount_invalid/);
  }
});

test("straight-line depreciation is exact at end of life and starts in the acquisition month", () => {
  assert.equal(accumulatedDepreciation(asset, "2025-12-31"), 0);
  assert.equal(accumulatedDepreciation(asset, "2026-01-31"), 10_000);
  assert.equal(accumulatedDepreciation(asset, "2026-06-30"), 60_000);
  assert.equal(accumulatedDepreciation(asset, "2027-01-31"), 120_000);
  assert.equal(accumulatedDepreciation(asset, "2040-01-31"), 120_000);
});

test("residual value is never depreciated and odd amounts add up exactly", () => {
  const odd = { acquisitionDate: "2026-01-01", costMinor: 1_000, residualMinor: 100, usefulLifeMonths: 7 };
  const schedule = depreciationSchedule(odd);
  assert.equal(schedule.length, 7);
  assert.equal(schedule.reduce((s, r) => s + r.chargeMinor, 0), 900);
  assert.equal(schedule[6].netBookValueMinor, 100);
  assert.ok(schedule.every((r) => r.chargeMinor >= 0));
});

test("disposal stops depreciation and assetPosition reports the period charge", () => {
  assert.equal(accumulatedDepreciation(asset, "2026-12-31", "2026-03-10"), 30_000);
  const pos = assetPosition(asset, "2026-03-31");
  assert.equal(pos.accumulatedMinor, 30_000);
  assert.equal(pos.periodChargeMinor, 10_000);
  assert.equal(pos.netBookValueMinor, 90_000);
  const first = assetPosition(asset, "2026-01-31");
  assert.equal(first.periodChargeMinor, 10_000);
});

test("normalizeAssetInput validates every field", () => {
  const ok = normalizeAssetInput({
    name: "  Laptop   fleet ",
    category: "it_hardware",
    acquisitionDate: "2026-02-01",
    costMinor: 500000,
    usefulLifeMonths: 36,
  });
  assert.equal(ok.name, "Laptop fleet");
  assert.equal(ok.residualMinor, 0);
  const base = { name: "X", category: "equipment", acquisitionDate: "2026-02-01", costMinor: 100, usefulLifeMonths: 12 };
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ ...base, name: " " }, "asset_name_required"],
    [{ ...base, category: "boat" }, "asset_category_invalid"],
    [{ ...base, acquisitionDate: "2026-02-30" }, "asset_date_invalid"],
    [{ ...base, costMinor: 0 }, "asset_cost_invalid"],
    [{ ...base, residualMinor: 200 }, "asset_residual_invalid"],
    [{ ...base, usefulLifeMonths: 0 }, "asset_life_invalid"],
    [{ ...base, usefulLifeMonths: 12.5 }, "asset_life_invalid"],
  ];
  for (const [input, code] of cases) assert.throws(() => normalizeAssetInput(input), new RegExp(code));
  assert.equal(isIsoDate("2024-02-29"), true);
  assert.equal(isIsoDate("2025-02-29"), false);
});
