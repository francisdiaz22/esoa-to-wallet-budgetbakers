/**
 * Deterministic decimal/minor-unit helper for PHP amounts.
 * Internally money is stored as integer minor units (centavos).
 * API boundary exposes number (minorUnits / 100) but internal sums use integers.
 */

export class DecimalParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecimalParseError';
  }
}

/**
 * Validate and parse a PHP decimal string to minor units (integer centavos).
 * Accepts: "1234.56", "1,234.56", "0.10" etc. Requires exactly two fraction digits.
 * Rejects: accounting/credit notation, more than 2 decimals, missing decimals, empty.
 */
export function parsePhpAmountToMinorUnits(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new DecimalParseError('empty amount');
  // Reject accounting notation like (1,234.56) or credit letters
  if (
    trimmed.includes('(') ||
    trimmed.includes(')') ||
    /[a-zA-Z]/.test(
      trimmed.replace(/,/g, '').replace(/\./g, '').replace(/-/g, ''),
    )
  ) {
    throw new DecimalParseError(`unsupported notation: ${raw}`);
  }
  // Allow optional leading minus for parsing; sign handled by caller for expense conversion.
  // But validate format.
  const sign = trimmed.startsWith('-') ? '-' : '';
  const unsigned = sign ? trimmed.slice(1) : trimmed;
  // Regex: 1-3 digits + groups of ,ddd OR plain digits, then .dd exactly
  const withCommas = /^\d{1,3}(,\d{3})*(\.\d{2})$/;
  const withoutCommas = /^\d+(\.\d{2})$/;
  // Also allow "0.00" etc.
  if (!(withCommas.test(unsigned) || withoutCommas.test(unsigned))) {
    throw new DecimalParseError(`invalid decimal format: ${raw}`);
  }
  // Remove commas
  const normalized = unsigned.replace(/,/g, '');
  const [whole, fraction] = normalized.split('.');
  if (fraction.length !== 2)
    throw new DecimalParseError(`invalid fraction digits: ${raw}`);
  // Validate whole part is digits
  if (!/^\d+$/.test(whole))
    throw new DecimalParseError(`invalid whole part: ${raw}`);
  const wholeUnits = Number(whole);
  const fracUnits = Number(fraction);
  if (!Number.isSafeInteger(wholeUnits) || !Number.isSafeInteger(fracUnits)) {
    throw new DecimalParseError(`amount out of safe integer range: ${raw}`);
  }
  // Compute minor units, check safe integer
  const minor = wholeUnits * 100 + fracUnits;
  if (!Number.isSafeInteger(minor))
    throw new DecimalParseError(`amount overflow: ${raw}`);
  return sign === '-' ? -minor : minor;
}

export function minorUnitsToAmount(minor: number): number {
  if (!Number.isSafeInteger(minor))
    throw new DecimalParseError('minor units not safe integer');
  // Expose as number at boundary — this is the only place floating is produced.
  // Use division; caller must not re-add floats imprecisely.
  return minor / 100;
}

export function formatMinorUnits(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${String(frac).padStart(2, '0')}`;
}

export function sumMinorUnits(minors: number[]): number {
  let sum = 0;
  for (const m of minors) {
    if (!Number.isSafeInteger(m))
      throw new DecimalParseError('minor units not safe integer');
    sum += m;
    if (!Number.isSafeInteger(sum)) throw new DecimalParseError('sum overflow');
  }
  return sum;
}

/** Return negative expense minor units for a statement charge (always negative) */
export function toExpenseMinorUnits(minorAbs: number): number {
  if (minorAbs < 0)
    throw new DecimalParseError('expected absolute minor units');
  // -0 edge: ensure -0 becomes 0? But charges shouldn't be zero. Keep -abs.
  return -Math.abs(minorAbs);
}
