import { useQueryClient } from '@tanstack/react-query';
import { ArrowRightToLine, Save, Target } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SegmentedControl } from '@/components/ui/form';
import { Callout, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { formatMoney, formatPct } from '@/domain/money';
import { fiscalMonths, fiscalYear, fiscalYearFromStart, monthLabel, monthStart, today } from '@/domain/period';
import { budgetVsActual, GROUP_LABELS } from '@/domain/reports';
import type { CategoryGroup, LedgerAccount } from '@/domain/types';
import { useAppData, useRepo } from '@/data/context';
import { useTable } from '@/data/hooks';
import { canWriteDepartment } from '@/data/permissions';
import { cn, errorMessage } from '@/lib/cn';
import { useUi } from '@/app/ui-state';
import { useReportData } from '../shared/useFinance';

const GROUPS: CategoryGroup[] = ['revenue', 'other_income', 'direct_cost', 'payroll', 'operating'];

export default function BudgetsPage() {
  const { L, rows, ctx, loading } = useReportData();
  const repo = useRepo();
  const qc = useQueryClient();
  const { member } = useAppData();
  const { dept } = useUi();
  const budgets = useTable('budgets');
  const fyStart = L.settings?.fy_start_month ?? 4;
  const currentFy = fiscalYear(today(), fyStart).startYear;
  const [fy, setFy] = useState(currentFy);
  const [deptId, setDeptId] = useState<string>(dept !== 'all' ? dept : member?.department_id ?? L.departments[0]?.id ?? '');
  const [view, setView] = useState<'plan' | 'actual'>('actual');
  const months = useMemo(() => fiscalMonths(fy, fyStart), [fy, fyStart]);
  const [grid, setGrid] = useState<Record<string, Record<string, string>>>({});
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (dept !== 'all') setDeptId(dept);
  }, [dept]);
  useEffect(() => {
    const g: Record<string, Record<string, string>> = {};
    for (const b of budgets.data ?? []) {
      if (b.department_id !== deptId || !months.includes(b.month)) continue;
      (g[b.account_id] ??= {})[b.month] = String(b.amount_lkr_minor / 100);
    }
    setGrid(g);
    setDirty(false);
  }, [budgets.data, deptId, months]);
  // Compare like with like: budget to date vs actual to date (months up to the current one).
  const monthsToDate = useMemo(() => months.filter((m) => m <= monthStart(today())), [months]);
  const vsActual = useMemo(() => budgetVsActual(rows, budgets.data ?? [], ctx, monthsToDate.length ? monthsToDate : months, deptId), [rows, budgets.data, ctx, months, monthsToDate, deptId]);
  const fullYear = useMemo(() => new Map(budgetVsActual(rows, budgets.data ?? [], ctx, months, deptId).map((l) => [l.account.id, l.budget])), [rows, budgets.data, ctx, months, deptId]);
  if (loading || budgets.isLoading) return <Spinner />;
  const department = L.deptMap.get(deptId);
  const canEdit = canWriteDepartment(member, deptId, L.departments) && member?.role !== 'viewer';
  const categories = L.accounts.filter((a) => a.category_group && GROUPS.includes(a.category_group) && !a.archived && (department?.is_operating || a.category_group !== 'revenue'));
  const cell = (a: LedgerAccount, m: string) => grid[a.id]?.[m] ?? '';
  const setCell = (a: LedgerAccount, m: string, v: string) => {
    setGrid((g) => ({ ...g, [a.id]: { ...(g[a.id] ?? {}), [m]: v.replace(/[^\d.]/g, '') } }));
    setDirty(true);
  };
  const rowTotal = (a: LedgerAccount) => months.reduce((s, m) => s + (Number(cell(a, m)) || 0), 0);
  const save = async () => {
    try {
      const out = [];
      for (const a of categories) for (const m of months) {
        const raw = cell(a, m);
        const existing = (budgets.data ?? []).some((b) => b.department_id === deptId && b.account_id === a.id && b.month === m);
        if (raw === '' && !existing) continue;
        out.push({ department_id: deptId, account_id: a.id, month: m, amount_lkr_minor: Math.round((Number(raw) || 0) * 100) });
      }
      await repo.upsertBudgets(out);
      await qc.invalidateQueries({ queryKey: ['budgets'] });
      toast.success('Budget saved');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const fyOptions = [currentFy - 1, currentFy, currentFy + 1].map((y) => ({ value: String(y), label: fiscalYearFromStart(y, fyStart).label }));

  return (
    <>
      <PageHeader
        title="Budgets"
        description="Monthly targets per department and category, compared with actual cleared figures."
        actions={
          <>
            <Select aria-label="Department" className="w-48" value={deptId} onChange={(e) => setDeptId(e.target.value)} options={L.departments.map((d) => ({ value: d.id, label: d.name }))} />
            <Select aria-label="Financial year" className="w-36" value={String(fy)} onChange={(e) => setFy(Number(e.target.value))} options={fyOptions} />
            <SegmentedControl value={view} onChange={setView} options={[{ value: 'actual', label: 'Budget vs actual' }, { value: 'plan', label: 'Edit budget' }]} />
          </>
        }
      />
      {view === 'actual' ? (
        vsActual.length === 0 ? (
          <Card><EmptyState icon={<Target />} title="No budget for this department and year" body="Switch to “Edit budget” to set monthly targets." action={canEdit && <Button variant="primary" onClick={() => setView('plan')}>Set a budget</Button>} /></Card>
        ) : (
          <Card padded={false}>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="px-5 py-2.5 text-left font-medium">Category</th>
                  <th className="px-3 py-2.5 text-right font-medium">Full-year budget</th>
                  <th className="px-3 py-2.5 text-right font-medium">Budget to date</th>
                  <th className="px-3 py-2.5 text-right font-medium">Actual to date</th>
                  <th className="px-3 py-2.5 text-right font-medium">Variance</th>
                  <th className="w-64 px-5 py-2.5 text-left font-medium">Used</th>
                </tr>
              </thead>
              <tbody>
                {vsActual.map((l) => {
                  const used = l.budget ? l.actual / l.budget : null;
                  const isIncome = l.account.type === 'income';
                  const bad = isIncome ? (used ?? 0) < 1 : (used ?? 0) > 1;
                  return (
                    <tr key={l.account.id} className="border-b border-line last:border-0">
                      <td className="px-5 py-2.5"><p className="text-ink">{l.account.name}</p><p className="text-xs text-muted">{GROUP_LABELS[l.account.category_group!]}</p></td>
                      <td className="px-3 py-2.5 text-right text-ink-2 tabular">{formatMoney(fullYear.get(l.account.id) ?? 0, 'LKR', { plain: true, whole: true })}</td>
                      <td className="px-3 py-2.5 text-right tabular">{formatMoney(l.budget, 'LKR', { plain: true, whole: true })}</td>
                      <td className="px-3 py-2.5 text-right tabular">{formatMoney(l.actual, 'LKR', { plain: true, whole: true })}</td>
                      <td className={cn('px-3 py-2.5 text-right tabular', l.variance < 0 ? 'text-negative' : 'text-positive')}>{formatMoney(l.variance, 'LKR', { plain: true, whole: true, signed: true })}</td>
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-surface-3">
                            <div className={cn('h-1.5 rounded-full', bad ? (isIncome ? 'bg-[var(--status-serious)]' : 'bg-[var(--status-critical)]') : 'bg-[var(--status-good)]')} style={{ width: `${Math.min(100, (used ?? 0) * 100)}%` }} />
                          </div>
                          <span className="w-12 text-right text-xs text-ink-2 tabular">{formatPct(used, 0)}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="border-t border-line px-5 py-3 text-xs text-muted">Compared up to the current month ({monthsToDate.length} of 12). For income, green means on or above target. For costs, green means within budget. Variance is positive when it is favourable.</p>
          </Card>
        )
      ) : (
        <Card padded={false}>
          {!canEdit && <Callout className="m-5" tone="info">You can view this budget but only {department?.name}&apos;s director or an admin can change it.</Callout>}
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="sticky left-0 z-10 min-w-56 bg-surface px-4 py-2 text-left font-medium">Category (LKR)</th>
                  {months.map((m) => <th key={m} className="min-w-24 px-1 py-2 text-right font-medium">{monthLabel(m, false)}</th>)}
                  <th className="min-w-28 px-4 py-2 text-right font-medium">Year</th>
                </tr>
              </thead>
              <tbody>
                {GROUPS.map((g) => {
                  const cats = categories.filter((a) => a.category_group === g);
                  if (!cats.length) return null;
                  return [
                    <tr key={g} className="bg-surface-2"><td colSpan={14} className="sticky left-0 px-4 py-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">{GROUP_LABELS[g]}</td></tr>,
                    ...cats.map((a) => (
                      <tr key={a.id} className="border-b border-line">
                        <td className="sticky left-0 z-10 bg-surface px-4 py-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">{a.name}</span>
                            {canEdit && <button type="button" title="Copy the first month to all months" aria-label={`Fill ${a.name} across`} className="cursor-pointer text-muted hover:text-ink" onClick={() => { const first = cell(a, months[0]); months.forEach((m) => setCell(a, m, first)); }}><ArrowRightToLine className="size-3.5" /></button>}
                          </div>
                        </td>
                        {months.map((m) => (
                          <td key={m} className="px-1 py-1">
                            <input aria-label={`${a.name} ${monthLabel(m)}`} disabled={!canEdit} inputMode="decimal" className="h-7 w-full rounded border border-transparent bg-transparent px-1.5 text-right tabular hover:border-line focus:border-focus focus:bg-surface focus:outline-none disabled:text-ink-2" value={cell(a, m)} onChange={(e) => setCell(a, m, e.target.value)} placeholder="—" />
                          </td>
                        ))}
                        <td className="px-4 py-1 text-right font-medium tabular">{rowTotal(a) ? rowTotal(a).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}</td>
                      </tr>
                    )),
                  ];
                })}
              </tbody>
            </table>
          </div>
          {canEdit && (
            <div className="flex items-center justify-end gap-3 border-t border-line bg-surface-2 px-5 py-3">
              {dirty && <span className="text-xs text-caution">Unsaved changes</span>}
              <Button variant="primary" disabled={!dirty} onClick={() => void save()}><Save /> Save budget</Button>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
