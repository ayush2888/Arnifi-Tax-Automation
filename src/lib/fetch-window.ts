/** Page size requested from the API. The grid never loads the full table. */
export const WINDOW = 200;

/** Align a visible row span to whole windows, capped at the API limit. */
export function windowFor(firstRow: number, lastRow: number): { offset: number; limit: number } {
  const start = Math.max(0, firstRow);
  const end = Math.max(start, lastRow);
  const offset = Math.floor(start / WINDOW) * WINDOW;
  const pages = Math.ceil((end + 1 - offset) / WINDOW);
  return { offset, limit: Math.min(500, pages * WINDOW) };
}

/** DOM nodes the virtualizer mounts for one viewport, including overscan. */
export function mountedRowBudget(viewportRows: number, overscan: number): number {
  return viewportRows + overscan * 2;
}
