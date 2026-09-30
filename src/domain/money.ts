import Decimal from 'decimal.js';
import { BASE_CURRENCY } from './types';

// All money is stored as integer minor units (cents) to avoid floating-point errors.
// FX rates are decimal strings and multiplied with decimal.js, rounding half-up once.

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const DECIMALS: Record<string, number> = { JPY: 0, KWD: 3, BHD: 3, OMR: 3 };

export function currencyDecimals(currency: string): number {
  return DECIMALS[currency] ?? 2;
}

export function isBase(currency: string): boolean {
  return currency === BASE_CURRENCY;
}

/** "1,250.50" / 1250.5 → 125050 (for a 2-decimal currency). Returns null for invalid input. */
export function toMinor(value: string | number, currency: string = BASE_CURRENCY): number | null {
  const text = typeof value === 'number' ? String(value) : value.replace(/[,\s]/g, '').trim();
  if (text === '' || !/^[-+]?\d*\.?\d*$/.test(text) || text === '.' || text === '-' || text === '+') return null;
  const d = new Decimal(text).mul(new Decimal(10).pow(currencyDecimals(currency)));
  return d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** 125050 → 1250.5 */
export function fromMinor(minor: number, currency: string = BASE_CURRENCY): number {
  return new Decimal(minor).div(new Decimal(10).pow(currencyDecimals(currency))).toNumber();
}

/** Plain editable string: 125050 → "1250.50" */
export function minorToInput(minor: number | null | undefined, currency: string = BASE_CURRENCY): string {
  if (minor === null || minor === undefined) return '';
  return new Decimal(minor).div(new Decimal(10).pow(currencyDecimals(currency))).toFixed(currencyDecimals(currency));
}

/** Convert an amount in `currency` minor units to LKR cents at `rate` (LKR per 1 unit). */
export function toLkrMinor(amountMinor: number, currency: string, rate: string | number): number {
  if (isBase(currency)) return amountMinor;
  const factor = new Decimal(10).pow(2 - currencyDecimals(currency));
  return new Decimal(amountMinor).mul(new Decimal(rate)).mul(factor).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** Converts LKR cents back to a foreign amount (used for display of LKR-equivalents). */
export function fromLkrMinor(lkrMinor: number, currency: string, rate: string | number): number {
  if (isBase(currency)) return lkrMinor;
  const factor = new Decimal(10).pow(currencyDecimals(currency) - 2);
  return new Decimal(lkrMinor).div(new Decimal(rate)).mul(factor).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** Average carrying rate of a foreign balance: LKR book value ÷ currency balance. */
export function carryingRate(balanceMinor: number, bookLkrMinor: number, currency: string): string | null {
  if (isBase(currency)) return '1';
  if (balanceMinor === 0) return null;
  const factor = new Decimal(10).pow(currencyDecimals(currency) - 2);
  return new Decimal(bookLkrMinor).div(balanceMinor).mul(factor).toDecimalPlaces(8).toString();
}

export function isValidRate(rate: string | number | null | undefined): boolean {
  if (rate === null || rate === undefined || rate === '') return false;
  try {
    const d = new Decimal(rate);
    return d.isFinite() && d.gt(0);
  } catch {
    return false;
  }
}

export function normaliseRate(rate: string | number): string {
  return new Decimal(rate).toDecimalPlaces(8).toString();
}

const formatters = new Map<string, Intl.NumberFormat>();
function numberFormat(decimals: number, compact: boolean): Intl.NumberFormat {
  const key = `${decimals}|${compact}`;
  let f = formatters.get(key);
  if (!f) {
    f = compact
      ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
      : new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    formatters.set(key, f);
  }
  return f;
}

export interface FormatOptions {
  /** Hide the currency code. */
  plain?: boolean;
  /** 12.4M style. */
  compact?: boolean;
  /** Show negatives as (1,234.00) like the Excel workbook. */
  brackets?: boolean;
  /** Always show a sign (+/−). */
  signed?: boolean;
  /** Drop decimals (whole units). */
  whole?: boolean;
}

export function formatMoney(minor: number, currency: string = BASE_CURRENCY, opts: FormatOptions = {}): string {
  const decimals = opts.whole ? 0 : currencyDecimals(currency);
  const value = fromMinor(Math.abs(minor), currency);
  const body = numberFormat(decimals, !!opts.compact).format(value);
  const withCode = opts.plain ? body : `${currency} ${body}`;
  if (minor < 0) return opts.brackets ? `(${withCode})` : `−${withCode}`;
  if (opts.signed && minor > 0) return `+${withCode}`;
  return withCode;
}

export function formatRate(rate: string | number): string {
  const d = new Decimal(rate);
  return d.toDecimalPlaces(d.gte(10) ? 2 : 4).toString();
}

export function formatPct(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

/** Percentage of an amount, rounded half-up to minor units. */
export function pctOf(minor: number, pct: number): number {
  return new Decimal(minor).mul(pct).div(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function sum(values: number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
