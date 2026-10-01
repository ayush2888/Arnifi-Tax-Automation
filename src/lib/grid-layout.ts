export type MonthBucket = { month: string; count: number };

export type GridSlot =
  | { type: "row"; rowIndex: number }
  | { type: "header"; month: string };

/** Virtual row count when month headers are inserted ahead of each bucket. */
export function virtualCount(total: number, months: MonthBucket[] | null): number {
  if (!months) return total;
  return total + months.length;
}

export function locate(index: number, total: number, months: MonthBucket[] | null): GridSlot {
  if (!months) return { type: "row", rowIndex: index };
  let cursor = 0;
  let row = 0;
  for (const bucket of months) {
    if (index === cursor) return { type: "header", month: bucket.month };
    cursor += 1;
    if (index < cursor + bucket.count) {
      return { type: "row", rowIndex: row + (index - cursor) };
    }
    cursor += bucket.count;
    row += bucket.count;
  }
  return { type: "row", rowIndex: Math.max(0, Math.min(total - 1, row)) };
}
