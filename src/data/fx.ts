import { isValidRate, normaliseRate } from '@/domain/money';
import type { FxRate } from '@/domain/types';

// Daily exchange rates to LKR. The Central Bank of Sri Lanka (CBSL) indicative rate is tried
// first; a general market rate is the fallback. Every rate fetched is cached in the database
// (fx_rates) so both directors use the same rate and the app works offline afterwards.
// Users can always type the actual bank rate instead.

interface Provider {
  name: string;
  url: (currency: string) => string;
  parse: (json: unknown) => number | null;
}

function findNumber(obj: unknown, keys: string[]): number | null {
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'number' && v > 0) return v;
    if (typeof v === 'string' && isValidRate(v)) return Number(v);
  }
  return null;
}

const PROVIDERS: Provider[] = [
  {
    name: 'CBSL',
    url: (c) => `https://api.frankfurter.dev/v2/rate/${c}/LKR?providers=CBSL`,
    parse: (json) => {
      if (Array.isArray(json)) return findNumber(json[0], ['rate']);
      const direct = findNumber(json, ['rate']);
      if (direct) return direct;
      const rates = (json as { rates?: unknown })?.rates;
      return findNumber(rates, ['LKR']);
    },
  },
  {
    name: 'Market (open.er-api.com)',
    url: (c) => `https://open.er-api.com/v6/latest/${c}`,
    parse: (json) => findNumber((json as { rates?: unknown })?.rates, ['LKR']),
  },
];

async function getJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Today's rate (LKR per 1 unit of `currency`), or null when offline / unavailable. */
export async function fetchRateToLkr(currency: string, date: string): Promise<FxRate | null> {
  if (currency === 'LKR') return { date, currency, rate: '1', source: 'base' };
  for (const p of PROVIDERS) {
    try {
      const value = p.parse(await getJson(p.url(currency)));
      // Sanity check: LKR rates for the currencies AptoCAD uses are between 1 and 2,000.
      if (value && value > 0.5 && value < 5000) return { date, currency, rate: normaliseRate(value), source: p.name };
    } catch {
      /* try the next provider */
    }
  }
  return null;
}

/** Most recent cached rate on or before `date`. */
export function latestCachedRate(rates: FxRate[], currency: string, date: string): FxRate | null {
  let best: FxRate | null = null;
  for (const r of rates) {
    if (r.currency !== currency || r.date > date) continue;
    if (!best || r.date > best.date) best = r;
  }
  return best;
}

/** Latest known rate for each currency (for valuing balances today). */
export function currentRates(rates: FxRate[]): Record<string, string> {
  const latest: Record<string, FxRate> = {};
  for (const r of rates) if (!latest[r.currency] || r.date > latest[r.currency].date) latest[r.currency] = r;
  return Object.fromEntries(Object.entries(latest).map(([c, r]) => [c, r.rate]));
}
