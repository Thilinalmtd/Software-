import { AlertTriangle, ArrowRight, CircleAlert, Info, Landmark, TrendingDown, TrendingUp, Wallet, Coins } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { compactNumber, EChart, type ChartTheme } from '@/components/chart';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader, Spinner, StatTile } from '@/components/ui/misc';
import { formatMoney, formatPct } from '@/domain/money';
import { addMonths, fiscalYear, formatDate, monthLabel, monthStart } from '@/domain/period';
import { accountBalances, allocateSharedCost, countableRows, figuresFor, monthlySummary, projectFigures, revenueByChannel, spendByCategory } from '@/domain/reports';
import type { AttentionSeverity } from '@/domain/attention';
import { useAppData } from '@/data/context';
import { canRecord } from '@/data/permissions';
import { usePeriod, useUi } from '@/app/ui-state';
import { cn } from '@/lib/cn';
import { Amount, DeptTag, KindBadge } from '../shared/bits';
import { useAttention, useReportData } from '../shared/useFinance';

export default function Dashboard() {
  const { L, rows, ctx, rates, loading } = useReportData();
  const { dept } = useUi();
  const { range, label } = usePeriod();
  const { member } = useAppData();
  const navigate = useNavigate();
  const attention = useAttention();
  const deptId = dept === 'all' ? null : dept;
  const deptObj = deptId ? L.deptMap.get(deptId) : undefined;

  const period = useMemo(() => figuresFor(countableRows(rows, { range }), ctx), [rows, ctx, range]);
  const balances = useMemo(() => accountBalances(rows, L.accounts, rates).filter((b) => !b.account.archived && (!deptId || b.account.department_id === deptId)), [rows, L.accounts, rates, deptId]);
  const cashToday = balances.reduce((s, b) => s + b.currentLkrMinor, 0);
  const fig = deptId ? period.byDept[deptId] : null;
  const revenue = fig ? fig.revenue : period.revenue;
  const costs = fig ? fig.expenses + fig.payroll : period.totalCost;
  const profit = fig ? fig.operatingProfit : period.operatingProfit;
  const margin = revenue ? profit / revenue : null;

  // Monthly chart: the months of the selected period (max 12, ending with the period's last month)
  const months = useMemo(() => {
    const end = monthStart(range.to);
    const start = monthStart(range.from) > addMonths(end, -11) ? monthStart(range.from) : addMonths(end, -11);
    const list: string[] = [];
    for (let m = start; m <= end; m = addMonths(m, 1)) list.push(m);
    return list;
  }, [range]);
  const summary = useMemo(() => monthlySummary(rows, ctx, months), [rows, ctx, months]);
  const monthSeries = summary.months.map((m) => {
    const f = deptId ? m.figures.byDept[deptId] : null;
    return { month: m.month, revenue: f ? f.revenue : m.figures.revenue, costs: f ? f.expenses + f.payroll : m.figures.totalCost, profit: f ? f.operatingProfit : m.figures.operatingProfit };
  });

  const monthlyOption = useCallback(
    (t: ChartTheme) => ({
      color: [t.series[0], t.series[1], t.series[2]],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: t.line } },
        valueFormatter: (v: number) => formatMoney(Math.round(v * 100), 'LKR', { whole: true }),
      },
      legend: { data: ['Revenue', 'Costs', 'Operating profit'] },
      xAxis: { type: 'category', data: monthSeries.map((m) => monthLabel(m.month, false)), axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false }, axisLabel: { color: t.ink2 } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: t.grid, type: 'solid' } }, axisLabel: { color: t.ink2, formatter: (v: number) => compactNumber(v * 100) } },
      series: [
        { name: 'Revenue', type: 'bar', barMaxWidth: 24, barGap: '15%', itemStyle: { borderRadius: [4, 4, 0, 0] }, data: monthSeries.map((m) => m.revenue / 100) },
        { name: 'Costs', type: 'bar', barMaxWidth: 24, itemStyle: { borderRadius: [4, 4, 0, 0] }, data: monthSeries.map((m) => m.costs / 100) },
        { name: 'Operating profit', type: 'line', symbol: 'circle', symbolSize: 8, lineStyle: { width: 2 }, itemStyle: { borderColor: t.surface, borderWidth: 2 }, data: monthSeries.map((m) => m.profit / 100) },
      ],
    }),
    [monthSeries],
  );

  const spend = useMemo(() => {
    const list = spendByCategory(rows, ctx, { range, departmentId: deptId });
    const top = list.slice(0, 7);
    const rest = list.slice(7).reduce((s, x) => s + x.totalMinor, 0);
    const items = top.map((x) => ({ name: x.account.name, value: x.totalMinor }));
    if (rest > 0) items.push({ name: 'Other', value: rest });
    return items.reverse();
  }, [rows, ctx, range, deptId]);
  const spendOption = useCallback(
    (t: ChartTheme) => ({
      color: [t.series[1]],
      grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
      tooltip: { trigger: 'item', valueFormatter: (v: number) => formatMoney(Math.round(v * 100), 'LKR', { whole: true }) },
      xAxis: { type: 'value', show: false },
      yAxis: { type: 'category', data: spend.map((s) => s.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.ink2, width: 170, overflow: 'truncate' } },
      series: [{ type: 'bar', barMaxWidth: 16, itemStyle: { borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: t.ink2, fontSize: 11, formatter: (p: { value: number }) => compactNumber(p.value * 100) }, data: spend.map((s) => s.value / 100) }],
    }),
    [spend],
  );

  const cashItems = useMemo(() => [...balances].sort((a, b) => a.currentLkrMinor - b.currentLkrMinor), [balances]);
  const cashOption = useCallback(
    (t: ChartTheme) => ({
      color: [t.series[0]],
      grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const b = cashItems[p.dataIndex];
          const own = b.account.currency !== 'LKR' ? `<br/>${formatMoney(b.balanceMinor, b.account.currency ?? 'LKR')}` : '';
          return `<b>${b.account.name}</b><br/>${formatMoney(b.currentLkrMinor)}${own}`;
        },
      },
      xAxis: { type: 'value', show: false },
      yAxis: { type: 'category', data: cashItems.map((b) => b.account.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.ink2, width: 170, overflow: 'truncate' } },
      series: [{ type: 'bar', barMaxWidth: 16, itemStyle: { borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: t.ink2, fontSize: 11, formatter: (p: { value: number }) => compactNumber(p.value * 100) }, data: cashItems.map((b) => b.currentLkrMinor / 100) }],
    }),
    [cashItems],
  );

  const channels = useMemo(() => revenueByChannel(rows, ctx, { range, departmentId: deptId }), [rows, ctx, range, deptId]);
  const projects = useMemo(
    () =>
      projectFigures(rows, L.projects.filter((p) => !deptId || p.department_id === deptId), ctx, { range }, rates)
        .filter((p) => p.revenue > 0 || p.directCosts > 0)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 6),
    [rows, L.projects, ctx, range, rates, deptId],
  );
  const allocation = L.settings ? allocateSharedCost(period, ctx, L.settings.allocation) : {};
  const recent = useMemo(() => {
    const seen = new Set<string>();
    return [...rows]
      .filter((r) => r.role === 'money' && (!deptId || r.department_id === deptId || r.entry_department_id === deptId))
      .sort((a, b) => b.date.localeCompare(a.date) || b.entry_number.localeCompare(a.entry_number))
      .filter((r) => (seen.has(r.entry_id) ? false : (seen.add(r.entry_id), true)))
      .slice(0, 8);
  }, [rows, deptId]);

  if (loading) return <Spinner />;
  const fy = fiscalYear(range.to, L.settings?.fy_start_month ?? 4);
  const hasData = rows.length > 0;

  return (
    <>
      <PageHeader
        title={deptObj ? `${deptObj.name} department` : 'Company overview'}
        description={`${label} · ${formatDate(range.from)} – ${formatDate(range.to)}${deptObj?.director_name ? ` · Director: ${deptObj.director_name}` : ''}`}
        actions={
          <Button onClick={() => navigate('/reports')}>
            Full reports <ArrowRight />
          </Button>
        }
      />
      {!hasData ? (
        <Card>
          <EmptyState icon={<Coins />} title="No entries yet" body="Start by adding your bank and platform accounts with their opening balances, then record your first income or expense." action={<Button variant="primary" onClick={() => navigate('/accounts')}>Set up accounts</Button>} />
        </Card>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatTile label="Revenue" icon={<TrendingUp />} value={formatMoney(revenue, 'LKR', { compact: true })} foot={formatMoney(revenue, 'LKR', { whole: true })} onClick={() => navigate('/reports?tab=pl')} />
            <StatTile label={deptId ? 'Costs incl. payroll' : 'Total costs'} icon={<TrendingDown />} value={formatMoney(costs, 'LKR', { compact: true })} foot={fig ? `Payroll ${formatMoney(fig.payroll, 'LKR', { compact: true })} · Other ${formatMoney(fig.expenses, 'LKR', { compact: true })}` : `Incl. shared costs ${formatMoney(period.corporateCost, 'LKR', { compact: true })}`} onClick={() => navigate('/reports?tab=spending')} />
            <StatTile label="Operating profit" icon={<Wallet />} tone={profit < 0 ? 'negative' : 'neutral'} value={formatMoney(profit, 'LKR', { compact: true })} foot={`Margin ${formatPct(margin)}${deptId && allocation[deptId] ? ` · after shared costs ${formatMoney(profit - allocation[deptId], 'LKR', { compact: true })}` : ''}`} onClick={() => navigate('/reports?tab=monthly')} />
            <StatTile label="Cash today" icon={<Landmark />} value={formatMoney(cashToday, 'LKR', { compact: true })} foot={`${balances.length} account${balances.length === 1 ? '' : 's'} at today's rates`} onClick={() => navigate('/accounts')} />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <Card className="xl:col-span-2" title="Revenue, costs and profit by month" description={`${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])} · LKR · cleared entries`}>
              <EChart height={300} option={monthlyOption} ariaLabel="Revenue, costs and operating profit by month" onClick={(p) => navigate(`/entries?month=${monthSeries[p.dataIndex]?.month.slice(0, 7)}`)} />
            </Card>
            <Card title="Needs attention" description={attention.length ? `${attention.length} item${attention.length === 1 ? '' : 's'}` : 'All clear'}>
              {attention.length === 0 ? (
                <EmptyState className="py-8" icon={<CircleAlert />} title="Nothing needs you right now" body="Receipts, reconciliations, statutory payments and invoices are all up to date." />
              ) : (
                <ul className="-mx-2 max-h-[300px] space-y-1 overflow-y-auto">
                  {attention.map((a) => (
                    <li key={a.id}>
                      <Link to={a.link} className="flex gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
                        <SeverityIcon severity={a.severity} />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium text-ink">{a.title}</span>
                          <span className="block text-xs text-ink-2">{a.detail}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {!deptId && (
            <Card title="Departments" description={`Each department measured on its own; transfers never count as profit. ${L.settings?.allocation.method !== 'none' ? 'Shared costs allocated by ' + (L.settings?.allocation.method === 'fixed' ? 'fixed %' : 'revenue share') + '.' : ''}`} padded={false}>
              <DeptTable period={period} allocation={allocation} />
            </Card>
          )}

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card title="Where the money went" description="Costs by category, including payroll">
              {spend.length ? <EChart height={Math.max(180, spend.length * 34)} option={spendOption} ariaLabel="Costs by category" onClick={() => navigate('/reports?tab=spending')} /> : <EmptyState className="py-8" title="No costs in this period" />}
            </Card>
            <Card title="Cash by account" description="Cleared balances valued at today's exchange rates">
              {cashItems.length ? <EChart height={Math.max(180, cashItems.length * 34)} option={cashOption} ariaLabel="Cash by account" onClick={(p) => navigate(`/accounts/${cashItems[p.dataIndex].account.id}`)} /> : <EmptyState className="py-8" title="No accounts yet" />}
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <Card className="xl:col-span-2" title="Projects" description="Contribution = revenue − direct costs − payroll allocated to the project" action={<Button size="sm" variant="ghost" onClick={() => navigate('/projects')}>All projects <ArrowRight /></Button>} padded={false}>
              {projects.length === 0 ? (
                <EmptyState className="py-8" title="No project activity in this period" />
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-xs text-muted">
                      <th className="px-5 py-2 text-left font-medium">Project</th>
                      <th className="px-3 py-2 text-right font-medium">Revenue</th>
                      <th className="px-3 py-2 text-right font-medium">Contribution</th>
                      <th className="w-40 px-5 py-2 text-left font-medium">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p) => (
                      <tr key={p.project.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2" onClick={() => navigate(`/projects/${p.project.id}`)}>
                        <td className="px-5 py-2.5">
                          <span className="block font-medium text-ink">{p.project.name}</span>
                          <span className="text-xs text-muted">{p.project.code} · {L.deptMap.get(p.project.department_id)?.name}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular">{formatMoney(p.revenue, 'LKR', { whole: true, plain: true })}</td>
                        <td className={cn('px-3 py-2.5 text-right tabular', p.contribution < 0 && 'text-negative')}>{formatMoney(p.contribution, 'LKR', { whole: true, plain: true })}</td>
                        <td className="px-5 py-2.5">
                          <MarginBar value={p.margin} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card title="Revenue by channel">
              {channels.length === 0 ? (
                <EmptyState className="py-6" title="No revenue in this period" />
              ) : (
                <ul className="space-y-3">
                  {channels.map((c) => {
                    const total = channels.reduce((s, x) => s + x.totalMinor, 0);
                    const pct = total ? c.totalMinor / total : 0;
                    return (
                      <li key={c.channel}>
                        <div className="flex justify-between text-[13px]">
                          <span className="text-ink">{c.channel}</span>
                          <span className="text-ink-2 tabular">{formatMoney(c.totalMinor, 'LKR', { compact: true })} · {formatPct(pct, 0)}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full bg-surface-3">
                          <div className="h-1.5 rounded-full bg-[var(--series-1)]" style={{ width: `${Math.max(2, pct * 100)}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Latest activity" action={<Button size="sm" variant="ghost" onClick={() => navigate('/entries')}>All entries <ArrowRight /></Button>} padded={false}>
            <table className="w-full text-[13px]">
              <tbody>
                {recent.map((r) => (
                  <tr key={r.entry_id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2" onClick={() => navigate(`/entries?id=${r.entry_id}`)}>
                    <td className="w-28 px-5 py-2.5 text-ink-2 tabular">{formatDate(r.date)}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-ink">{r.entry_description}</span>
                      {r.status !== 'cleared' && <span className="ml-2 text-xs text-caution">{r.status}</span>}
                    </td>
                    <td className="px-3 py-2.5"><KindBadge kind={r.kind} /></td>
                    <td className="px-3 py-2.5"><DeptTag dept={L.deptMap.get(r.entry_department_id)} /></td>
                    <td className="px-5 py-2.5 text-right"><Amount minor={r.amount_minor} currency={r.currency} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <p className="pb-2 text-center text-xs text-muted">
            {fy.label} runs {formatDate(fy.range.from)} – {formatDate(fy.range.to)}. Pending and voided entries are excluded from all figures.
            {canRecord(member) ? ' Press Ctrl+N to add an entry.' : ''}
          </p>
        </div>
      )}
    </>
  );
}

function SeverityIcon({ severity }: { severity: AttentionSeverity }) {
  if (severity === 'danger') return <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--status-critical)]" aria-label="Urgent" />;
  if (severity === 'warning') return <CircleAlert className="mt-0.5 size-4 shrink-0 text-[var(--status-serious)]" aria-label="Warning" />;
  return <Info className="mt-0.5 size-4 shrink-0 text-info" aria-label="Info" />;
}

export function MarginBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-muted">—</span>;
  const pct = Math.max(-1, Math.min(1, value));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-surface-3">
        <div className={cn('h-1.5 rounded-full', pct >= 0 ? 'bg-[var(--status-good)]' : 'bg-[var(--status-critical)]')} style={{ width: `${Math.abs(pct) * 100}%` }} />
      </div>
      <span className={cn('w-11 text-right text-xs tabular', value < 0 ? 'text-negative' : 'text-ink-2')}>{formatPct(value, 0)}</span>
    </div>
  );
}

function DeptTable({ period, allocation }: { period: ReturnType<typeof figuresFor>; allocation: Record<string, number> }) {
  const { L } = useReportData();
  const navigate = useNavigate();
  const { setDept } = useUi();
  const showAlloc = L.settings?.allocation.method !== 'none';
  const cols = ['Revenue', 'Expenses', 'Payroll', 'Operating profit', 'Margin', ...(showAlloc ? ['After shared costs'] : []), 'Transfers net', 'Net cash movement'];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            <th className="px-5 py-2 text-left font-medium">Department</th>
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 text-right font-medium whitespace-nowrap last:pr-5">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {L.departments.filter((d) => !d.archived).map((d) => {
            const f = period.byDept[d.id];
            if (!f) return null;
            const cells = [f.revenue, f.expenses, f.payroll, f.operatingProfit];
            return (
              <tr
                key={d.id}
                className="cursor-pointer border-b border-line hover:bg-surface-2"
                onClick={() => {
                  setDept(d.id);
                  navigate('/');
                }}
              >
                <td className="px-5 py-2.5 font-medium"><DeptTag dept={d} className="text-ink" /></td>
                {cells.map((v, i) => (
                  <td key={i} className={cn('px-3 py-2.5 text-right tabular', i === 3 && v < 0 && 'text-negative', i === 3 && 'font-semibold')}>{d.is_operating || i > 0 ? formatMoney(v, 'LKR', { whole: true, plain: true, brackets: true }) : '—'}</td>
                ))}
                <td className="px-3 py-2.5 text-right tabular text-ink-2">{d.is_operating ? formatPct(f.margin) : '—'}</td>
                {showAlloc && <td className="px-3 py-2.5 text-right tabular">{d.is_operating ? formatMoney(f.operatingProfit - (allocation[d.id] ?? 0), 'LKR', { whole: true, plain: true, brackets: true }) : `(${formatMoney(period.corporateCost, 'LKR', { whole: true, plain: true })}) allocated`}</td>}
                <td className="px-3 py-2.5 text-right tabular text-ink-2">{formatMoney(f.transferNet, 'LKR', { whole: true, plain: true, brackets: true })}</td>
                <td className="px-3 py-2.5 pr-5 text-right tabular text-ink-2">{formatMoney(f.netCash, 'LKR', { whole: true, plain: true, brackets: true })}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-surface-2 font-semibold">
            <td className="px-5 py-2.5">Company</td>
            <td className="px-3 py-2.5 text-right tabular">{formatMoney(period.revenue, 'LKR', { whole: true, plain: true })}</td>
            <td className="px-3 py-2.5 text-right tabular" colSpan={2}>{formatMoney(period.totalCost, 'LKR', { whole: true, plain: true })} total cost</td>
            <td className={cn('px-3 py-2.5 text-right tabular', period.operatingProfit < 0 && 'text-negative')}>{formatMoney(period.operatingProfit, 'LKR', { whole: true, plain: true, brackets: true })}</td>
            <td className="px-3 py-2.5 text-right tabular">{formatPct(period.margin)}</td>
            {showAlloc && <td />}
            <td className="px-3 py-2.5 text-right tabular text-ink-2">—</td>
            <td className="px-3 py-2.5 pr-5 text-right tabular">{formatMoney(period.netCash, 'LKR', { whole: true, plain: true, brackets: true })}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
