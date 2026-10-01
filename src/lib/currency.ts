/** Phase 1 stores hundredths only. These ISO codes use thousandths. */
export const THREE_DECIMAL_CURRENCIES = ["KWD", "BHD", "OMR"] as const;

const CURRENCY_HEADER = /currency\s*[:|,]\s*([A-Za-z]{3})/i;

export function declaredCurrency(content: Buffer): string | null {
  const match = content.toString("utf8").match(CURRENCY_HEADER);
  return match ? match[1].toUpperCase() : null;
}

export function unsupportedCurrencyMessage(code: string): string {
  return `${code} is quoted to 3 decimal places. Phase 1 accepts only currencies quoted to 2 decimal places, such as AED.`;
}

export function unsupportedCurrency(content: Buffer): { error: "unsupported_currency"; message: string } | null {
  const code = declaredCurrency(content);
  if (!code || !THREE_DECIMAL_CURRENCIES.includes(code as (typeof THREE_DECIMAL_CURRENCIES)[number])) {
    return null;
  }
  return { error: "unsupported_currency", message: unsupportedCurrencyMessage(code) };
}
