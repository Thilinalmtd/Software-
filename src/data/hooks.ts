import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';
import { today } from '@/domain/period';
import { accountBalances } from '@/domain/reports';
import type { CompanySettings, EntryStatus, FxRate, PostingDraft, Role, Uuid } from '@/domain/types';
import { useAppData, useRepo } from './context';
import { currentRates, fetchRateToLkr, latestCachedRate } from './fx';
import type { EntryLinks, ListOptions, TableName, TableRows, WritableTable } from './repository';

// TanStack Query hooks over the repository. Query keys are table names, so a mutation
// invalidates exactly the lists it touched.

const LEDGER_KEYS: QueryKey[] = [['ledger'], ['entries'], ['invoice_payments'], ['bill_payments'], ['statement_lines'], ['audit_events']];

export function useTable<T extends TableName>(table: T, opts?: ListOptions, enabled = true) {
  const repo = useRepo();
  return useQuery({
    queryKey: [table, opts ?? null],
    queryFn: () => repo.list(table, opts),
    enabled,
    staleTime: 30_000,
  });
}

export const useDepartments = () => useTable('departments', { order: { column: 'sort_order' } });
export const useAccounts = () => useTable('ledger_accounts', { order: { column: 'code' } });
export const useParties = () => useTable('parties', { order: { column: 'name' } });
export const useProjects = () => useTable('projects', { order: { column: 'code' } });
export const useEntries = () => useTable('entries', { order: { column: 'date', ascending: false } });
export const useMembers = () => useTable('members', { order: { column: 'email' } });
export const useFxRates = () => useTable('fx_rates');

export function useSettings() {
  const repo = useRepo();
  return useQuery({ queryKey: ['settings'], queryFn: () => repo.getSettings(), staleTime: 60_000 });
}

export function usePeriodLock() {
  const repo = useRepo();
  return useQuery({ queryKey: ['period_lock'], queryFn: () => repo.getPeriodLock(), staleTime: 60_000 });
}

export function useLedger() {
  const repo = useRepo();
  return useQuery({ queryKey: ['ledger'], queryFn: () => repo.ledger(), staleTime: 30_000 });
}

/** Master data as lookup maps (the things almost every screen needs). */
export function useLookups() {
  const departments = useDepartments();
  const accounts = useAccounts();
  const parties = useParties();
  const projects = useProjects();
  const settings = useSettings();
  const members = useMembers();
  return useMemo(() => {
    const d = departments.data ?? [];
    const a = accounts.data ?? [];
    const p = parties.data ?? [];
    const pr = projects.data ?? [];
    return {
      loading: departments.isLoading || accounts.isLoading || parties.isLoading || projects.isLoading || settings.isLoading,
      settings: settings.data,
      departments: d,
      accounts: a,
      parties: p,
      projects: pr,
      members: members.data ?? [],
      deptMap: new Map(d.map((x) => [x.id, x])),
      accountMap: new Map(a.map((x) => [x.id, x])),
      partyMap: new Map(p.map((x) => [x.id, x])),
      projectMap: new Map(pr.map((x) => [x.id, x])),
      memberMap: new Map((members.data ?? []).map((m) => [m.user_id, m])),
      sys: (key: string) => a.find((x) => x.system_key === key),
    };
  }, [departments.data, accounts.data, parties.data, projects.data, settings.data, members.data, departments.isLoading, accounts.isLoading, parties.isLoading, projects.isLoading, settings.isLoading]);
}

export function useCurrentRates(): Record<string, string> {
  const fx = useFxRates();
  return useMemo(() => currentRates(fx.data ?? []), [fx.data]);
}

export function useBalances() {
  const ledger = useLedger();
  const { accounts } = useLookups();
  const rates = useCurrentRates();
  return useMemo(() => accountBalances(ledger.data ?? [], accounts, rates), [ledger.data, accounts, rates]);
}

// ---------------------------------------------------------------- mutations

function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: QueryKey[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
}

export function usePostEntry() {
  const repo = useRepo();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ draft, links }: { draft: PostingDraft; links?: EntryLinks }) => repo.postEntry(draft, links),
    onSuccess: () => invalidate(...LEDGER_KEYS),
  });
}

export function useVoidEntry() {
  const repo = useRepo();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, reason }: { id: Uuid; reason: string }) => repo.voidEntry(id, reason),
    onSuccess: () => invalidate(...LEDGER_KEYS),
  });
}

export function useSetEntryStatus() {
  const repo = useRepo();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, status }: { id: Uuid; status: Exclude<EntryStatus, 'void'> }) => repo.setEntryStatus(id, status),
    onSuccess: () => invalidate(...LEDGER_KEYS),
  });
}

export function useSaveRow<T extends WritableTable>(table: T) {
  const repo = useRepo();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string | null; values: Partial<TableRows[T]> }) => (id ? repo.update(table, id, values) : repo.insert(table, values)),
    onSuccess: () => invalidate([table], ['audit_events']),
  });
}

export function useRemoveRow<T extends WritableTable>(table: T) {
  const repo = useRepo();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => repo.remove(table, id),
    onSuccess: () => invalidate([table], ['audit_events']),
  });
}

export function useSaveSettings() {
  const repo = useRepo();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (s: CompanySettings) => repo.saveSettings(s),
    onSuccess: () => invalidate(['settings'], ['audit_events']),
  });
}

export function useSetPeriodLock() {
  const repo = useRepo();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (date: string | null) => repo.setPeriodLock(date),
    onSuccess: () => invalidate(['period_lock'], ['audit_events']),
  });
}

export function useSetMember() {
  const repo = useRepo();
  const invalidate = useInvalidate();
  const { refreshMember } = useAppData();
  return useMutation({
    mutationFn: (a: { userId: Uuid; role: Role | null; departmentId: Uuid | null; active: boolean }) => repo.setMember(a.userId, a.role, a.departmentId, a.active),
    onSuccess: async () => {
      await invalidate(['members'], ['audit_events']);
      await refreshMember();
    },
  });
}

export function useReconcile() {
  const repo = useRepo();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (a: { lineIds: Uuid[]; reconciled: boolean; statementLineId?: Uuid | null; date?: string }) => repo.reconcileLines(a.lineIds, a.reconciled, a.statementLineId, a.date),
    onSuccess: () => invalidate(['ledger'], ['statement_lines']),
  });
}

// ---------------------------------------------------------------- exchange rates

/**
 * Rate to LKR for a currency on a date: cached rate for that date, otherwise fetched
 * (and cached) when the date is recent, otherwise the latest earlier cached rate.
 */
export function useRateToLkr(currency: string | null | undefined, date: string) {
  const repo = useRepo();
  const fx = useFxRates();
  const qc = useQueryClient();
  const { member } = useAppData();
  return useQuery({
    queryKey: ['rate', currency, date, (fx.data ?? []).length],
    enabled: !!currency && !!date && !fx.isLoading,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<FxRate | null> => {
      if (!currency) return null;
      if (currency === 'LKR') return { date, currency, rate: '1', source: 'base' };
      const cached = (fx.data ?? []).find((r) => r.currency === currency && r.date === date);
      if (cached) return cached;
      const age = (Date.parse(today()) - Date.parse(date)) / 86_400_000;
      if (age >= 0 && age <= 3) {
        const fresh = await fetchRateToLkr(currency, today());
        if (fresh) {
          if (member?.role && member.role !== 'viewer') {
            await repo.upsertFxRates([fresh]).catch(() => undefined);
            void qc.invalidateQueries({ queryKey: ['fx_rates'] });
          }
          return fresh;
        }
      }
      return latestCachedRate(fx.data ?? [], currency, date);
    },
  });
}
