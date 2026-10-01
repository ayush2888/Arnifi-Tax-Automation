/** Quote a cell Excel would otherwise treat as a formula. Plain amounts stay numeric. */

const PLAIN_NUMBER = /^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^-?\d+(?:\.\d+)?$/;

export function csvCell(value: string): string {
  const cell = needsQuote(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(cell)) return `"${cell.replaceAll('"', '""')}"`;
  return cell;
}

function needsQuote(value: string): boolean {
  if (!value || PLAIN_NUMBER.test(value)) return false;
  if (/^[=+\-@\t\r]/.test(value)) return true;
  // A space, tab, or carriage return before = + - @ still opens a formula in Excel.
  // A spaced negative amount such as " -250.00" stays numeric.
  const stripped = value.replace(/^[\t\r ]+/, "");
  if (!stripped || stripped === value || PLAIN_NUMBER.test(stripped)) return false;
  return /^[=+\-@]/.test(stripped);
}
