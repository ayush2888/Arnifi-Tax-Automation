"use client";

import { useEffect, useState } from "react";

export type LedgerPeriod = {
  id: string;
  label: string;
  status: string;
};

/** Open month for the company in the current session. Reads accounting_periods, not books_periods. */
export function useLedgerPeriod() {
  const [periods, setPeriods] = useState<LedgerPeriod[]>([]);
  const [periodId, setPeriodId] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/periods")
      .then((response) => response.json())
      .then((list: LedgerPeriod[]) => {
        if (cancelled) return;
        const rows = Array.isArray(list) ? list : [];
        setPeriods(rows);
        const open = rows.find((period) => period.status === "OPEN" || period.status === "REOPENED") || rows[0];
        setPeriodId(open?.id || "");
      })
      .catch(() => {
        if (!cancelled) setPeriodId("");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { periods, periodId, setPeriodId };
}

export function LedgerPeriodSelect({
  periods,
  periodId,
  onChange,
}: {
  periods: LedgerPeriod[];
  periodId: string;
  onChange: (id: string) => void;
}) {
  if (periods.length === 0) return null;
  return (
    <label className="text-xs text-muted-foreground">
      Period
      <select
        className="ml-2 rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
        value={periodId}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Accounting period"
      >
        {periods.map((period) => (
          <option key={period.id} value={period.id}>
            {period.label} ({period.status})
          </option>
        ))}
      </select>
    </label>
  );
}
