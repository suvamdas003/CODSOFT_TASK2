/**
 * Money helpers. All amounts are integer minor units (e.g. paise, cents).
 * The number of minor digits comes from the ISO 4217 currency via Intl, so
 * zero-decimal currencies such as JPY work without special cases.
 */
const digitsCache = new Map<string, number>();

export function currencyDigits(currency: string): number {
  const code = currency.toUpperCase();
  const cached = digitsCache.get(code);
  if (cached !== undefined) return cached;
  const digits = new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  digitsCache.set(code, digits);
  return digits;
}

export function isValidCurrency(currency: string): boolean {
  if (!/^[A-Za-z]{3}$/.test(currency)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency });
    return true;
  } catch {
    return false;
  }
}

export function formatMoney(minor: number, currency: string, locale = "en-IN"): string {
  const digits = currencyDigits(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(minor / 10 ** digits);
}

/** Converts minor units to a plain decimal string for form inputs ("12.50"). */
export function minorToMajorString(minor: number, currency: string): string {
  const digits = currencyDigits(currency);
  if (digits === 0) return String(minor);
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const major = Math.floor(abs / 10 ** digits);
  const fraction = String(abs % 10 ** digits).padStart(digits, "0");
  return `${sign}${major}.${fraction}`;
}

/**
 * Parses a decimal string ("12", "12.5", "12.50") into minor units without
 * floating point arithmetic. Returns null for invalid input or too many decimals.
 */
export function parseMajorToMinor(input: string, currency: string, { allowNegative = false } = {}): number | null {
  const digits = currencyDigits(currency);
  const trimmed = input.trim();
  const pattern = allowNegative ? /^(-)?(\d{1,9})(?:\.(\d+))?$/ : /^()(\d{1,9})(?:\.(\d+))?$/;
  const match = pattern.exec(trimmed);
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  if (fraction.length > digits) return null;
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return sign ? -minor : minor;
}
