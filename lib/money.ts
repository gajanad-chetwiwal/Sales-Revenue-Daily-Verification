/**
 * Money as integer minor units (paise, cents, øre). Never floats.
 *
 * `0.1 + 0.2 !== 0.3` in IEEE-754, and a sales report that is off by a paise
 * per order is worse than no report at all. Every amount coming out of an API
 * is parsed straight from its decimal *string* into a bigint of minor units;
 * arithmetic is exact bigint arithmetic; formatting happens once, at the end.
 */

/** Currencies whose minor unit is not 1/100. */
const EXPONENT_OVERRIDES: Record<string, number> = {
  // zero-decimal
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0,
  RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  // three-decimal
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

/** Number of decimal places for an ISO 4217 code. Defaults to 2. */
export function currencyExponent(currency: string): number {
  return EXPONENT_OVERRIDES[currency.toUpperCase()] ?? 2;
}

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * Parse a decimal string ("12.34") into minor units, exactly.
 *
 * Rounds half-up only when the input carries more precision than the currency
 * supports — which Shopify occasionally does on multi-currency shops.
 */
export function parseDecimalToMinor(amount: string, currency: string): bigint {
  const trimmed = (amount ?? '').trim();
  if (trimmed === '') return 0n;
  if (!DECIMAL_PATTERN.test(trimmed)) {
    throw new TypeError(`Cannot parse "${amount}" as a decimal amount`);
  }

  const exponent = currencyExponent(currency);
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = '0', fraction = ''] = unsigned.split('.');

  const padded = fraction.padEnd(exponent, '0');
  const kept = padded.slice(0, exponent);
  const nextDigit = padded.charCodeAt(exponent) - 48; // NaN-safe: -48 when absent

  let minor = BigInt(whole) * 10n ** BigInt(exponent) + BigInt(kept === '' ? '0' : kept);
  if (nextDigit >= 5) minor += 1n; // round half-up

  return negative ? -minor : minor;
}

/** Square and friends already hand us minor units. */
export function fromMinorUnits(amount: number | bigint | null | undefined): bigint {
  if (amount === null || amount === undefined) return 0n;
  return BigInt(amount);
}

/** Render minor units as a plain decimal string, e.g. `1234n` -> `"12.34"`. */
export function formatMinor(minor: bigint, currency: string): string {
  const exponent = currencyExponent(currency);
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent === 0 ? '' : `.${digits.slice(digits.length - exponent)}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** Thousands-separated for terminal display, e.g. `"1,234.56"`. */
export function formatMinorGrouped(minor: bigint, currency: string): string {
  const plain = formatMinor(minor, currency);
  const negative = plain.startsWith('-');
  const unsigned = negative ? plain.slice(1) : plain;
  const [whole = '0', fraction] = unsigned.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}

export function sumMinor(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const value of values) total += value;
  return total;
}

/** Divide exactly, rounding halves away from zero (matches spreadsheet ROUND). */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('Division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d;
  const remainder = n % d;
  const rounded = remainder * 2n >= d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * Multiply minor units by a decimal string ("0.30", "95.45050000") exactly.
 *
 * Spreadsheets compute on unrounded values and round only for display, so this
 * keeps full precision through the multiply and rounds once at the end — which
 * is what makes the results tie out to the cent.
 */
export function mulMinorByDecimal(minor: bigint, decimal: string): bigint {
  const trimmed = decimal.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new TypeError(`Cannot parse "${decimal}" as a decimal factor`);
  }
  const negative = trimmed.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? trimmed.slice(1) : trimmed).split('.');
  const scaled = BigInt(whole + fraction);
  const divisor = 10n ** BigInt(fraction.length);
  const result = divRoundHalfUp(minor * scaled, divisor);
  return negative ? -result : result;
}

/** Percentage of an amount, e.g. `percentOf(843600n, '30')` -> 253080n. */
export function percentOf(minor: bigint, percent: string): bigint {
  return mulMinorByDecimal(minor, (Number(percent) / 100).toFixed(10));
}

/**
 * Multiply minor units by several decimal factors, rounding **once** at the end.
 *
 * Rounding between factors visibly drifts on small numbers: 0.4% of $8,436 is
 * $33.744, and a spreadsheet converts that unrounded figure to INR. Rounding to
 * $33.74 first loses ₹0.38 on that row alone.
 */
export function mulMinorByDecimals(minor: bigint, factors: string[]): bigint {
  let numerator = minor;
  let denominator = 1n;
  let negative = false;

  for (const factor of factors) {
    const trimmed = factor.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw new TypeError(`Cannot parse "${factor}" as a decimal factor`);
    }
    if (trimmed.startsWith('-')) negative = !negative;
    const [whole = '0', fraction = ''] = (
      trimmed.startsWith('-') ? trimmed.slice(1) : trimmed
    ).split('.');
    numerator *= BigInt(whole + fraction);
    denominator *= 10n ** BigInt(fraction.length);
  }

  const result = divRoundHalfUp(numerator, denominator);
  return negative ? -result : result;
}
