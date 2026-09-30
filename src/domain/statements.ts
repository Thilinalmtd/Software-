import { toMinor } from './money';
import { daysBetween, isIsoDate, makeIso } from './period';
import type { CategorisationRule, IsoDate, LedgerRow, StatementLine, Uuid } from './types';

// Bank / Payoneer / Upwork statement import: column mapping, parsing, de-duplication,
// matching to posted entries, and categorisation rules.

export type DateFormat = 'auto' | 'yyyy-mm-dd' | 'dd/mm/yyyy' | 'mm/dd/yyyy';

export interface ColumnMapping {
  date: string;
  description: string;
  reference?: string | null;
  /** Single signed amount column … */
  amount?: string | null;
  /** … or separate money-in / money-out columns. */
  credit?: string | null;
  debit?: string | null;
  balance?: string | null;
  dateFormat: DateFormat;
  /** Some exports show money out as positive numbers. */
  invertSign?: boolean;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

export function parseStatementDate(raw: string, format: DateFormat = 'auto'): IsoDate | null {
  const s = raw.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    const iso = makeIso(+m[1], +m[2], +m[3]);
    return isIsoDate(iso) && +m[2] <= 12 ? iso : null;
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const a = +m[1], b = +m[2];
    let y = +m[3];
    if (y < 100) y += 2000;
    let day: number, month: number;
    if (format === 'mm/dd/yyyy') [month, day] = [a, b];
    else if (format === 'dd/mm/yyyy') [day, month] = [a, b];
    else if (a > 12) [day, month] = [a, b];
    else if (b > 12) [month, day] = [a, b];
    else [day, month] = [a, b]; // Sri Lankan banks use day-first
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return makeIso(y, month, day);
  }
  // "30 Sep 2026", "30-Sep-26", "Sep 30, 2026"
  const monthOf = (name: string): number | undefined => MONTHS[name.toLowerCase()] ?? MONTHS[name.toLowerCase().slice(0, 3)];
  const fullYear = (y: string) => (y.length === 2 ? 2000 + +y : +y);
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,-]+(\d{2,4})\b/);
  if (m && monthOf(m[2])) return makeIso(fullYear(m[3]), monthOf(m[2])!, +m[1]);
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && monthOf(m[1])) return makeIso(+m[3], monthOf(m[1])!, +m[2]);
  return null;
}

/** "(1,234.50)", "-1,234.50", "1,234.50 DR", "$1,234.50", "LKR 1,234.50" → signed minor units. */
export function parseStatementAmount(raw: string | number | null | undefined, currency: string): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return toMinor(raw, currency);
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\b(dr|debit)\b\.?$/i.test(s)) {
    negative = true;
    s = s.replace(/\b(dr|debit)\b\.?$/i, '');
  }
  s = s.replace(/\b(cr|credit)\b\.?$/i, '');
  s = s.replace(/[A-Za-z$€£₹\s]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  const v = toMinor(s, currency);
  if (v === null) return null;
  return negative ? -v : v;
}

export interface ParsedStatementRow {
  date: IsoDate;
  description: string;
  reference: string | null;
  amount_minor: number;
  balance_minor: number | null;
  hash: string;
}

export interface ParseResult {
  rows: ParsedStatementRow[];
  errors: { row: number; message: string }[];
}

export function statementHash(accountId: Uuid, date: IsoDate, amount: number, description: string, reference: string | null, occurrence: number): string {
  const norm = description.toLowerCase().replace(/\s+/g, ' ').trim();
  return `${accountId}|${date}|${amount}|${norm}|${reference ?? ''}|${occurrence}`;
}

export function parseStatementRows(records: Record<string, string>[], mapping: ColumnMapping, currency: string, accountId: Uuid): ParseResult {
  const rows: ParsedStatementRow[] = [];
  const errors: { row: number; message: string }[] = [];
  const seen = new Map<string, number>();
  records.forEach((rec, index) => {
    const rowNo = index + 2; // header is row 1
    const rawDate = rec[mapping.date] ?? '';
    if (!rawDate.trim() && Object.values(rec).every((v) => !String(v ?? '').trim())) return;
    const date = parseStatementDate(rawDate, mapping.dateFormat);
    if (!date) {
      errors.push({ row: rowNo, message: `Unrecognised date "${rawDate}"` });
      return;
    }
    let amount: number | null = null;
    if (mapping.amount) amount = parseStatementAmount(rec[mapping.amount], currency);
    else {
      const credit = mapping.credit ? parseStatementAmount(rec[mapping.credit], currency) : null;
      const debit = mapping.debit ? parseStatementAmount(rec[mapping.debit], currency) : null;
      if (credit !== null || debit !== null) amount = Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (amount === null || amount === 0) {
      errors.push({ row: rowNo, message: 'No amount' });
      return;
    }
    if (mapping.invertSign) amount = -amount;
    const description = (rec[mapping.description] ?? '').trim() || '(no description)';
    const reference = mapping.reference ? (rec[mapping.reference] ?? '').trim() || null : null;
    const balance = mapping.balance ? parseStatementAmount(rec[mapping.balance], currency) : null;
    const baseKey = `${date}|${amount}|${description}|${reference}`;
    const occurrence = (seen.get(baseKey) ?? 0) + 1;
    seen.set(baseKey, occurrence);
    rows.push({ date, description, reference, amount_minor: amount, balance_minor: balance, hash: statementHash(accountId, date, amount, description, reference, occurrence) });
  });
  return { rows, errors };
}

/** Guess a mapping from common header names (bank, Payoneer, Upwork exports). */
export function guessMapping(headers: string[]): ColumnMapping {
  const find = (...patterns: RegExp[]) => headers.find((h) => patterns.some((p) => p.test(h))) ?? null;
  const date = find(/^date$/i, /transaction date/i, /posting date/i, /value date/i, /date/i) ?? headers[0] ?? '';
  const description = find(/description/i, /narration/i, /details/i, /particulars/i, /memo/i, /summary/i) ?? headers[1] ?? '';
  const amount = find(/^amount$/i, /^amount \(/i, /net amount/i, /^amount/i);
  const credit = find(/credit/i, /deposit/i, /money in/i, /paid in/i);
  const debit = find(/debit/i, /withdrawal/i, /money out/i, /paid out/i);
  return {
    date,
    description,
    reference: find(/reference/i, /ref\b/i, /transaction id/i, /cheque/i),
    amount: credit && debit ? null : amount,
    credit: credit && debit ? credit : null,
    debit: credit && debit ? debit : null,
    balance: find(/balance/i),
    dateFormat: 'auto',
    invertSign: false,
  };
}

// ---------------------------------------------------------------------------
// Matching statement lines to posted money lines
// ---------------------------------------------------------------------------

export interface MatchCandidate {
  row: LedgerRow;
  score: number;
  dayGap: number;
}

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
}

export function textSimilarity(a: string, b: string): number {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.min(ta.size, tb.size);
}

/** Candidate money lines for a statement line: same account and amount, within ±7 days, not yet reconciled. */
export function findMatches(line: Pick<StatementLine, 'account_id' | 'amount_minor' | 'date' | 'description'>, rows: LedgerRow[], windowDays = 7): MatchCandidate[] {
  return rows
    .filter((r) => r.account_id === line.account_id && r.status !== 'void' && !r.reconciled && r.amount_minor === line.amount_minor)
    .map((r) => {
      const dayGap = Math.abs(daysBetween(r.date, line.date));
      const score = 1 - dayGap / (windowDays + 1) + 0.5 * textSimilarity(r.entry_description, line.description);
      return { row: r, score, dayGap };
    })
    .filter((c) => c.dayGap <= windowDays)
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Categorisation rules ("description contains Autodesk → Software & Subscriptions")
// ---------------------------------------------------------------------------

export function applyRules(text: string, direction: 'income' | 'expense', rules: CategorisationRule[]): CategorisationRule | null {
  const hay = text.toLowerCase();
  const sorted = [...rules].filter((r) => r.active).sort((a, b) => a.priority - b.priority);
  for (const r of sorted) {
    if (r.applies_to !== 'any' && r.applies_to !== direction) continue;
    const needle = r.match_text.trim().toLowerCase();
    if (needle && hay.includes(needle)) return r;
  }
  return null;
}
