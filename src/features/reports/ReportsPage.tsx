import { AlertTriangle, FileDown, FileSpreadsheet, Info, Package } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Badge, Callout, Card, EmptyState, PageHeader, Spinner, Tabs } from '@/components/ui/misc';
import { formatMoney, formatPct } from '@/domain/money';
import { fiscalMonths, fiscalYear, fiscalYearFromStart, formatDate, monthLabel, today } from '@/domain/period';
import { AGE_BUCKET_LABELS, cashFlow, figuresFor, countableRows, monthlySummary, profitAndLoss, spendByCategory, taxMonitor, trialBalance, type AgeBucket, type CompanyFigures } from '@/domain/reports';
import type { Department } from '@/domain/types';
import { useTable } from '@/data/hooks';
import { cn, errorMessage } from '@/lib/cn';
import { exportWorkbook, xl, type SheetSpec } from '@/lib/excel';
import { downloadTableReport } from '@/lib/pdf';
import { usePeriod, useUi } from '@/app/ui-state';
import { KIND_LABELS } from '../shared/bits';
import { useBillsDue, useReceivables, useReportData } from '../shared/useFinance';

type Tab = 'monthly' | 'pl' | 'cash' | 'spending' | 'ageing' | 'tax' | 'pack';

const m0 = (v: number) => formatMoney(v, 'LKR', { plain: true, whole: true, brackets: true });

export default function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'monthly';
  const { loading } = useReportData();
  const tabs: { value: Tab; label: string }[] = [
    { value: 'monthly', label: 'Monthly summary' },
    { value: 'pl', label: 'Profit & loss by department' },
    { value: 'cash', label: 'Cash flow' },
    { value: 'spending', label: 'Spending' },
    { value: 'ageing', label: 'Owed & owing' },
    { value: 'tax', label: 'Tax monitor' },
    { value: 'pack', label: "Accountant's pack" },
  ];
  return (
    <>
      <PageHeader title="Reports" description="Management reports in LKR (cash basis). Every figure excludes pending and voided entries." />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={tabs} className="mb-5" />
      {loading ? <Spinner /> : tab === 'monthly' ? <MonthlySummaryReport /> : tab === 'pl' ? <PLReport /> : tab === 'cash' ? <CashFlowReport /> : tab === 'spending' ? <SpendingReport /> : tab === 'ageing' ? <AgeingReport /> : tab === 'tax' ? <TaxReport /> : <AccountantPack />}
    </>
  );
}

function useFyPicker() {
  const { L } = useReportData();
  const start = L.settings?.fy_start_month ?? 4;
  const current = fiscalYear(today(), start).startYear;
  const [fy, setFy] = useState(current);
  const picker = <Select aria-label="Financial year" className="w-40" value={String(fy)} onChange={(e) => setFy(Number(e.target.value))} options={[current - 2, current - 1, current, current + 1].map((y) => ({ value: String(y), label: fiscalYearFromStart(y, start).label }))} />;
  return { fy, start, picker, label: fiscalYearFromStart(fy, start).label, range: fiscalYearFromStart(fy, start).range };
}

function ExportButtons({ onExcel, onPdf }: { onExcel: () => Promise<unknown>; onPdf?: () => Promise<unknown> }) {
  const run = (fn: () => Promise<unknown>) => fn().catch((e) => toast.error(errorMessage(e)));
  return (
    <>
      <Button onClick={() => void run(onExcel)}><FileSpreadsheet /> Excel</Button>
      {onPdf && <Button onClick={() => void run(onPdf)}><FileDown /> PDF</Button>}
    </>
  );
}

// ---------------------------------------------------------------- Monthly summary

function MonthlySummaryReport() {
  const { L, rows, ctx } = useReportData();
  const { fy, start, picker, label } = useFyPicker();
  const months = useMemo(() => fiscalMonths(fy, start), [fy, start]);
  const summary = useMemo(() => monthlySummary(rows, ctx, months), [rows, ctx, months]);
  const operating = L.departments.filter((d) => d.is_operating && !d.archived);
  const cols = (d: Department) => [
    { key: 'revenue', label: 'Revenue', get: (f: CompanyFigures) => f.byDept[d.id]?.revenue ?? 0 },
    { key: 'expenses', label: 'Expenses', get: (f: CompanyFigures) => f.byDept[d.id]?.expenses ?? 0 },
    { key: 'payroll', label: 'Payroll', get: (f: CompanyFigures) => f.byDept[d.id]?.payroll ?? 0 },
    { key: 'op', label: 'Operating profit', get: (f: CompanyFigures) => f.byDept[d.id]?.operatingProfit ?? 0, strong: true },
    { key: 'margin', label: 'Margin', pct: true, get: (f: CompanyFigures) => f.byDept[d.id]?.margin ?? null },
    { key: 'transfer', label: 'Transfers net', get: (f: CompanyFigures) => f.byDept[d.id]?.transferNet ?? 0 },
    { key: 'cash', label: 'Net cash movement', get: (f: CompanyFigures) => f.byDept[d.id]?.netCash ?? 0 },
  ];
  const company = [
    { key: 'corp', label: 'Shared cost', get: (f: CompanyFigures) => f.corporateCost },
    { key: 'rev', label: 'Company revenue', get: (f: CompanyFigures) => f.revenue },
    { key: 'cost', label: 'Company total cost', get: (f: CompanyFigures) => f.totalCost },
    { key: 'op', label: 'Company operating profit', get: (f: CompanyFigures) => f.operatingProfit, strong: true },
  ];
  const allRows = [...summary.months.map((m) => ({ label: monthLabel(m.month), f: m.figures, total: false })), { label: 'Year total', f: summary.total, total: true }];
  const fmt = (v: number | null, pct?: boolean) => (pct ? formatPct(v) : m0(v ?? 0));

  const excel = () => {
    const columns = [{ header: 'Month', key: 'month', width: 12 }, ...operating.flatMap((d) => cols(d).map((c) => ({ header: `${d.name} ${c.label}`, key: `${d.code}_${c.key}`, type: (c.pct ? 'pct' : 'money') as 'pct' | 'money', width: 15 }))), ...company.map((c) => ({ header: c.label, key: `co_${c.key}`, type: 'money' as const, width: 16 }))];
    const toRow = (label: string, f: CompanyFigures) => ({ month: label, ...Object.fromEntries(operating.flatMap((d) => cols(d).map((c) => { const v = c.get(f); return [`${d.code}_${c.key}`, c.pct ? v : xl(v as number)]; }))), ...Object.fromEntries(company.map((c) => [`co_${c.key}`, xl(c.get(f))])) });
    return exportWorkbook(`monthly-summary-${label.replace(/\W+/g, '-')}.xlsx`, [{ name: 'Monthly Summary', title: 'Monthly Department & Company Summary', subtitle: `${label} · internal transfers are shown separately and do not affect company profit`, columns, rows: summary.months.map((m) => toRow(monthLabel(m.month), m.figures)), totals: toRow('YEAR TOTAL', summary.total) }]);
  };
  const pdf = () =>
    downloadTableReport(L.settings!, `monthly-summary-${label}.pdf`, {
      title: 'Monthly summary',
      subtitle: label,
      landscape: true,
      columns: [{ header: 'Month', width: 60 }, ...operating.flatMap((d) => [{ header: `${d.code} revenue`, align: 'right' as const }, { header: `${d.code} costs`, align: 'right' as const }, { header: `${d.code} profit`, align: 'right' as const }]), { header: 'Shared cost', align: 'right' }, { header: 'Company profit', align: 'right' }],
      rows: summary.months.map((m) => [monthLabel(m.month), ...operating.flatMap((d) => { const f = m.figures.byDept[d.id]; return [m0(f?.revenue ?? 0), m0((f?.expenses ?? 0) + (f?.payroll ?? 0)), m0(f?.operatingProfit ?? 0)]; }), m0(m.figures.corporateCost), m0(m.figures.operatingProfit)]),
      totals: ['Total', ...operating.flatMap((d) => { const f = summary.total.byDept[d.id]; return [m0(f?.revenue ?? 0), m0((f?.expenses ?? 0) + (f?.payroll ?? 0)), m0(f?.operatingProfit ?? 0)]; }), m0(summary.total.corporateCost), m0(summary.total.operatingProfit)],
    });

  return (
    <Card title={`Monthly summary — ${label}`} description="Same layout as the Excel “Monthly Summary” sheet." action={<>{picker}<ExportButtons onExcel={excel} onPdf={pdf} /></>} padded={false}>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-xs text-muted">
              <th className="sticky left-0 z-10 bg-surface px-4 py-2" />
              {operating.map((d) => (
                <th key={d.id} colSpan={7} className="border-l border-line px-3 py-2 text-left font-semibold text-ink">
                  <span className="inline-flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: d.color }} />{d.name}</span>
                </th>
              ))}
              <th colSpan={4} className="border-l border-line px-3 py-2 text-left font-semibold text-ink">AptoCAD company</th>
            </tr>
            <tr className="border-b border-line text-[11px] text-muted">
              <th className="sticky left-0 z-10 bg-surface px-4 py-2 text-left font-medium">Month</th>
              {operating.flatMap((d) => cols(d).map((c, i) => <th key={d.id + c.key} className={cn('px-3 py-2 text-right font-medium whitespace-nowrap', i === 0 && 'border-l border-line')}>{c.label}</th>))}
              {company.map((c, i) => <th key={c.key} className={cn('px-3 py-2 text-right font-medium whitespace-nowrap', i === 0 && 'border-l border-line')}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {allRows.map((r) => (
              <tr key={r.label} className={cn('border-b border-line', r.total && 'bg-surface-2 font-semibold')}>
                <td className="sticky left-0 z-10 bg-inherit px-4 py-2 whitespace-nowrap">{r.label}</td>
                {operating.flatMap((d) => cols(d).map((c, i) => { const v = c.get(r.f); return <td key={d.id + c.key} className={cn('px-3 py-2 text-right tabular', i === 0 && 'border-l border-line', c.strong && 'font-semibold', typeof v === 'number' && v < 0 && !c.pct && 'text-negative')}>{fmt(v, c.pct)}</td>; }))}
                {company.map((c, i) => { const v = c.get(r.f); return <td key={c.key} className={cn('px-3 py-2 text-right tabular', i === 0 && 'border-l border-line', c.strong && 'font-semibold', v < 0 && 'text-negative')}>{m0(v)}</td>; })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- P&L by department

function PLReport() {
  const { L, rows, ctx } = useReportData();
  const { range, label } = usePeriod();
  const pl = useMemo(() => profitAndLoss(rows, ctx, { range }, L.settings?.allocation ?? { method: 'none', fixed_pct: {} }), [rows, ctx, range, L.settings]);
  const depts = L.departments.filter((d) => !d.archived);
  const showAlloc = L.settings?.allocation.method !== 'none';
  const F = pl.figures;
  const summaryRows: { label: string; get: (d: Department | null) => number | null; strong?: boolean; pct?: boolean }[] = [
    { label: 'Operating profit', get: (d) => (d ? F.byDept[d.id]?.operatingProfit ?? 0 : F.operatingProfit), strong: true },
    { label: 'Operating margin', get: (d) => (d ? F.byDept[d.id]?.margin ?? null : F.margin), pct: true },
    ...(showAlloc ? [{ label: 'Shared costs allocated', get: (d: Department | null) => (d ? (d.is_operating ? -(pl.allocation[d.id] ?? 0) : F.byDept[d.id] ? F.corporateCost : 0) : 0) }, { label: 'Fully loaded profit', get: (d: Department | null) => (d ? (d.is_operating ? pl.fullyLoaded[d.id] : 0) : F.operatingProfit), strong: true }] : []),
    { label: 'Tax on profits', get: (d) => (d ? -(F.byDept[d.id]?.incomeTax ?? 0) : -depts.reduce((s, x) => s + (F.byDept[x.id]?.incomeTax ?? 0), 0)) },
    { label: 'Net profit', get: (d) => (d ? pl.netProfit[d.id] : pl.netProfitTotal), strong: true },
  ];
  const excel = () =>
    exportWorkbook(`profit-and-loss-${range.from}-${range.to}.xlsx`, [
      {
        name: 'P&L by department',
        title: 'Profit & loss by department',
        subtitle: `${formatDate(range.from)} – ${formatDate(range.to)} · cash basis, LKR`,
        columns: [{ header: 'Line', key: 'line', width: 40 }, ...depts.map((d) => ({ header: d.name, key: d.code, type: 'money' as const })), { header: 'Company', key: 'total', type: 'money' as const }],
        rows: pl.sections.flatMap((s) => [
          ...s.lines.map((l) => ({ line: `${s.label} — ${l.account.name}`, ...Object.fromEntries(depts.map((d) => [d.code, xl(l.byDept[d.id] ?? 0)])), total: xl(l.total) })),
          { line: `Total ${s.label.toLowerCase()}`, ...Object.fromEntries(depts.map((d) => [d.code, xl(s.byDept[d.id] ?? 0)])), total: xl(s.total) },
        ]).concat(summaryRows.filter((r) => !r.pct).map((r) => ({ line: r.label, ...Object.fromEntries(depts.map((d) => [d.code, xl(r.get(d) ?? 0)])), total: xl(r.get(null) ?? 0) }))),
      },
    ]);
  return (
    <Card title="Profit & loss by department" description={`${label} · ${formatDate(range.from)} – ${formatDate(range.to)}`} action={<ExportButtons onExcel={excel} />} padded={false}>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="px-5 py-2.5 text-left font-medium">LKR</th>
              {depts.map((d) => <th key={d.id} className="px-3 py-2.5 text-right font-medium"><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: d.color }} />{d.name}</span></th>)}
              <th className="px-5 py-2.5 text-right font-medium">Company</th>
            </tr>
          </thead>
          <tbody>
            {pl.sections.map((s) => (
              <PLSection key={s.group} title={s.label}>
                {s.lines.map((l) => (
                  <tr key={l.account.id} className="text-ink-2">
                    <td className="px-5 py-1.5 pl-8">{l.account.name}</td>
                    {depts.map((d) => <td key={d.id} className="px-3 py-1.5 text-right tabular">{l.byDept[d.id] ? m0(l.byDept[d.id]) : '—'}</td>)}
                    <td className="px-5 py-1.5 text-right tabular">{m0(l.total)}</td>
                  </tr>
                ))}
                <tr className="border-b border-line font-semibold">
                  <td className="px-5 py-2">Total {s.label.toLowerCase()}</td>
                  {depts.map((d) => <td key={d.id} className="px-3 py-2 text-right tabular">{m0(s.byDept[d.id] ?? 0)}</td>)}
                  <td className="px-5 py-2 text-right tabular">{m0(s.total)}</td>
                </tr>
              </PLSection>
            ))}
            {summaryRows.map((r) => (
              <tr key={r.label} className={cn('border-b border-line', r.strong && 'bg-surface-2 font-semibold')}>
                <td className="px-5 py-2.5">{r.label}</td>
                {depts.map((d) => { const v = r.get(d); return <td key={d.id} className={cn('px-3 py-2.5 text-right tabular', !r.pct && (v ?? 0) < 0 && 'text-negative')}>{r.pct ? formatPct(v) : m0(v ?? 0)}</td>; })}
                <td className={cn('px-5 py-2.5 text-right tabular', !r.pct && (r.get(null) ?? 0) < 0 && 'text-negative')}>{r.pct ? formatPct(r.get(null)) : m0(r.get(null) ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showAlloc && <p className="border-t border-line px-5 py-3 text-xs text-muted">Shared (Corporate) costs are allocated to operating departments by {L.settings?.allocation.method === 'fixed' ? 'fixed percentages' : 'share of revenue'} for the “fully loaded” view only; nothing is posted.</p>}
    </Card>
  );
}

function PLSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <tr className="bg-surface-2"><td colSpan={99} className="px-5 py-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">{title}</td></tr>
      {children}
    </>
  );
}

// ---------------------------------------------------------------- Cash flow

function CashFlowReport() {
  const { L, rows, ctx } = useReportData();
  const { dept } = useUi();
  const { fy, start, picker, label, range } = useFyPicker();
  const months = useMemo(() => fiscalMonths(fy, start), [fy, start]);
  const deptId = dept === 'all' ? null : dept;
  const flow = useMemo(() => cashFlow(rows, ctx, months, { departmentId: deptId }), [rows, ctx, months, deptId]);
  const openingCash = useMemo(() => rows.filter((r) => r.status === 'cleared' && r.date < range.from && L.accountMap.get(r.account_id) && ['bank', 'platform', 'cash', 'card'].includes(L.accountMap.get(r.account_id)!.type) && (!deptId || r.department_id === deptId)).reduce((s, r) => s + r.amount_lkr_minor, 0), [rows, range.from, L.accountMap, deptId]);
  const openingEntries = useMemo(() => rows.filter((r) => r.status === 'cleared' && r.kind === 'opening_balance' && r.date >= range.from && r.date <= range.to && r.role === 'money' && (!deptId || r.department_id === deptId)).reduce((s, r) => s + r.amount_lkr_minor, 0), [rows, range, deptId]);
  let running = openingCash + openingEntries;
  const withBal = flow.map((m) => ({ ...m, open: running, close: (running += m.net) }));
  const lines: { key: keyof (typeof withBal)[number]; label: string; strong?: boolean }[] = [
    { key: 'open', label: 'Opening cash' },
    { key: 'receipts', label: 'Received from clients' },
    { key: 'payments', label: 'Paid to suppliers' },
    { key: 'payroll', label: 'Net salaries paid' },
    { key: 'statutory', label: 'EPF / ETF / APIT paid' },
    { key: 'transfersNet', label: deptId ? 'Transfers with other departments' : 'Transfers (exchange & fees)' },
    { key: 'other', label: 'Other' },
    { key: 'net', label: 'Net cash movement', strong: true },
    { key: 'close', label: 'Closing cash', strong: true },
  ];
  const excel = () => exportWorkbook(`cash-flow-${label.replace(/\W+/g, '-')}.xlsx`, [{ name: 'Cash flow', title: 'Cash flow', subtitle: `${label}${deptId ? ` · ${L.deptMap.get(deptId)?.name}` : ''} · LKR at posted rates`, columns: [{ header: '', key: 'label', width: 34 }, ...withBal.map((m) => ({ header: monthLabel(m.month, true), key: m.month, type: 'money' as const, width: 13 }))], rows: lines.map((l) => ({ label: l.label, ...Object.fromEntries(withBal.map((m) => [m.month, xl(m[l.key] as number)])) })) }]);
  return (
    <Card title={`Cash flow — ${label}`} description={`${deptId ? L.deptMap.get(deptId)?.name + ' · ' : ''}Money actually moving through bank, platform and cash accounts (LKR at the rates posted).${openingEntries ? ' Includes opening balances entered this year.' : ''}`} action={<>{picker}<ExportButtons onExcel={excel} /></>} padded={false}>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="sticky left-0 bg-surface px-5 py-2 text-left font-medium">LKR</th>
              {withBal.map((m) => <th key={m.month} className="px-3 py-2 text-right font-medium whitespace-nowrap">{monthLabel(m.month, false)}</th>)}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className={cn('border-b border-line', l.strong && 'bg-surface-2 font-semibold')}>
                <td className="sticky left-0 bg-inherit px-5 py-2 whitespace-nowrap">{l.label}</td>
                {withBal.map((m) => { const v = m[l.key] as number; return <td key={m.month} className={cn('px-3 py-2 text-right tabular', v < 0 && 'text-negative')}>{v ? m0(v) : '—'}</td>; })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Spending

function SpendingReport() {
  const { L, rows, ctx } = useReportData();
  const { dept } = useUi();
  const { range, label } = usePeriod();
  const navigate = useNavigate();
  const deptId = dept === 'all' ? null : dept;
  const list = useMemo(() => spendByCategory(rows, ctx, { range, departmentId: deptId }), [rows, ctx, range, deptId]);
  const total = list.reduce((s, x) => s + x.totalMinor, 0);
  const excel = () => exportWorkbook(`spending-${range.from}-${range.to}.xlsx`, [{ name: 'Spending', title: 'Spending by category', subtitle: `${formatDate(range.from)} – ${formatDate(range.to)}${deptId ? ` · ${L.deptMap.get(deptId)?.name}` : ''}`, columns: [{ header: 'Category', key: 'cat', width: 36 }, { header: 'Group', key: 'group', width: 20 }, { header: 'LKR', key: 'lkr', type: 'money' }, { header: 'Share', key: 'share', type: 'pct' }], rows: list.map((x) => ({ cat: x.account.name, group: x.account.category_group, lkr: xl(x.totalMinor), share: total ? x.totalMinor / total : 0 })), totals: { cat: 'Total', lkr: xl(total), share: 1 } }]);
  return (
    <Card title="Spending by category" description={`${label}${deptId ? ` · ${L.deptMap.get(deptId)?.name}` : ' · whole company'} · includes payroll`} action={<ExportButtons onExcel={excel} />} padded={false}>
      {list.length === 0 ? (
        <EmptyState title="No costs in this period" />
      ) : (
        <table className="w-full text-[13px]">
          <tbody>
            {list.map((x) => (
              <tr key={x.account.id} className="cursor-pointer border-b border-line hover:bg-surface-2" onClick={() => navigate(`/entries?kind=${x.account.category_group === 'payroll' ? 'payroll' : 'expense'}`)}>
                <td className="w-72 px-5 py-2.5">{x.account.name}</td>
                <td className="px-3 py-2.5">
                  <div className="h-2 rounded-full bg-surface-3"><div className="h-2 rounded-full bg-[var(--series-2)]" style={{ width: `${(x.totalMinor / list[0].totalMinor) * 100}%` }} /></div>
                </td>
                <td className="w-36 px-3 py-2.5 text-right tabular">{m0(x.totalMinor)}</td>
                <td className="w-20 px-5 py-2.5 text-right text-ink-2 tabular">{formatPct(total ? x.totalMinor / total : 0)}</td>
              </tr>
            ))}
            <tr className="bg-surface-2 font-semibold"><td className="px-5 py-2.5">Total</td><td /><td className="px-3 py-2.5 text-right tabular">{m0(total)}</td><td className="px-5 py-2.5 text-right">100%</td></tr>
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Receivables & payables

function AgeingReport() {
  const { L } = useReportData();
  const receivables = useReceivables();
  const bills = useBillsDue();
  const billPayments = useTable('bill_payments');
  const navigate = useNavigate();
  const asOf = today();
  const open = receivables.list.filter((x) => x.outstanding > 0).sort((a, b) => (a.invoice.due_date ?? '').localeCompare(b.invoice.due_date ?? ''));
  const paidBills = new Map<string, number>();
  for (const p of billPayments.data ?? []) paidBills.set(p.bill_id, (paidBills.get(p.bill_id) ?? 0) + p.amount_minor);
  const Buckets = ({ buckets, total }: { buckets: Record<AgeBucket, number>; total: number }) => (
    <div className="grid grid-cols-6 gap-2 px-5 pb-4 text-[12px]">
      <div><p className="text-muted">Total</p><p className="font-semibold tabular">{formatMoney(total, 'LKR', { compact: true })}</p></div>
      {(Object.keys(AGE_BUCKET_LABELS) as AgeBucket[]).map((b) => <div key={b}><p className="text-muted">{AGE_BUCKET_LABELS[b]}</p><p className={cn('font-semibold tabular', b !== 'not_due' && buckets[b] > 0 && 'text-negative')}>{formatMoney(buckets[b], 'LKR', { compact: true })}</p></div>)}
    </div>
  );
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Card title="Owed to AptoCAD (receivables)" description="Sent invoices not yet fully paid. LKR at today's rates." padded={false}>
        <Buckets buckets={receivables.aged.buckets} total={receivables.aged.totalLkr} />
        <table className="w-full border-t border-line text-[13px]">
          <tbody>
            {open.map((x) => (
              <tr key={x.invoice.id} className="cursor-pointer border-b border-line hover:bg-surface-2" onClick={() => navigate('/invoices')}>
                <td className="px-5 py-2"><p className="font-medium">{L.partyMap.get(x.invoice.client_id)?.name}</p><p className="text-xs text-muted">{x.invoice.number}</p></td>
                <td className={cn('px-3 py-2', x.invoice.due_date && x.invoice.due_date < asOf && 'text-negative')}>{formatDate(x.invoice.due_date)}</td>
                <td className="px-5 py-2 text-right tabular">{formatMoney(x.outstanding, x.invoice.currency)}</td>
              </tr>
            ))}
            {open.length === 0 && <tr><td className="px-5 py-6 text-center text-muted">Nothing outstanding.</td></tr>}
          </tbody>
        </table>
      </Card>
      <Card title="Owed by AptoCAD (bills)" description="Open supplier bills." padded={false}>
        <Buckets buckets={bills.aged.buckets} total={bills.aged.totalLkr} />
        <table className="w-full border-t border-line text-[13px]">
          <tbody>
            {bills.open.map((b) => (
              <tr key={b.id} className="cursor-pointer border-b border-line hover:bg-surface-2" onClick={() => navigate('/bills')}>
                <td className="px-5 py-2"><p className="font-medium">{L.partyMap.get(b.vendor_id ?? '')?.name ?? b.description}</p><p className="text-xs text-muted">{b.reference ?? b.description}</p></td>
                <td className={cn('px-3 py-2', b.due_date && b.due_date < asOf && 'text-negative')}>{formatDate(b.due_date)}</td>
                <td className="px-5 py-2 text-right tabular">{formatMoney(b.amount_minor - (paidBills.get(b.id) ?? 0), b.currency)}</td>
              </tr>
            ))}
            {bills.open.length === 0 && <tr><td className="px-5 py-6 text-center text-muted">No open bills.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Tax monitor

function TaxReport() {
  const { L, rows, ctx } = useReportData();
  const t = useMemo(() => (L.settings ? taxMonitor(rows, ctx, L.settings, today()) : null), [rows, ctx, L.settings]);
  if (!t || !L.settings) return <Spinner />;
  const s = L.settings.tax;
  const Meter = ({ label, value, limit }: { label: string; value: number; limit: number | undefined }) => {
    const pct = limit ? value / limit : 0;
    return (
      <div>
        <div className="flex justify-between text-[13px]"><span className="text-ink-2">{label}</span><span className="tabular">{formatMoney(value, 'LKR', { compact: true })} / {limit ? formatMoney(limit, 'LKR', { compact: true }) : '—'}</span></div>
        <div className="mt-1.5 h-2 rounded-full bg-surface-3"><div className={cn('h-2 rounded-full', pct >= 1 ? 'bg-[var(--status-critical)]' : pct >= 0.8 ? 'bg-[var(--status-warning)]' : 'bg-[var(--status-good)]')} style={{ width: `${Math.min(100, pct * 100)}%` }} /></div>
      </div>
    );
  };
  return (
    <div className="space-y-5">
      <Callout tone="caution" icon={<AlertTriangle />} title="Estimates for planning only">Rates and thresholds come from Settings → Payroll &amp; tax and must be confirmed with your accountant. Management figures are on a cash basis; your tax return is prepared on the accountant&apos;s basis.</Callout>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Income tax provision" description={`${t.fyLabel} to date`}>
          <p className="text-3xl font-semibold tabular">{formatMoney(t.incomeTaxProvision, 'LKR', { compact: true })}</p>
          <p className="mt-1 text-[13px] text-ink-2">{s.income_tax_pct}% of operating profit {formatMoney(t.fyOperatingProfit, 'LKR', { whole: true })}</p>
          <p className="mt-3 text-xs text-muted">Service-export income received in foreign currency and remitted through a Sri Lankan bank is taxed at 15% (from 1 April 2025). Keep bank credit advices for foreign receipts as evidence.</p>
        </Card>
        <Card title="Social Security Contribution Levy (SSCL)" description={`${s.sscl_pct}% of turnover once registered`}>
          <div className="space-y-4">
            <Meter label={`This quarter (${formatDate(t.quarter.from)} –)`} value={t.quarterTurnover} limit={t.sscl.threshold?.quarterly_minor} />
            <Meter label="Last 12 months" value={t.rolling12Turnover} limit={t.sscl.threshold?.annual_minor} />
            {(t.sscl.quarterExceeded || t.sscl.annualExceeded) ? <Badge tone="negative">Threshold exceeded — talk to your accountant about registration</Badge> : <Badge tone="positive">Below the registration threshold</Badge>}
            <p className="text-xs text-muted">Threshold in force: {t.sscl.threshold ? `${formatMoney(t.sscl.threshold.quarterly_minor, 'LKR', { compact: true })} per quarter / ${formatMoney(t.sscl.threshold.annual_minor, 'LKR', { compact: true })} per year (from ${formatDate(t.sscl.threshold.effective_from)})` : 'not set'}. If registered, this quarter&apos;s SSCL would be about {formatMoney(t.sscl.estimateOnQuarter, 'LKR', { whole: true })}.</p>
          </div>
        </Card>
        <Card title="VAT registration" description={`${s.vat_pct}% standard rate`}>
          <div className="space-y-4">
            <Meter label="This quarter" value={t.quarterTurnover} limit={t.vat.threshold?.quarterly_minor} />
            <Meter label="Last 12 months" value={t.rolling12Turnover} limit={t.vat.threshold?.annual_minor} />
            {(t.vat.quarterExceeded || t.vat.annualExceeded) ? <Badge tone="negative">Threshold exceeded — check VAT registration</Badge> : <Badge tone="positive">Below the registration threshold</Badge>}
            <p className="text-xs text-muted">Exports of services may be zero-rated or exempt; confirm treatment with your accountant.</p>
          </div>
        </Card>
      </div>
      <Callout tone="info" icon={<Info />}>Turnover here is client revenue recorded in the app (cleared), converted to LKR at the rates used when it was received.</Callout>
    </div>
  );
}

// ---------------------------------------------------------------- Accountant's pack

function AccountantPack() {
  const { L, rows, ctx } = useReportData();
  const { fy, start, picker, label, range } = useFyPicker();
  const entries = useTable('entries');
  const payslips = useTable('payslips');
  const runs = useTable('payroll_runs');
  const invoices = useTable('invoices');
  const bills = useTable('bills');
  const [busy, setBusy] = useState(false);
  const build = async () => {
    setBusy(true);
    try {
      const months = fiscalMonths(fy, start);
      const summary = monthlySummary(rows, ctx, months);
      const operating = L.departments.filter((d) => d.is_operating);
      const pl = profitAndLoss(rows, ctx, { range }, L.settings!.allocation);
      const tb = trialBalance(rows, L.accountMap, range);
      const inRange = rows.filter((r) => r.date >= range.from && r.date <= range.to);
      const periodEntries = (entries.data ?? []).filter((e) => e.date >= range.from && e.date <= range.to);
      const runMap = new Map((runs.data ?? []).map((r) => [r.id, r]));
      const sheets: SheetSpec[] = [
        { name: 'Read me', columns: [{ header: 'AptoCAD Finance — accountant pack', key: 'a', width: 110 }], rows: [
          { a: `Company: ${L.settings!.company_name}` },
          { a: `Period: ${label} (${range.from} to ${range.to})` },
          { a: `Generated: ${new Date().toLocaleString()}` },
          { a: 'Basis: management accounts on a cash basis. Income is recognised when received; costs when paid. Pending and voided entries are excluded.' },
          { a: 'Every entry is double-entry: see "General ledger" (debits positive, credits negative, LKR). The trial balance carries earlier profit in "Retained profit brought forward".' },
          { a: 'Foreign currency: each line keeps its currency amount and the rate used. Transfers out of foreign accounts use the average carrying rate; differences are booked to "Exchange Gain / Loss".' },
          { a: 'Payroll: gross salary and employer EPF 12% / ETF 3% are costs on the pay date; EPF, ETF and APIT are liabilities until paid.' },
        ] },
        { name: 'Trial balance', title: 'Trial balance', subtitle: `${range.from} to ${range.to}`, columns: [{ header: 'Account', key: 'a', width: 46 }, { header: 'Debit', key: 'd', type: 'money' }, { header: 'Credit', key: 'c', type: 'money' }], rows: tb.lines.map((l) => ({ a: l.label, d: xl(l.debit) || null, c: xl(l.credit) || null })), totals: { a: 'Total', d: xl(tb.totalDebit), c: xl(tb.totalCredit) } },
        { name: 'P&L by department', title: 'Profit & loss by department', columns: [{ header: 'Line', key: 'line', width: 44 }, ...L.departments.map((d) => ({ header: d.name, key: d.code, type: 'money' as const })), { header: 'Company', key: 'total', type: 'money' as const }], rows: pl.sections.flatMap((s) => s.lines.map((l) => ({ line: `${s.label} — ${l.account.name}`, ...Object.fromEntries(L.departments.map((d) => [d.code, xl(l.byDept[d.id] ?? 0)])), total: xl(l.total) }))), totals: { line: 'Operating profit', ...Object.fromEntries(L.departments.map((d) => [d.code, xl(pl.figures.byDept[d.id]?.operatingProfit ?? 0)])), total: xl(pl.figures.operatingProfit) } },
        { name: 'Monthly summary', columns: [{ header: 'Month', key: 'm', width: 12 }, ...operating.flatMap((d) => [{ header: `${d.name} revenue`, key: `${d.code}r`, type: 'money' as const }, { header: `${d.name} expenses`, key: `${d.code}e`, type: 'money' as const }, { header: `${d.name} payroll`, key: `${d.code}p`, type: 'money' as const }, { header: `${d.name} profit`, key: `${d.code}o`, type: 'money' as const }]), { header: 'Shared cost', key: 'corp', type: 'money' }, { header: 'Company profit', key: 'op', type: 'money' }], rows: summary.months.map((m) => ({ m: monthLabel(m.month), ...Object.fromEntries(operating.flatMap((d) => { const f = m.figures.byDept[d.id]; return [[`${d.code}r`, xl(f?.revenue)], [`${d.code}e`, xl(f?.expenses)], [`${d.code}p`, xl(f?.payroll)], [`${d.code}o`, xl(f?.operatingProfit)]]; })), corp: xl(m.figures.corporateCost), op: xl(m.figures.operatingProfit) })) },
        { name: 'General ledger', columns: [{ header: 'Date', key: 'date', type: 'date' }, { header: 'Entry', key: 'no', width: 16 }, { header: 'Type', key: 'kind', width: 12 }, { header: 'Status', key: 'status', width: 9 }, { header: 'Description', key: 'desc', width: 40 }, { header: 'Account code', key: 'code', width: 10 }, { header: 'Account', key: 'acc', width: 32 }, { header: 'Department', key: 'dept', width: 16 }, { header: 'Project', key: 'proj', width: 12 }, { header: 'Currency', key: 'ccy', width: 8 }, { header: 'Amount', key: 'amt', type: 'money' }, { header: 'Rate', key: 'rate', type: 'rate', width: 10 }, { header: 'LKR (Dr+/Cr−)', key: 'lkr', type: 'money' }, { header: 'Reconciled', key: 'rec', width: 10 }], rows: inRange.map((r) => ({ date: r.date, no: r.entry_number, kind: KIND_LABELS[r.kind], status: r.status, desc: r.entry_description, code: L.accountMap.get(r.account_id)?.code, acc: L.accountMap.get(r.account_id)?.name, dept: L.deptMap.get(r.department_id)?.name, proj: L.projectMap.get(r.project_id ?? '')?.code ?? '', ccy: r.currency, amt: xl(r.amount_minor), rate: Number(r.fx_rate), lkr: xl(r.amount_lkr_minor), rec: r.reconciled ? 'Yes' : '' })) },
        { name: 'Entries', columns: [{ header: 'Date', key: 'date', type: 'date' }, { header: 'Number', key: 'no', width: 16 }, { header: 'Type', key: 'kind', width: 12 }, { header: 'Status', key: 'status', width: 9 }, { header: 'Department', key: 'dept', width: 16 }, { header: 'Description', key: 'desc', width: 44 }, { header: 'Contact', key: 'party', width: 26 }, { header: 'Reference', key: 'ref', width: 18 }, { header: 'Void reason', key: 'void', width: 24 }], rows: periodEntries.map((e) => ({ date: e.date, no: e.number, kind: KIND_LABELS[e.kind], status: e.status, dept: L.deptMap.get(e.department_id)?.name, desc: e.description, party: L.partyMap.get(e.party_id ?? '')?.name ?? '', ref: e.reference ?? '', void: e.void_reason ?? '' })) },
        { name: 'Payroll register', columns: [{ header: 'Pay date', key: 'date', type: 'date' }, { header: 'Employee', key: 'name', width: 26 }, { header: 'EPF No.', key: 'epf', width: 12 }, { header: 'Department', key: 'dept', width: 16 }, { header: 'Gross', key: 'gross', type: 'money' }, { header: 'EPF 8%', key: 'ee', type: 'money' }, { header: 'APIT', key: 'apit', type: 'money' }, { header: 'Other ded.', key: 'oth', type: 'money' }, { header: 'Net', key: 'net', type: 'money' }, { header: 'EPF 12%', key: 'er', type: 'money' }, { header: 'ETF 3%', key: 'etf', type: 'money' }], rows: (payslips.data ?? []).filter((p) => { const r = runMap.get(p.run_id); return r && r.pay_date >= range.from && r.pay_date <= range.to; }).map((p) => ({ date: runMap.get(p.run_id)!.pay_date, name: L.partyMap.get(p.employee_id)?.name, epf: L.partyMap.get(p.employee_id)?.epf_number ?? '', dept: L.deptMap.get(p.department_id)?.name, gross: xl(p.gross_minor), ee: xl(p.employee_epf_minor), apit: xl(p.apit_minor), oth: xl(p.other_deductions_minor), net: xl(p.net_minor), er: xl(p.employer_epf_minor), etf: xl(p.etf_minor) })) },
        { name: 'Invoices', columns: [{ header: 'Number', key: 'no', width: 16 }, { header: 'Date', key: 'date', type: 'date' }, { header: 'Due', key: 'due', type: 'date' }, { header: 'Client', key: 'client', width: 28 }, { header: 'Status', key: 'status', width: 10 }, { header: 'Currency', key: 'ccy', width: 8 }, { header: 'Total', key: 'total', type: 'money' }], rows: (invoices.data ?? []).filter((i) => i.kind === 'invoice').map((i) => ({ no: i.number, date: i.issue_date, due: i.due_date, client: L.partyMap.get(i.client_id)?.name, status: i.status, ccy: i.currency, total: xl(i.total_minor) })) },
        { name: 'Bills', columns: [{ header: 'Date', key: 'date', type: 'date' }, { header: 'Due', key: 'due', type: 'date' }, { header: 'Supplier', key: 'vendor', width: 28 }, { header: 'Description', key: 'desc', width: 36 }, { header: 'Status', key: 'status', width: 10 }, { header: 'Currency', key: 'ccy', width: 8 }, { header: 'Amount', key: 'amt', type: 'money' }], rows: (bills.data ?? []).map((b) => ({ date: b.bill_date, due: b.due_date, vendor: L.partyMap.get(b.vendor_id ?? '')?.name ?? '', desc: b.description, status: b.status, ccy: b.currency, amt: xl(b.amount_minor) })) },
      ];
      await exportWorkbook(`AptoCAD-accountant-pack-${label.replace(/\W+/g, '-')}.xlsx`, sheets);
      toast.success('Accountant pack saved');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const tb = useMemo(() => trialBalance(rows, L.accountMap, range), [rows, L.accountMap, range]);
  const figures = useMemo(() => figuresFor(countableRows(rows, { range }), ctx), [rows, ctx, range]);
  return (
    <Card title="Accountant's pack" description="One Excel workbook for the year-end: read-me, trial balance, P&L by department, monthly summary, general ledger, entries, payroll register, invoices and bills." action={picker}>
      <div className="grid grid-cols-3 gap-4 text-[13px]">
        <div className="rounded-lg bg-surface-2 p-4"><p className="text-ink-2">Revenue</p><p className="mt-1 text-lg font-semibold tabular">{formatMoney(figures.revenue)}</p></div>
        <div className="rounded-lg bg-surface-2 p-4"><p className="text-ink-2">Operating profit</p><p className="mt-1 text-lg font-semibold tabular">{formatMoney(figures.operatingProfit)}</p></div>
        <div className="rounded-lg bg-surface-2 p-4"><p className="text-ink-2">Trial balance</p><p className={cn('mt-1 text-lg font-semibold', tb.totalDebit === tb.totalCredit ? 'text-positive' : 'text-negative')}>{tb.totalDebit === tb.totalCredit ? 'Balances ✓' : 'Does not balance'}</p></div>
      </div>
      <Button variant="primary" size="lg" className="mt-5" loading={busy} onClick={() => void build()}>
        <Package /> Download accountant pack ({label})
      </Button>
      <p className="mt-3 text-xs text-muted">Lock the year first (Settings → Month lock) so the figures cannot change after you send them.</p>
    </Card>
  );
}
