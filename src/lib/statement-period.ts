/** Parse statement windows from bank PDF filenames / free text (ISO out). */

const MONTH =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|" +
  "Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

const MONTH_RANGE = new RegExp(
  `(${MONTH}\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+${MONTH},?\\s+\\d{4})` +
    `\\s*(?:to|-|–|—)\\s*` +
    `(${MONTH}\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+${MONTH},?\\s+\\d{4})`,
  "i",
);

const ISO_RANGE =
  /(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s*(?:to|-|–|—)\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i;

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toIso(token: string): string | null {
  const text = token.trim().replace(/,/g, "");
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(text);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  const named = new RegExp(`^(${MONTH})\\s+(\\d{1,2})\\s+(\\d{4})$`, "i").exec(text);
  if (named) {
    const month = MONTH_INDEX[named[1].toLowerCase()];
    const day = Number(named[2]);
    const year = Number(named[3]);
    if (!month || day < 1 || day > 31) return null;
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  const dayFirst = new RegExp(`^(\\d{1,2})\\s+(${MONTH})\\s+(\\d{4})$`, "i").exec(text);
  if (dayFirst) {
    const day = Number(dayFirst[1]);
    const month = MONTH_INDEX[dayFirst[2].toLowerCase()];
    const year = Number(dayFirst[3]);
    if (!month || day < 1 || day > 31) return null;
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  return null;
}

export function periodRangeFromText(text: string | null | undefined): { start: string; end: string } | null {
  if (!text) return null;
  const month = MONTH_RANGE.exec(text);
  if (month) {
    const start = toIso(month[1]);
    const end = toIso(month[2]);
    if (start && end) return { start, end };
  }
  const numeric = ISO_RANGE.exec(text);
  if (numeric) {
    const start = toIso(numeric[1]);
    const end = toIso(numeric[2]);
    if (start && end) return { start, end };
  }
  return null;
}

export function periodRangeFromFilename(filename: string | null | undefined) {
  if (!filename) return null;
  const stem = filename.replace(/\.[A-Za-z0-9]+$/, "");
  return periodRangeFromText(stem);
}

/** e.g. 2026-08-01 → Aug 2026 */
export function formatStatementPeriod(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "Period not detected yet";
  const s = start?.slice(0, 10) || "";
  const e = end?.slice(0, 10) || "";
  if (s && e && s.slice(0, 7) === e.slice(0, 7)) {
    const [y, m] = s.split("-");
    const label = new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleString("en-GB", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    return `${label} · ${s.slice(8)} → ${e.slice(8)} ${label.split(" ")[0]}`;
  }
  return `${s || "—"} → ${e || "—"}`;
}
