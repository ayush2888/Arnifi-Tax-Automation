/** UAE-facing display: dd/mm/yyyy. Accepts ISO date or datetime strings. */
export function formatDateUae(value: string | Date | null | undefined): string {
  if (value == null || value === "") return "—";
  const raw = typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return String(value);
  return `${m[3]}/${m[2]}/${m[1]}`;
}
