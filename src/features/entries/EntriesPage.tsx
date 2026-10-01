import { FileSpreadsheet, Paperclip, Search, ArrowLeftRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Input, Select } from '@/components/ui/form';
import { Badge, Card, EmptyState, PageHeader, Spinner, Tabs } from '@/components/ui/misc';
import { formatMoney } from '@/domain/money';
import { formatDate, monthEnd } from '@/domain/period';
import type { Entry, EntryKind, LedgerRow } from '@/domain/types';
import { useEntries, useLedger, useLookups, useTable } from '@/data/hooks';
import { exportWorkbook, xl } from '@/lib/excel';
import { usePeriod, useUi } from '@/app/ui-state';
import { Amount, DeptTag, KindBadge, KIND_LABELS, StatusBadge } from '../shared/bits';
import { moneyAccountOptions, projectOptions } from '../shared/options';
import { EntryDetail } from './EntryDetail';

export interface EntryRow {
  entry: Entry;
  money: LedgerRow[];
  /** Signed amount of the main money movement, in its currency */
  amount: number;
  currency: string;
  lkr: number;
  accountLabel: string;
  attachments: number;
  lines: LedgerRow[];
}

type KindTab = 'all' | 'income' | 'expense' | 'transfer' | 'payroll' | 'other';

export function buildEntryRows(entries: Entry[], ledger: LedgerRow[], accountName: (id: string) => string, attachmentCount: Map<string, number>): EntryRow[] {
  const byEntry = new Map<string, LedgerRow[]>();
  for (const r of ledger) {
    let list = byEntry.get(r.entry_id);
    if (!list) byEntry.set(r.entry_id, (list = []));
    list.push(r);
  }
  return entries.map((e) => {
    const lines = byEntry.get(e.id) ?? [];
    const money = lines.filter((l) => l.role === 'money');
    let main = money[0];
    if (e.kind === 'transfer') main = money.find((m) => m.amount_minor < 0) ?? main;
    const accountLabel = e.kind === 'transfer' && money.length === 2 ? `${accountName(money.find((m) => m.amount_minor < 0)?.account_id ?? '')} → ${accountName(money.find((m) => m.amount_minor > 0)?.account_id ?? '')}` : money.map((m) => accountName(m.account_id)).join(', ');
    const adjLkr = lines.filter((l) => l.amount_lkr_minor > 0).reduce((s, l) => s + l.amount_lkr_minor, 0);
    return {
      entry: e,
      money,
      lines,
      amount: main ? (e.kind === 'transfer' ? -main.amount_minor : main.amount_minor) : adjLkr,
      currency: main?.currency ?? 'LKR',
      lkr: main ? (e.kind === 'transfer' ? -main.amount_lkr_minor : main.amount_lkr_minor) : adjLkr,
      accountLabel: accountLabel || '—',
      attachments: attachmentCount.get(e.id) ?? 0,
    };
  });
}

export default function EntriesPage() {
  const [params, setParams] = useSearchParams();
  const L = useLookups();
  const entries = useEntries();
  const ledger = useLedger();
  const attachments = useTable('attachments');
  const { dept } = useUi();
  const { range: periodRange, label: periodLabel } = usePeriod();
  const [search, setSearch] = useState('');
  const kind = (params.get('kind') as KindTab) ?? 'all';
  const status = params.get('status') ?? 'active';
  const accountId = params.get('account');
  const projectId = params.get('project');
  const month = params.get('month');
  const special = params.get('filter');
  const openId = params.get('id');
  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const range = month ? { from: `${month}-01`, to: monthEnd(`${month}-01`) } : periodRange;
  const attachmentCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of attachments.data ?? []) if (a.entry_id) m.set(a.entry_id, (m.get(a.entry_id) ?? 0) + 1);
    return m;
  }, [attachments.data]);
  const all = useMemo(() => buildEntryRows(entries.data ?? [], ledger.data ?? [], (id) => L.accountMap.get(id)?.name ?? '?', attachmentCount), [entries.data, ledger.data, L.accountMap, attachmentCount]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((r) => {
      const e = r.entry;
      if (!special && (e.date < range.from || e.date > range.to)) return false;
      if (dept !== 'all' && e.department_id !== dept && !r.lines.some((l) => l.department_id === dept)) return false;
      if (kind !== 'all') {
        const k: Record<KindTab, EntryKind[]> = { all: [], income: ['income'], expense: ['expense'], transfer: ['transfer'], payroll: ['payroll', 'statutory_payment'], other: ['opening_balance', 'adjustment'] };
        if (!k[kind].includes(e.kind)) return false;
      }
      if (status === 'active' && e.status === 'void') return false;
      if (status !== 'active' && status !== 'all' && e.status !== status) return false;
      if (accountId && !r.lines.some((l) => l.account_id === accountId)) return false;
      if (projectId && e.project_id !== projectId && !r.lines.some((l) => l.project_id === projectId)) return false;
      if (special === 'missing-receipt' && (e.kind !== 'expense' || r.attachments > 0 || e.status === 'void' || -r.lkr < (L.settings?.attention.receipt_required_above_minor ?? 0))) return false;
      if (special === 'direct-no-project' && !r.lines.some((l) => !l.project_id && L.accountMap.get(l.account_id)?.category_group === 'direct_cost')) return false;
      if (q) {
        const hay = `${e.number} ${e.description} ${e.reference ?? ''} ${L.partyMap.get(e.party_id ?? '')?.name ?? ''} ${r.accountLabel} ${L.projectMap.get(e.project_id ?? '')?.name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [all, search, range.from, range.to, dept, kind, status, accountId, projectId, special, L]);

  const counted = rows.filter((r) => r.entry.status === 'cleared');
  const moneyIn = counted.filter((r) => r.entry.kind === 'income').reduce((s, r) => s + r.lkr, 0);
  const moneyOut = counted.filter((r) => ['expense', 'payroll', 'statutory_payment'].includes(r.entry.kind)).reduce((s, r) => s - r.lkr, 0);

  const columns: Column<EntryRow>[] = [
    { key: 'date', header: 'Date', cell: (r) => <span className="tabular whitespace-nowrap text-ink-2">{formatDate(r.entry.date)}</span>, sort: (r) => r.entry.date + r.entry.number, width: '112px' },
    {
      key: 'desc',
      header: 'Description',
      cell: (r) => (
        <div className="max-w-[380px] min-w-0">
          <p title={r.entry.description} className={r.entry.status === 'void' ? 'truncate text-muted line-through' : 'truncate text-ink'}>{r.entry.description}</p>
          <p className="truncate text-xs text-muted">
            {r.entry.number}
            {r.entry.party_id && ` · ${L.partyMap.get(r.entry.party_id)?.name ?? ''}`}
            {r.entry.project_id && ` · ${L.projectMap.get(r.entry.project_id)?.code ?? ''}`}
          </p>
        </div>
      ),
      sort: (r) => r.entry.description.toLowerCase(),
    },
    { key: 'kind', header: 'Type', cell: (r) => <KindBadge kind={r.entry.kind} cross={!!(r.entry.meta as { cross_department?: boolean }).cross_department} />, sort: (r) => r.entry.kind },
    { key: 'dept', header: 'Department', cell: (r) => <DeptTag dept={L.deptMap.get(r.entry.department_id)} />, sort: (r) => L.deptMap.get(r.entry.department_id)?.sort_order ?? 0 },
    { key: 'account', header: 'Account', cell: (r) => <span title={r.accountLabel} className="block max-w-[240px] truncate text-ink-2">{r.accountLabel}</span>, sort: (r) => r.accountLabel },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (r) => (r.entry.kind === 'transfer' ? <span className="inline-flex items-center gap-1 text-ink-2 tabular"><ArrowLeftRight className="size-3.5" />{formatMoney(r.amount, r.currency)}</span> : <Amount minor={r.amount} currency={r.currency} className={r.entry.status === 'void' ? 'text-muted line-through' : undefined} />),
      sort: (r) => r.lkr,
    },
    { key: 'lkr', header: 'LKR', align: 'right', cell: (r) => <span className="text-ink-2">{r.currency === 'LKR' ? '' : formatMoney(r.lkr, 'LKR', { plain: true })}</span>, sort: (r) => r.lkr },
    {
      key: 'status',
      header: '',
      align: 'right',
      cell: (r) => (
        <span className="inline-flex items-center justify-end gap-2">
          {r.attachments > 0 && <Paperclip className="size-3.5 text-muted" aria-label={`${r.attachments} attachment(s)`} />}
          {r.entry.status !== 'cleared' && <StatusBadge status={r.entry.status} />}
        </span>
      ),
      width: '100px',
    },
  ];

  const exportRows = async () => {
    await exportWorkbook(`entries-${range.from}-to-${range.to}.xlsx`, [
      {
        name: 'Entries',
        title: 'AptoCAD Finance — entries',
        subtitle: `${formatDate(range.from)} – ${formatDate(range.to)}`,
        columns: [
          { header: 'Date', key: 'date', type: 'date' },
          { header: 'Number', key: 'number', width: 16 },
          { header: 'Type', key: 'type', width: 12 },
          { header: 'Status', key: 'status', width: 10 },
          { header: 'Department', key: 'dept', width: 18 },
          { header: 'Description', key: 'description', width: 40 },
          { header: 'Contact', key: 'party', width: 24 },
          { header: 'Project', key: 'project', width: 14 },
          { header: 'Account', key: 'account', width: 30 },
          { header: 'Currency', key: 'currency', width: 9 },
          { header: 'Amount', key: 'amount', type: 'money' },
          { header: 'Amount LKR', key: 'lkr', type: 'money' },
          { header: 'Reference', key: 'reference', width: 18 },
        ],
        rows: rows.map((r) => ({ date: r.entry.date, number: r.entry.number, type: KIND_LABELS[r.entry.kind], status: r.entry.status, dept: L.deptMap.get(r.entry.department_id)?.name, description: r.entry.description, party: L.partyMap.get(r.entry.party_id ?? '')?.name ?? '', project: L.projectMap.get(r.entry.project_id ?? '')?.code ?? '', account: r.accountLabel, currency: r.currency, amount: xl(r.amount), lkr: xl(r.lkr), reference: r.entry.reference ?? '' })),
      },
    ]);
  };

  const kinds: { value: KindTab; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'income', label: 'Money in' },
    { value: 'expense', label: 'Money out' },
    { value: 'transfer', label: 'Transfers' },
    { value: 'payroll', label: 'Payroll & statutory' },
    { value: 'other', label: 'Opening & adjustments' },
  ];

  return (
    <>
      <PageHeader
        title="Entries"
        description={special ? 'Filtered from the dashboard' : month ? `Month of ${month}` : periodLabel}
        actions={
          <Button onClick={() => void exportRows()} disabled={!rows.length}>
            <FileSpreadsheet /> Export to Excel
          </Button>
        }
      />
      <Card padded={false}>
        <div className="px-5 pt-2">
          <Tabs value={kind} onChange={(v) => setParam('kind', v === 'all' ? null : v)} tabs={kinds} listClassName="border-b-0" />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-y border-line bg-surface-2 px-5 py-3">
          <div className="relative w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input aria-label="Search entries" className="pl-9" placeholder="Search description, number, contact…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select aria-label="Status" className="w-40" value={status} onChange={(e) => setParam('status', e.target.value === 'active' ? null : e.target.value)} options={[{ value: 'active', label: 'Not voided' }, { value: 'cleared', label: 'Cleared' }, { value: 'pending', label: 'Pending' }, { value: 'void', label: 'Voided' }, { value: 'all', label: 'All statuses' }]} />
          <div className="w-64">
            <Combobox aria-label="Account filter" options={moneyAccountOptions(L.accounts, L.departments)} value={accountId} onChange={(v) => setParam('account', v)} allowClear placeholder="All accounts" />
          </div>
          <div className="w-64">
            <Combobox aria-label="Project filter" options={projectOptions(L.projects, null, true)} value={projectId} onChange={(v) => setParam('project', v)} allowClear placeholder="All projects" />
          </div>
          {(month || special) && (
            <Badge tone="info" className="h-8 gap-2">
              {month ? `Month ${month}` : special === 'missing-receipt' ? 'Missing receipts' : 'Direct costs without project'}
              <button type="button" className="cursor-pointer" aria-label="Clear filter" onClick={() => { const n = new URLSearchParams(params); n.delete('month'); n.delete('filter'); setParams(n, { replace: true }); }}>✕</button>
            </Badge>
          )}
          <span className="ml-auto text-xs text-muted">{rows.length.toLocaleString()} entries</span>
        </div>
        {entries.isLoading || ledger.isLoading ? (
          <Spinner />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.entry.id}
            initialSort={{ key: 'date', desc: true }}
            onRowClick={(r) => setParam('id', r.entry.id)}
            empty={<EmptyState title="No entries match" body="Change the period at the top, or clear the filters." />}
            footer={
              <tr>
                <td className="px-5 py-2.5 text-[13px]" colSpan={5}>
                  Cleared totals in view
                </td>
                <td className="px-3 py-2.5 text-right text-[13px] tabular" colSpan={3}>
                  <span className="text-positive">In {formatMoney(moneyIn)}</span> · <span>Out {formatMoney(moneyOut)}</span>
                </td>
              </tr>
            }
          />
        )}
      </Card>
      {openId && <EntryDetail id={openId} onClose={() => setParam('id', null)} />}
    </>
  );
}
