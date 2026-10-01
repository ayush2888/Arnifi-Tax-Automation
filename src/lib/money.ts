/** Integer minor units. A fractional JSON number is rejected, not rounded. */

export class MoneyTypeError extends Error {
  constructor(field: string) {
    super(field);
    this.name = "MoneyTypeError";
  }
}

export function assertMinor(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new MoneyTypeError("invalid_money");
  }
  return value;
}

/** Convert a display string such as "1,234.50" without using binary floats. */
export function displayToMinor(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$/.test(trimmed) && !/^-?\d+(?:\.\d{1,2})?$/.test(trimmed)) {
    throw new MoneyTypeError("invalid_money");
  }
  const negative = trimmed.startsWith("-");
  const [majorPart, fracPart = ""] = trimmed.replace("-", "").replace(/,/g, "").split(".");
  if (fracPart.length > 2) throw new MoneyTypeError("invalid_money");
  const minor = Number(majorPart) * 100 + Number(fracPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) throw new MoneyTypeError("invalid_money");
  return negative ? -minor : minor;
}

export function formatMinor(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "";
  if (!Number.isInteger(minor)) throw new MoneyTypeError("invalid_money");
  const negative = minor < 0;
  const absolute = Math.abs(minor);
  const major = Math.floor(absolute / 100);
  const frac = String(absolute % 100).padStart(2, "0");
  const grouped = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}.${frac}`;
}
