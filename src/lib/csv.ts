/** Quote a cell Excel would otherwise treat as a formula. Plain amounts stay numeric. */

const PLAIN_NUMBER = /^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^-?\d+(?:\.\d+)?$/;

export function csvCell(value: string): string {
  const cell = needsQuote(value) ? `'${value}` : value;
  if (/[",\n]/.test(cell)) return `"${cell.replaceAll('"', '""')}"`;
  return cell;
}

function needsQuote(value: string): boolean {
  if (!value || PLAIN_NUMBER.test(value)) return false;
  return /^[=+\-@\t\r]/.test(value);
}
