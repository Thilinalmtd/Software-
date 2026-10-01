import { useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, HandCoins, Pencil, Plus, Receipt } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { DataTable } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, MoneyInput, Select } from '@/components/ui/form';
import { Badge, Card, EmptyState, Menu, PageHeader, Spinner, Tabs } from '@/components/ui/misc';
import { formatMoney } from '@/domain/money';
import { addDays, daysBetween, formatDate, today } from '@/domain/period';
import { AGE_BUCKET_LABELS, type AgeBucket } from '@/domain/reports';
import type { Bill } from '@/domain/types';
import { useAppData, useRepo } from '@/data/context';
import { useLookups, useTable } from '@/data/hooks';
import { canRecord, canWriteDepartment } from '@/data/permissions';
import { errorMessage } from '@/lib/cn';
import { useUi } from '@/app/ui-state';
import { DeptTag } from '../shared/bits';
import { categoryOptions, partyOptions, projectOptions } from '../shared/options';
import { useBillsDue } from '../shared/useFinance';

export default function BillsPage() {
  const L = useLookups();
  const repo = useRepo();
  const qc = useQueryClient();
  const { member } = useAppData();
  const { dept, openQuickAdd } = useUi();
  const bills = useTable('bills', { order: { column: 'due_date' } });
  const due = useBillsDue();
  const [tab, setTab] = useState<'open' | 'all'>('open');
  const [editing, setEditing] = useState<Bill | 'new' | null>(null);
  if (L.loading || bills.isLoading) return <Spinner />;
  const asOf = today();
  const list = (bills.data ?? []).filter((b) => (tab === 'all' || b.status === 'open') && (dept === 'all' || b.department_id === dept));
  const refresh = () => qc.invalidateQueries({ queryKey: ['bills'] });
  const pay = (b: Bill) =>
    openQuickAdd({
      tab: 'expense',
      prefill: { partyId: b.vendor_id, departmentId: b.department_id, projectId: b.project_id, billId: b.id, reference: b.reference ?? '', description: b.description, categoryTouched: true, splits: [{ key: crypto.randomUUID(), accountId: b.account_id, amountMinor: b.amount_minor, projectId: b.project_id }] },
    });
  return (
    <>
      <PageHeader title="Bills to pay" description="Supplier bills and their due dates. A bill becomes a cost when you pay it." actions={canRecord(member) && <Button variant="primary" onClick={() => setEditing('new')}><Plus /> Add bill</Button>} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-6">
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-xs text-ink-2">To pay (LKR)</p>
          <p className="mt-1 text-lg font-semibold tabular">{formatMoney(due.aged.totalLkr, 'LKR', { compact: true })}</p>
        </div>
        {(Object.keys(AGE_BUCKET_LABELS) as AgeBucket[]).map((b) => (
          <div key={b} className="rounded-xl border border-line bg-surface px-4 py-3">
            <p className="text-xs text-ink-2">{b === 'not_due' ? 'Not yet due' : `Overdue ${AGE_BUCKET_LABELS[b]}`}</p>
            <p className={`mt-1 text-lg font-semibold tabular ${b !== 'not_due' && due.aged.buckets[b] > 0 ? 'text-negative' : ''}`}>{formatMoney(due.aged.buckets[b], 'LKR', { compact: true })}</p>
          </div>
        ))}
      </div>
      <Card padded={false}>
        <div className="px-5 pt-2">
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'open', label: 'Open', count: (bills.data ?? []).filter((b) => b.status === 'open').length }, { value: 'all', label: 'All' }]} listClassName="border-b-0" />
        </div>
        <div className="border-t border-line">
          <DataTable<Bill>
            rows={list}
            rowKey={(b) => b.id}
            onRowClick={(b) => canWriteDepartment(member, b.department_id, L.departments) && b.status === 'open' && setEditing(b)}
            empty={<EmptyState icon={<Receipt />} title="No bills to pay" body="Add supplier bills with due dates so nothing is paid late." />}
            columns={[
              { key: 'vendor', header: 'Supplier', cell: (b) => (<div><p className="font-medium">{L.partyMap.get(b.vendor_id ?? '')?.name ?? '—'}</p><p className="text-xs text-muted">{b.description}{b.reference ? ` · ${b.reference}` : ''}</p></div>) },
              { key: 'dept', header: 'Department', cell: (b) => <DeptTag dept={L.deptMap.get(b.department_id)} /> },
              { key: 'cat', header: 'Category', cell: (b) => <span className="text-ink-2">{L.accountMap.get(b.account_id)?.name}</span> },
              { key: 'date', header: 'Bill date', cell: (b) => formatDate(b.bill_date), sort: (b) => b.bill_date },
              {
                key: 'due',
                header: 'Due',
                cell: (b) => {
                  if (!b.due_date) return '—';
                  const d = daysBetween(asOf, b.due_date);
                  return (
                    <span className={b.status === 'open' && d < 0 ? 'font-medium text-negative' : b.status === 'open' && d <= 7 ? 'font-medium text-caution' : ''}>
                      {formatDate(b.due_date)}
                      {b.status === 'open' && <span className="block text-xs">{d < 0 ? `${-d} days overdue` : d === 0 ? 'Due today' : `in ${d} days`}</span>}
                    </span>
                  );
                },
                sort: (b) => b.due_date ?? '',
              },
              { key: 'amount', header: 'Amount', align: 'right', cell: (b) => formatMoney(b.amount_minor, b.currency), sort: (b) => b.amount_minor },
              { key: 'status', header: 'Status', cell: (b) => <Badge tone={b.status === 'paid' ? 'positive' : b.status === 'void' ? 'negative' : b.due_date && b.due_date < asOf ? 'negative' : 'caution'}>{b.status === 'open' && b.due_date && b.due_date < asOf ? 'Overdue' : b.status[0].toUpperCase() + b.status.slice(1)}</Badge> },
              {
                key: 'actions',
                header: '',
                align: 'right',
                cell: (b) =>
                  b.status === 'open' && canWriteDepartment(member, b.department_id, L.departments) ? (
                    <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" onClick={() => pay(b)}><HandCoins /> Pay</Button>
                      <Menu
                        trigger={<Button size="sm" variant="ghost" aria-label="More">•••</Button>}
                        items={[
                          { label: 'Edit', icon: <Pencil />, onSelect: () => setEditing(b) },
                          { label: 'Mark paid (already recorded)', icon: <CheckCircle2 />, onSelect: () => void repo.update('bills', b.id, { status: 'paid' }).then(refresh) },
                          { label: 'Void bill', icon: <Ban />, danger: true, onSelect: () => void repo.update('bills', b.id, { status: 'void' }).then(refresh) },
                        ]}
                      />
                    </span>
                  ) : null,
              },
            ]}
          />
        </div>
      </Card>
      {editing && <BillDialog bill={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </>
  );
}

function BillDialog({ bill, onClose, onSaved }: { bill: Bill | null; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const L = useLookups();
  const repo = useRepo();
  const { member } = useAppData();
  const [v, setV] = useState<Partial<Bill>>(bill ?? { department_id: member?.department_id ?? L.departments.find((d) => !d.is_operating)?.id, currency: 'LKR', bill_date: today(), due_date: addDays(today(), 30), status: 'open', description: '', amount_minor: 0 });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!v.account_id) return toast.error('Choose the category.');
    if (!v.amount_minor) return toast.error('Enter the amount.');
    if (!v.description?.trim()) return toast.error('Add a description.');
    setBusy(true);
    try {
      const values = { vendor_id: v.vendor_id ?? null, department_id: v.department_id!, project_id: v.project_id ?? null, account_id: v.account_id, reference: v.reference ?? null, description: v.description.trim(), bill_date: v.bill_date!, due_date: v.due_date || null, currency: v.currency!, amount_minor: v.amount_minor, status: v.status ?? 'open' };
      const saved = bill ? await repo.update('bills', bill.id, values) : await repo.insert('bills', values);
      if (file) await repo.uploadAttachment(file, { bill_id: saved.id });
      await onSaved();
      toast.success('Bill saved');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={bill ? 'Edit bill' : 'Add bill'} size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Supplier"><Combobox options={partyOptions(L.parties, ['vendor'])} value={v.vendor_id ?? null} onChange={(p) => setV({ ...v, vendor_id: p, account_id: v.account_id ?? L.partyMap.get(p ?? '')?.default_account_id ?? undefined })} allowClear /></Field>
        <Field label="Department"><Select value={v.department_id ?? ''} onChange={(e) => setV({ ...v, department_id: e.target.value, project_id: null })} options={L.departments.map((d) => ({ value: d.id, label: d.name, disabled: !canWriteDepartment(member, d.id, L.departments) }))} /></Field>
        <Field label="Category"><Combobox options={categoryOptions(L.accounts, ['direct_cost', 'operating'])} value={v.account_id ?? null} onChange={(a) => setV({ ...v, account_id: a ?? undefined })} /></Field>
        <Field label="Project"><Combobox options={projectOptions(L.projects, v.department_id)} value={v.project_id ?? null} onChange={(p) => setV({ ...v, project_id: p })} allowClear placeholder="Optional" /></Field>
        <Field label="Description" className="col-span-2"><Input value={v.description ?? ''} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <Field label="Supplier's reference"><Input value={v.reference ?? ''} onChange={(e) => setV({ ...v, reference: e.target.value })} /></Field>
        <Field label="Currency"><Select value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })} options={(L.settings?.currencies ?? ['LKR']).map((c) => ({ value: c, label: c }))} /></Field>
        <Field label="Bill date"><Input type="date" value={v.bill_date ?? ''} onChange={(e) => setV({ ...v, bill_date: e.target.value })} /></Field>
        <Field label="Due date"><Input type="date" value={v.due_date ?? ''} onChange={(e) => setV({ ...v, due_date: e.target.value })} /></Field>
        <Field label="Amount"><MoneyInput currency={v.currency} value={v.amount_minor ?? null} onChange={(a) => setV({ ...v, amount_minor: a ?? 0 })} /></Field>
        <Field label="Attach the bill"><Input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
      </div>
    </Dialog>
  );
}
