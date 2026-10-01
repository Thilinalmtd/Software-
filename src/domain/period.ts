import type { IsoDate } from './types';

// Date helpers work on ISO strings (yyyy-mm-dd) to avoid timezone surprises.

export function isoDate(d: Date): IsoDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today(): IsoDate {
  return isoDate(new Date());
}

export function parseIso(date: IsoDate): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { y, m, d } = parseIso(value);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function makeIso(y: number, m: number, d: number): IsoDate {
  // Normalise month overflow (m may be 0 or 13 etc.)
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthStart(date: IsoDate): IsoDate {
  const { y, m } = parseIso(date);
  return makeIso(y, m, 1);
}

export function monthEnd(date: IsoDate): IsoDate {
  const { y, m } = parseIso(date);
  return makeIso(y, m, daysInMonth(y, m));
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const { y, m, d } = parseIso(date);
  return makeIso(y, m, d + days);
}

/** Adds months, clamping the day to the target month's length (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const { y, m, d } = parseIso(date);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth() + 1;
  return makeIso(ty, tm, Math.min(d, daysInMonth(ty, tm)));
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = parseIso(from);
  const b = parseIso(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

export function monthKey(date: IsoDate): string {
  return date.slice(0, 7);
}

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

export function inRange(date: IsoDate, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

/** Financial year containing `date`. With startMonth = 4, 2026-10-02 → FY 2026/27 (2026-04-01 … 2027-03-31). */
export function fiscalYear(date: IsoDate, startMonth: number): { startYear: number; range: DateRange; label: string } {
  const { y, m } = parseIso(date);
  const startYear = startMonth === 1 ? y : m >= startMonth ? y : y - 1;
  return fiscalYearFromStart(startYear, startMonth);
}

export function fiscalYearFromStart(startYear: number, startMonth: number): { startYear: number; range: DateRange; label: string } {
  const from = makeIso(startYear, startMonth, 1);
  const to = addDays(addMonths(from, 12), -1);
  const label = startMonth === 1 ? `${startYear}` : `FY ${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
  return { startYear, range: { from, to }, label };
}

/** The 12 month-start dates of a financial year. */
export function fiscalMonths(startYear: number, startMonth: number): IsoDate[] {
  const first = makeIso(startYear, startMonth, 1);
  return Array.from({ length: 12 }, (_, i) => addMonths(first, i));
}

/** Calendar quarter containing the date (Jan–Mar, Apr–Jun, …), used for SSCL/VAT thresholds. */
export function calendarQuarter(date: IsoDate): DateRange {
  const { y, m } = parseIso(date);
  const qStart = Math.floor((m - 1) / 3) * 3 + 1;
  const from = makeIso(y, qStart, 1);
  return { from, to: monthEnd(makeIso(y, qStart + 2, 1)) };
}

export type PeriodPreset =
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'this_fy'
  | 'last_fy'
  | 'fy_to_date'
  | 'this_year'
  | 'last_12_months'
  | 'all';

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  fy_to_date: 'Financial year to date',
  this_fy: 'This financial year',
  last_fy: 'Last financial year',
  this_year: 'This calendar year',
  last_12_months: 'Last 12 months',
  all: 'All time',
};

export function presetRange(preset: PeriodPreset, fyStartMonth: number, ref: IsoDate = today()): DateRange {
  switch (preset) {
    case 'this_month':
      return { from: monthStart(ref), to: monthEnd(ref) };
    case 'last_month': {
      const prev = addMonths(monthStart(ref), -1);
      return { from: prev, to: monthEnd(prev) };
    }
    case 'this_quarter':
      return calendarQuarter(ref);
    case 'this_fy':
      return fiscalYear(ref, fyStartMonth).range;
    case 'fy_to_date':
      return { from: fiscalYear(ref, fyStartMonth).range.from, to: ref };
    case 'last_fy': {
      const fy = fiscalYear(ref, fyStartMonth);
      return fiscalYearFromStart(fy.startYear - 1, fyStartMonth).range;
    }
    case 'this_year': {
      const { y } = parseIso(ref);
      return { from: makeIso(y, 1, 1), to: makeIso(y, 12, 31) };
    }
    case 'last_12_months':
      return { from: addDays(addMonths(ref, -12), 1), to: ref };
    case 'all':
      return { from: '1900-01-01', to: '2999-12-31' };
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthLabel(date: IsoDate, withYear = true): string {
  const { y, m } = parseIso(date);
  return withYear ? `${MONTHS[m - 1]} ${y}` : MONTHS[m - 1];
}

export function formatDate(date: IsoDate | null | undefined): string {
  if (!date) return '—';
  const { y, m, d } = parseIso(date.slice(0, 10));
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}
