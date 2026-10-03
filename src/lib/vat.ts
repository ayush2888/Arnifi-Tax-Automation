export const VAT_CODES = ["", "SR", "ZR", "EX", "OOS", "RC"] as const;
export type VatCode = (typeof VAT_CODES)[number];

export function vatAmountForBase(baseMinor: number, vatCode: string | null | undefined): number {
  if (!vatCode || vatCode === "ZR" || vatCode === "EX" || vatCode === "OOS") return 0;
  if (vatCode === "SR" || vatCode === "RC") return Math.round((baseMinor * 5) / 100);
  return 0;
}

export function vatCodeLabel(code: string): string {
  switch (code) {
    case "SR":
      return "SR 5%";
    case "ZR":
      return "Zero-rated";
    case "EX":
      return "Exempt";
    case "OOS":
      return "Out of scope";
    case "RC":
      return "Reverse charge";
    default:
      return "None";
  }
}
