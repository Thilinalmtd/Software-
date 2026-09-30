import { ArrowLeft, CheckCheck, FileSpreadsheet } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Checkbox } from '@/components/ui/form';
import { Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { formatMoney, formatRate } from '@/domain/money';
import { formatDate } from '@/domain/period';
import type { LedgerRow } from '@/domain/types';
import { useAppData } from '@/data/context';
import { useLedger, useLookups, useReconcile } from '@/data/hooks';
import { canWriteDepartment } from '@/data/permissions';
import { exportWorkbook, xl } from '@/lib/excel';
import { errorMessage } from '@/lib/cn';
import { usePeriod } from '@/app/ui-state';
import { Amount, KindBadge, StatusBadge } from '../shared/bits';

interface Row extends LedgerRow {
  running: number;
}

export default function AccountDetail() {
  const { id } = useParams();
  const L = useLookups();
  const ledger = useLedger();
  const { member } = useAppData();
  const navigate = useNavigate();
  const reconcile = useReconcile();
  const { range, label } = usePeriod();
  const account = L.accountMap.get(id ?? '');
  const rows: Row[] = useMemo(() => {
    const list = (ledger.data ?? []).filter((r) => r.account_id === id && r.status !== 'void').sort((a, b) => a.date.localeCompare(b.date) || a.entry_number.localeCompare(b.entry_number));
    let running = 0;
    return list.map((r) => {
      if (r.status === 'cleared') running += r.amount_minor;
      return { ...r, running };
    });
  }, [ledger.data, id]);
  if (L.loading || ledger.isLoading) return <Spinner />;
  if (!account) return <EmptyState title="Account not found" />;
  const ccy = account.currency ?? 'LKR';
  const opening = rows.filter((r) => r.date < range.from && r.status === 'cleared').reduce((s, r) => s + r.amount_minor, 0);
  const inPeriod = rows.filter((r) => r.date >= range.from && r.date <= range.to);
  const canRec = canWriteDepartment(member, account.department_id, L.departments) && member?.role !== 'viewer';

  const columns: Column<Row>[] = [
    ...(canRec
      ? [{ key: 'rec', header: <span title="Reconciled">✓</span>, width: '40px', cell: (r: Row) => <span onClick={(e) => e.stopPropagation()}><Checkbox aria-label="Reconciled" checked={r.reconciled} onCheckedChange={(v) => reconcile.mutateAsync({ lineIds: [r.id], reconciled: v }).catch((e) => toast.error(errorMessage(e)))} /></span> } as Column<Row>]
      : []),
    { key: 'date', header: 'Date', cell: (r) => <span className="tabular text-ink-2">{formatDate(r.date)}</span>, width: '110px' },
    { key: 'desc', header: 'Description', cell: (r) => (<div><p className="text-ink">{r.entry_description}</p><p className="text-xs text-muted">{r.entry_number}</p></div>) },
    { key: 'kind', header: 'Type', cell: (r) => <KindBadge kind={r.kind} /> },
    { key: 'status', header: '', cell: (r) => (r.status !== 'cleared' ? <StatusBadge status={r.status} /> : null) },
    { key: 'amount', header: `Amount (${ccy})`, align: 'right', cell: (r) => <Amount minor={r.amount_minor} currency={ccy} plain /> },
    ...(ccy !== 'LKR' ? [{ key: 'rate', header: 'Rate', align: 'right', cell: (r: Row) => <span className="text-ink-2">{formatRate(r.fx_rate)}</span> } as Column<Row>] : []),
    { key: 'running', header: 'Balance', align: 'right', cell: (r) => <span className={r.running < 0 ? 'text-negative' : 'text-ink'}>{formatMoney(r.running, ccy, { plain: true })}</span> },
  ];

  return (
    <>
      <PageHeader
        title={account.name}
        description={`${L.deptMap.get(account.department_id ?? '')?.name} · ${ccy} · ${label}`}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate('/accounts')}><ArrowLeft /> Accounts</Button>
            <Button onClick={() => void exportWorkbook(`${account.name}-${range.from}.xlsx`, [{ name: 'Transactions', title: account.name, subtitle: `${range.from} to ${range.to}`, columns: [{ header: 'Date', key: 'date', type: 'date' }, { header: 'Number', key: 'number' }, { header: 'Description', key: 'desc', width: 40 }, { header: `Amount ${ccy}`, key: 'amount', type: 'money' }, { header: 'Balance', key: 'balance', type: 'money' }, { header: 'Reconciled', key: 'rec', width: 10 }], rows: inPeriod.map((r) => ({ date: r.date, number: r.entry_number, desc: r.entry_description, amount: xl(r.amount_minor), balance: xl(r.running), rec: r.reconciled ? 'Yes' : '' })) }])}>
              <FileSpreadsheet /> Export
            </Button>
            {canRec && <Button variant="primary" onClick={() => navigate(`/reconcile/${account.id}`)}><CheckCheck /> Reconcile with statement</Button>}
          </>
        }
      />
      <Card padded={false}>
        <div className="flex gap-8 border-b border-line px-5 py-3 text-[13px]">
          <span className="text-ink-2">Opening <span className="font-semibold text-ink tabular">{formatMoney(opening, ccy)}</span></span>
          <span className="text-ink-2">In <span className="font-semibold text-positive tabular">{formatMoney(inPeriod.filter((r) => r.amount_minor > 0 && r.status === 'cleared').reduce((s, r) => s + r.amount_minor, 0), ccy)}</span></span>
          <span className="text-ink-2">Out <span className="font-semibold text-ink tabular">{formatMoney(-inPeriod.filter((r) => r.amount_minor < 0 && r.status === 'cleared').reduce((s, r) => s + r.amount_minor, 0), ccy)}</span></span>
          <span className="ml-auto text-ink-2">Closing <span className="font-semibold text-ink tabular">{formatMoney(opening + inPeriod.filter((r) => r.status === 'cleared').reduce((s, r) => s + r.amount_minor, 0), ccy)}</span></span>
        </div>
        <DataTable rows={[...inPeriod].reverse()} columns={columns} rowKey={(r) => r.id} onRowClick={(r) => navigate(`/entries?id=${r.entry_id}`)} empty={<EmptyState title="No transactions in this period" />} />
      </Card>
    </>
  );
}
