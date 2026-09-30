import { useQueryClient } from '@tanstack/react-query';
import { Ban, Download, FileText, HandCoins, Pencil, Plus, Send, Trash2, Copy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { DataTable } from '@/components/ui/data-table';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { Badge, Card, EmptyState, Menu, PageHeader, Spinner, Tabs } from '@/components/ui/misc';
import { formatMoney } from '@/domain/money';
import { addDays, formatDate, today } from '@/domain/period';
import { AGE_BUCKET_LABELS, type AgeBucket } from '@/domain/reports';
import type { Invoice, InvoiceItem, InvoiceKind } from '@/domain/types';
import { useAppData, useRepo } from '@/data/context';
import { useLookups, useTable } from '@/data/hooks';
import { canRecord, canWriteDepartment } from '@/data/permissions';
import { errorMessage } from '@/lib/cn';
import { downloadInvoice } from '@/lib/pdf';
import { useUi } from '@/app/ui-state';
import { DeptTag } from '../shared/bits';
import { partyOptions, projectOptions } from '../shared/options';
import { useReceivables } from '../shared/useFinance';

const STATUS_TONE: Record<string, 'neutral' | 'positive' | 'caution' | 'info' | 'negative'> = { draft: 'neutral', sent: 'info', accepted: 'positive', paid: 'positive', void: 'negative' };

export default function InvoicesPage() {
  const [params, setParams] = useSearchParams();
  const kind = (params.get('kind') as InvoiceKind) ?? 'invoice';
  const L = useLookups();
  const repo = useRepo();
  const qc = useQueryClient();
  const { member } = useAppData();
  const { dept, openQuickAdd } = useUi();
  const invoices = useTable('invoices', { order: { column: 'issue_date', ascending: false } });
  const items = useTable('invoice_items');
  const receivables = useReceivables();
  const [editing, setEditing] = useState<Invoice | 'new' | null>(null);
  const [voiding, setVoiding] = useState<Invoice | null>(null);
  const paidMap = useMemo(() => new Map(receivables.list.map((x) => [x.invoice.id, x.paid])), [receivables.list]);
  const asOf = today();
  if (L.loading || invoices.isLoading) return <Spinner />;
  const list = (invoices.data ?? []).filter((i) => i.kind === kind && (dept === 'all' || i.department_id === dept) && (params.get('filter') !== 'overdue' || (i.due_date && i.due_date < asOf && i.status !== 'paid' && i.status !== 'void' && i.status !== 'draft')));
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['invoices'] }), qc.invalidateQueries({ queryKey: ['invoice_items'] })]);

  const pdf = async (inv: Invoice) => {
    try {
      await downloadInvoice({ settings: L.settings!, invoice: inv, items: (items.data ?? []).filter((x) => x.invoice_id === inv.id).sort((a, b) => a.sort_order - b.sort_order), client: L.partyMap.get(inv.client_id), projectName: L.projectMap.get(inv.project_id ?? '')?.name, paidMinor: paidMap.get(inv.id) ?? 0 });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const recordPayment = (inv: Invoice) => {
    const outstanding = inv.total_minor - (paidMap.get(inv.id) ?? 0);
    openQuickAdd({ tab: 'income', prefill: { partyId: inv.client_id, projectId: inv.project_id, departmentId: inv.department_id, invoiceId: inv.id, invoiceAmountMinor: outstanding, amountMinor: outstanding, description: `Payment ${inv.number}`, reference: inv.number } });
  };
  const convert = async (q: Invoice) => {
    try {
      const inv = await repo.insert('invoices', { kind: 'invoice', department_id: q.department_id, project_id: q.project_id, client_id: q.client_id, issue_date: today(), due_date: addDays(today(), 30), currency: q.currency, status: 'draft', notes: q.notes, terms: L.settings?.invoice_footer ?? q.terms, subtotal_minor: q.subtotal_minor, discount_minor: q.discount_minor, tax_minor: q.tax_minor, total_minor: q.total_minor });
      await repo.insertMany('invoice_items', (items.data ?? []).filter((x) => x.invoice_id === q.id).map((x) => ({ invoice_id: inv.id, sort_order: x.sort_order, description: x.description, quantity: x.quantity, unit_price_minor: x.unit_price_minor, amount_minor: x.amount_minor })));
      await repo.update('invoices', q.id, { status: 'accepted' });
      await refresh();
      toast.success(`Created ${inv.number}`);
      setParams({ kind: 'invoice' });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Invoices & quotes"
        description="Invoices track what clients owe. Profit is recognised when payment arrives (cash basis), so an invoice alone does not change the figures."
        actions={canRecord(member) && <Button variant="primary" onClick={() => setEditing('new')}><Plus /> New {kind === 'quote' ? 'quote' : 'invoice'}</Button>}
      />
      {kind === 'invoice' && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-6">
          <div className="rounded-xl border border-line bg-surface px-4 py-3 md:col-span-1">
            <p className="text-xs text-ink-2">Owed to you</p>
            <p className="mt-1 text-lg font-semibold tabular">{formatMoney(receivables.aged.totalLkr, 'LKR', { compact: true })}</p>
          </div>
          {(Object.keys(AGE_BUCKET_LABELS) as AgeBucket[]).map((b) => (
            <div key={b} className="rounded-xl border border-line bg-surface px-4 py-3">
              <p className="text-xs text-ink-2">{AGE_BUCKET_LABELS[b]}</p>
              <p className={`mt-1 text-lg font-semibold tabular ${b !== 'not_due' && receivables.aged.buckets[b] > 0 ? 'text-negative' : ''}`}>{formatMoney(receivables.aged.buckets[b], 'LKR', { compact: true })}</p>
            </div>
          ))}
        </div>
      )}
      <Card padded={false}>
        <div className="px-5 pt-2">
          <Tabs value={kind} onChange={(k) => setParams({ kind: k })} tabs={[{ value: 'invoice', label: 'Invoices', count: (invoices.data ?? []).filter((i) => i.kind === 'invoice').length }, { value: 'quote', label: 'Quotes', count: (invoices.data ?? []).filter((i) => i.kind === 'quote').length }]} listClassName="border-b-0" />
        </div>
        <div className="border-t border-line">
          <DataTable<Invoice>
            rows={list}
            rowKey={(i) => i.id}
            onRowClick={(i) => (canWriteDepartment(member, i.department_id, L.departments) && i.status !== 'void' ? setEditing(i) : void pdf(i))}
            empty={<EmptyState icon={<FileText />} title={`No ${kind === 'quote' ? 'quotes' : 'invoices'} yet`} />}
            columns={[
              { key: 'number', header: 'Number', cell: (i) => <span className="font-medium">{i.number}</span>, sort: (i) => i.number },
              { key: 'client', header: 'Client', cell: (i) => (<div><p>{L.partyMap.get(i.client_id)?.name}</p><p className="text-xs text-muted">{L.projectMap.get(i.project_id ?? '')?.name ?? ''}</p></div>), sort: (i) => L.partyMap.get(i.client_id)?.name ?? '' },
              { key: 'dept', header: 'Department', cell: (i) => <DeptTag dept={L.deptMap.get(i.department_id)} /> },
              { key: 'date', header: 'Date', cell: (i) => formatDate(i.issue_date), sort: (i) => i.issue_date },
              { key: 'due', header: kind === 'quote' ? 'Valid until' : 'Due', cell: (i) => <span className={i.kind === 'invoice' && i.due_date && i.due_date < asOf && !['paid', 'void', 'draft'].includes(i.status) ? 'font-medium text-negative' : ''}>{formatDate(i.due_date)}</span>, sort: (i) => i.due_date ?? '' },
              { key: 'total', header: 'Total', align: 'right', cell: (i) => formatMoney(i.total_minor, i.currency), sort: (i) => i.total_minor },
              ...(kind === 'invoice' ? [{ key: 'out', header: 'Outstanding', align: 'right' as const, cell: (i: Invoice) => (i.status === 'void' || i.status === 'draft' ? '—' : formatMoney(Math.max(0, i.total_minor - (paidMap.get(i.id) ?? 0)), i.currency)) }] : []),
              { key: 'status', header: 'Status', cell: (i) => { const overdue = i.kind === 'invoice' && !!i.due_date && i.due_date < asOf && i.status === 'sent'; return <Badge tone={overdue ? 'negative' : STATUS_TONE[i.status]}>{overdue ? 'Overdue' : i.status[0].toUpperCase() + i.status.slice(1)}</Badge>; } },
              {
                key: 'actions',
                header: '',
                align: 'right',
                cell: (i) => (
                  <span onClick={(e) => e.stopPropagation()}>
                    <Menu
                      trigger={<Button size="sm" variant="ghost" aria-label={`Actions for ${i.number}`}>•••</Button>}
                      items={[
                        { label: 'Download PDF', icon: <Download />, onSelect: () => void pdf(i) },
                        ...(canWriteDepartment(member, i.department_id, L.departments) && i.status !== 'void'
                          ? [
                              { label: 'Edit', icon: <Pencil />, onSelect: () => setEditing(i) },
                              ...(i.status === 'draft' ? [{ label: 'Mark as sent', icon: <Send />, onSelect: () => void repo.update('invoices', i.id, { status: 'sent' }).then(refresh) }] : []),
                              ...(i.kind === 'invoice' && i.status !== 'paid' && i.status !== 'draft' ? [{ label: 'Record payment', icon: <HandCoins />, onSelect: () => recordPayment(i) }] : []),
                              ...(i.kind === 'quote' && i.status !== 'accepted' ? [{ label: 'Convert to invoice', icon: <Copy />, onSelect: () => void convert(i) }] : []),
                              'separator' as const,
                              i.status === 'draft'
                                ? { label: 'Delete draft', icon: <Trash2 />, danger: true, onSelect: () => void repo.remove('invoices', i.id).then(refresh).catch((e) => toast.error(errorMessage(e))) }
                                : { label: 'Void', icon: <Ban />, danger: true, onSelect: () => setVoiding(i) },
                            ]
                          : []),
                      ]}
                    />
                  </span>
                ),
              },
            ]}
          />
        </div>
      </Card>
      {editing && <InvoiceEditor invoice={editing === 'new' ? null : editing} kind={kind} items={(items.data ?? []).filter((x) => editing !== 'new' && x.invoice_id === editing.id)} onClose={() => setEditing(null)} onSaved={refresh} />}
      <ConfirmDialog open={!!voiding} onOpenChange={(o) => !o && setVoiding(null)} title={`Void ${voiding?.number}?`} body="The invoice stays on record marked void. Payments already recorded are not changed." confirmLabel="Void invoice" danger onConfirm={async () => { if (voiding) { await repo.update('invoices', voiding.id, { status: 'void' }); await refresh(); } }} />
    </>
  );
}

interface ItemDraft {
  key: string;
  description: string;
  quantity: string;
  unit: number | null;
}

function InvoiceEditor({ invoice, kind, items, onClose, onSaved }: { invoice: Invoice | null; kind: InvoiceKind; items: InvoiceItem[]; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const L = useLookups();
  const repo = useRepo();
  const { member } = useAppData();
  const [v, setV] = useState({
    kind: invoice?.kind ?? kind,
    client_id: invoice?.client_id ?? null,
    department_id: invoice?.department_id ?? member?.department_id ?? L.departments.find((d) => d.is_operating)?.id ?? '',
    project_id: invoice?.project_id ?? null,
    currency: invoice?.currency ?? 'USD',
    issue_date: invoice?.issue_date ?? today(),
    due_date: invoice?.due_date ?? addDays(today(), 30),
    notes: invoice?.notes ?? '',
    terms: invoice?.terms ?? (kind === 'quote' ? 'Valid for 30 days.' : 'Payment within 30 days by bank transfer or Payoneer.'),
    discount: invoice?.discount_minor ?? 0,
    tax: invoice?.tax_minor ?? 0,
  });
  const [rows, setRows] = useState<ItemDraft[]>(items.length ? items.sort((a, b) => a.sort_order - b.sort_order).map((x) => ({ key: x.id, description: x.description, quantity: x.quantity, unit: x.unit_price_minor })) : [{ key: crypto.randomUUID(), description: '', quantity: '1', unit: null }]);
  const [busy, setBusy] = useState(false);
  const amount = (r: ItemDraft) => Math.round((Number(r.quantity) || 0) * (r.unit ?? 0));
  const subtotal = rows.reduce((s, r) => s + amount(r), 0);
  const total = subtotal - (v.discount ?? 0) + (v.tax ?? 0);

  const save = async (status?: Invoice['status']) => {
    if (!v.client_id) return toast.error('Choose the client.');
    if (!rows.some((r) => r.description.trim() && amount(r) > 0)) return toast.error('Add at least one line with an amount.');
    setBusy(true);
    try {
      const values = { kind: v.kind, client_id: v.client_id, department_id: v.department_id, project_id: v.project_id, currency: v.currency, issue_date: v.issue_date, due_date: v.due_date || null, notes: v.notes || null, terms: v.terms || null, subtotal_minor: subtotal, discount_minor: v.discount ?? 0, tax_minor: v.tax ?? 0, total_minor: total, ...(status ? { status } : invoice ? {} : { status: 'draft' as const }) };
      const saved = invoice ? await repo.update('invoices', invoice.id, values) : await repo.insert('invoices', values);
      for (const old of items) await repo.remove('invoice_items', old.id);
      await repo.insertMany('invoice_items', rows.filter((r) => r.description.trim()).map((r, idx) => ({ invoice_id: saved.id, sort_order: idx, description: r.description.trim(), quantity: String(Number(r.quantity) || 0), unit_price_minor: r.unit ?? 0, amount_minor: amount(r) })));
      await onSaved();
      toast.success(`${saved.number} saved`);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const isQuote = v.kind === 'quote';
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="xl"
      title={invoice ? `Edit ${invoice.number}` : isQuote ? 'New quote' : 'New invoice'}
      footer={
        <>
          <span className="mr-auto text-[15px] font-semibold tabular">Total {formatMoney(total, v.currency)}</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={() => void save()}>{invoice ? 'Save' : 'Save as draft'}</Button>
          {(!invoice || invoice.status === 'draft') && <Button variant="primary" loading={busy} onClick={() => void save('sent')}><Send /> Save &amp; mark sent</Button>}
        </>
      }
    >
      <div className="grid grid-cols-3 gap-4">
        <Field label="Client"><Combobox options={partyOptions(L.parties, ['client'])} value={v.client_id} onChange={(c) => setV({ ...v, client_id: c })} placeholder="Choose client" /></Field>
        <Field label="Department"><Select value={v.department_id} onChange={(e) => setV({ ...v, department_id: e.target.value, project_id: null })} options={L.departments.filter((d) => d.is_operating).map((d) => ({ value: d.id, label: d.name, disabled: !canWriteDepartment(member, d.id, L.departments) }))} /></Field>
        <Field label="Project"><Combobox options={projectOptions(L.projects, v.department_id)} value={v.project_id} onChange={(p) => setV({ ...v, project_id: p })} allowClear placeholder="Optional" /></Field>
        <Field label="Currency"><Select value={v.currency} disabled={!!invoice && invoice.status !== 'draft'} onChange={(e) => setV({ ...v, currency: e.target.value })} options={(L.settings?.currencies ?? ['USD']).map((c) => ({ value: c, label: c }))} /></Field>
        <Field label={isQuote ? 'Date' : 'Invoice date'}><Input type="date" value={v.issue_date} onChange={(e) => e.target.value && setV({ ...v, issue_date: e.target.value })} /></Field>
        <Field label={isQuote ? 'Valid until' : 'Due date'}><Input type="date" value={v.due_date ?? ''} onChange={(e) => setV({ ...v, due_date: e.target.value })} /></Field>
      </div>
      <div className="mt-5">
        <div className="grid grid-cols-[1fr_90px_170px_150px_36px] gap-2 border-b border-line pb-2 text-xs font-medium text-muted">
          <span>Description</span><span className="text-right">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span><span />
        </div>
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-[1fr_90px_170px_150px_36px] items-center gap-2 border-b border-line py-2">
            <Input aria-label="Line description" value={r.description} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, description: e.target.value } : x)))} placeholder="e.g. Structural calculations — phase 1" />
            <Input aria-label="Quantity" className="text-right" inputMode="decimal" value={r.quantity} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, quantity: e.target.value.replace(/[^\d.]/g, '') } : x)))} />
            <MoneyInput aria-label="Rate" currency={v.currency} value={r.unit} onChange={(u) => setRows(rows.map((x) => (x.key === r.key ? { ...x, unit: u } : x)))} />
            <span className="text-right tabular">{formatMoney(amount(r), v.currency, { plain: true })}</span>
            <Button size="icon-sm" variant="ghost" aria-label="Remove line" disabled={rows.length === 1} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}><Trash2 /></Button>
          </div>
        ))}
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setRows([...rows, { key: crypto.randomUUID(), description: '', quantity: '1', unit: null }])}><Plus /> Add line</Button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <Field label="Notes (shown on the document)"><Textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
          <Field label="Terms"><Textarea value={v.terms} onChange={(e) => setV({ ...v, terms: e.target.value })} /></Field>
        </div>
        <div className="space-y-3 rounded-lg bg-surface-2 p-4">
          <div className="flex justify-between text-[13px]"><span>Subtotal</span><span className="tabular">{formatMoney(subtotal, v.currency)}</span></div>
          <div className="flex items-center justify-between gap-4 text-[13px]"><span>Discount</span><MoneyInput className="w-44" currency={v.currency} value={v.discount} onChange={(d) => setV({ ...v, discount: d ?? 0 })} /></div>
          <div className="flex items-center justify-between gap-4 text-[13px]"><span>Tax (if registered)</span><MoneyInput className="w-44" currency={v.currency} value={v.tax} onChange={(t) => setV({ ...v, tax: t ?? 0 })} /></div>
          <div className="flex justify-between border-t border-line-strong pt-3 text-[15px] font-semibold"><span>Total</span><span className="tabular">{formatMoney(total, v.currency)}</span></div>
        </div>
      </div>
    </Dialog>
  );
}
