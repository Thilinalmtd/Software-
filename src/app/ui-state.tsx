import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PERIOD_PRESET_LABELS, presetRange, formatDate, type DateRange, type PeriodPreset } from '@/domain/period';
import type { Uuid } from '@/domain/types';
import { useSettings } from '@/data/hooks';

// App-wide view state: department filter, reporting period, theme and the Quick Add dialog.

export type ThemeChoice = 'light' | 'dark' | 'system';
export type QuickAddTab = 'income' | 'expense' | 'transfer';

export interface QuickAddRequest {
  tab: QuickAddTab;
  /** Edit an existing entry instead of creating one. */
  entryId?: Uuid;
  /** Pre-filled values (e.g. from a statement line, invoice or bill). */
  prefill?: Record<string, unknown>;
  onSaved?: (entryId: Uuid) => void;
}

interface UiState {
  dept: Uuid | 'all';
  setDept: (d: Uuid | 'all') => void;
  preset: PeriodPreset | 'custom';
  customRange: DateRange;
  setPreset: (p: PeriodPreset | 'custom') => void;
  setCustomRange: (r: DateRange) => void;
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
  quickAdd: QuickAddRequest | null;
  openQuickAdd: (req?: Partial<QuickAddRequest>) => void;
  closeQuickAdd: () => void;
}

const Ctx = createContext<UiState | null>(null);

function stored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function applyTheme(theme: ThemeChoice) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function UiStateProvider({ children }: { children: ReactNode }) {
  const [dept, setDeptState] = useState<Uuid | 'all'>(() => stored('ui.dept', 'all'));
  const [preset, setPresetState] = useState<PeriodPreset | 'custom'>(() => stored('ui.preset', 'fy_to_date'));
  const [customRange, setCustomRangeState] = useState<DateRange>(() => stored('ui.range', { from: new Date().toISOString().slice(0, 8) + '01', to: new Date().toISOString().slice(0, 10) }));
  const [theme, setThemeState] = useState<ThemeChoice>(() => stored('ui.theme', 'system'));
  const [quickAdd, setQuickAdd] = useState<QuickAddRequest | null>(null);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const openQuickAdd = useCallback((req: Partial<QuickAddRequest> = {}) => {
    setQuickAdd({ tab: req.tab ?? (stored('ui.lastTab', 'expense') as QuickAddTab), ...req });
  }, []);

  const value = useMemo<UiState>(
    () => ({
      dept,
      setDept: (d) => {
        setDeptState(d);
        store('ui.dept', d);
      },
      preset,
      customRange,
      setPreset: (p) => {
        setPresetState(p);
        store('ui.preset', p);
      },
      setCustomRange: (r) => {
        setCustomRangeState(r);
        store('ui.range', r);
      },
      theme,
      setTheme: (t) => {
        setThemeState(t);
        store('ui.theme', t);
      },
      quickAdd,
      openQuickAdd,
      closeQuickAdd: () => setQuickAdd(null),
    }),
    [dept, preset, customRange, theme, quickAdd, openQuickAdd],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUi(): UiState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useUi must be used inside UiStateProvider');
  return ctx;
}

export function rememberTab(tab: QuickAddTab) {
  store('ui.lastTab', tab);
}

export function remember<T>(key: string, value: T) {
  store(`remember.${key}`, value);
}

export function recall<T>(key: string, fallback: T): T {
  return stored(`remember.${key}`, fallback);
}

/** The reporting period currently selected in the top bar. */
export function usePeriod(): { range: DateRange; label: string; preset: PeriodPreset | 'custom'; fyStartMonth: number } {
  const { preset, customRange } = useUi();
  const settings = useSettings();
  const fyStartMonth = settings.data?.fy_start_month ?? 4;
  return useMemo(() => {
    if (preset === 'custom') return { range: customRange, label: `${formatDate(customRange.from)} – ${formatDate(customRange.to)}`, preset, fyStartMonth };
    return { range: presetRange(preset, fyStartMonth), label: PERIOD_PRESET_LABELS[preset], preset, fyStartMonth };
  }, [preset, customRange, fyStartMonth]);
}
