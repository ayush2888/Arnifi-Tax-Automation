/** Map COA statement_line codes to human labels for Settings. */
const LABELS: Record<string, string> = {
  BS_current_assets: "Current assets",
  BS_nca: "Non-current assets",
  BS_current_liab: "Current liabilities",
  BS_ncl: "Non-current liabilities",
  BS_liab: "Liabilities",
  BS_equity: "Equity",
  PL_revenue: "Revenue",
  PL_cogs: "Cost of sales",
  PL_opex: "Operating expenses",
  PL_other: "Other income / expense",
  PL_tax: "Tax",
};

export function statementLineLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return LABELS[code] || code.replace(/_/g, " ");
}
