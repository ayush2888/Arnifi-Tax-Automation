import type { Vat201Box, Vat201Payload } from "@/server/release";

/** Owner-supplied or lab golden for V1 VAT201 back-test (roadmap §3.4). */
export type Vat201Golden = {
  id: string;
  /** `lab` = synthetic fixture for CI; `filed` = owner-supplied FTA export (on-machine only). */
  source: "lab" | "filed";
  clientId?: string;
  periodId?: string;
  periodLabel?: string;
  /** Absolute tolerance per compared minor-unit field (default 0). */
  toleranceMinor?: number;
  boxes: Record<string, Vat201Box>;
  totalOutputVat: number;
  totalInputVat: number;
  netPayable: number;
  notes?: string;
};

export type Vat201Mismatch = {
  path: string;
  expected: number;
  actual: number;
  delta: number;
  toleranceMinor: number;
};

export type Vat201CompareResult = {
  ok: boolean;
  goldenId: string;
  mismatches: Vat201Mismatch[];
};

function within(expected: number, actual: number, tolerance: number) {
  return Math.abs(expected - actual) <= tolerance;
}

function pushIfOff(
  mismatches: Vat201Mismatch[],
  path: string,
  expected: number,
  actual: number,
  toleranceMinor: number,
) {
  if (within(expected, actual, toleranceMinor)) return;
  mismatches.push({
    path,
    expected,
    actual,
    delta: actual - expected,
    toleranceMinor,
  });
}

/** Compare a computed VAT201 payload (or box slice) against a golden return. */
export function compareVat201(
  golden: Vat201Golden,
  actual: Pick<Vat201Payload, "boxes" | "totalOutputVat" | "totalInputVat" | "netPayable">,
): Vat201CompareResult {
  const toleranceMinor = golden.toleranceMinor ?? 0;
  const mismatches: Vat201Mismatch[] = [];
  const boxIds = new Set([...Object.keys(golden.boxes), ...Object.keys(actual.boxes)]);

  for (const box of [...boxIds].sort()) {
    const g = golden.boxes[box] || { taxableMinor: 0, vatMinor: 0 };
    const a = actual.boxes[box] || { taxableMinor: 0, vatMinor: 0 };
    pushIfOff(mismatches, `boxes.${box}.taxableMinor`, g.taxableMinor, a.taxableMinor, toleranceMinor);
    pushIfOff(mismatches, `boxes.${box}.vatMinor`, g.vatMinor, a.vatMinor, toleranceMinor);
  }

  pushIfOff(mismatches, "totalOutputVat", golden.totalOutputVat, actual.totalOutputVat, toleranceMinor);
  pushIfOff(mismatches, "totalInputVat", golden.totalInputVat, actual.totalInputVat, toleranceMinor);
  pushIfOff(mismatches, "netPayable", golden.netPayable, actual.netPayable, toleranceMinor);

  return { ok: mismatches.length === 0, goldenId: golden.id, mismatches };
}

export function formatCompareReport(result: Vat201CompareResult) {
  if (result.ok) return `PASS ${result.goldenId}: all VAT201 fields within tolerance`;
  const lines = result.mismatches.map(
    (m) =>
      `  ${m.path}: expected ${m.expected} actual ${m.actual} delta ${m.delta} (tol ${m.toleranceMinor})`,
  );
  return [`FAIL ${result.goldenId}: ${result.mismatches.length} mismatch(es)`, ...lines].join("\n");
}
