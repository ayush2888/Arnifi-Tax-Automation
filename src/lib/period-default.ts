export type PeriodLike = {
  id: string;
  status: string;
  periodStart?: string | null;
  period_start?: string | null;
};

function startOf(period: PeriodLike) {
  return String(period.periodStart || period.period_start || "");
}

function isOpen(period: PeriodLike) {
  return period.status === "OPEN" || period.status === "REOPENED";
}

function containsUtcDate(period: PeriodLike, isoDate: string) {
  const start = startOf(period);
  if (!start || start.length < 10) return false;
  // period_end is inclusive; if missing, treat as same calendar month as start.
  const end =
    // callers may pass periodEnd later; tolerate start-only by month match
    (period as { periodEnd?: string; period_end?: string }).periodEnd ||
    (period as { periodEnd?: string; period_end?: string }).period_end ||
    `${start.slice(0, 8)}${String(new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
  return isoDate >= start.slice(0, 10) && isoDate <= String(end).slice(0, 10);
}

/**
 * Default open month for the top bar / ledger screens.
 * Prefer the month containing today; else the earliest open month (not the newest —
 * DESC + first-OPEN was wrongly landing on Dec for a full FY of OPEN months).
 */
export function pickDefaultPeriodId(periods: PeriodLike[], now = new Date()): string {
  if (!periods.length) return "";
  const open = periods.filter(isOpen);
  const pool = open.length ? open : [...periods];
  const today = now.toISOString().slice(0, 10);

  const containing = pool.find((p) => containsUtcDate(p, today));
  if (containing) return containing.id;

  const sorted = [...pool].sort((a, b) => startOf(a).localeCompare(startOf(b)));
  return sorted[0]?.id || periods[0]?.id || "";
}
