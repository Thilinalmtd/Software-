import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Play, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { DataTable } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, MoneyInput, Select, Switch } from '@/components/ui/form';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import { formatMoney } from '@/domain/money';
import { formatDate, today } from '@/domain/period';
import { advanceTemplate, dueTemplates, FREQUENCY_LABELS } from '@/domain/recurring';
import type { Frequency, RecurringTemplate } from '@/domain/types';
import { useAppData, useRepo } from '@/data/context';
import { useLookups, useTable } from '@/data/hooks';
import { canRecord, canWriteDepartment, writableDepartments } from '@/data/permissions';
import { errorMessage } from '@/lib/cn';
import { useUi } from '@/app/ui-state';
import { DeptTag } from '../shared/bits';
import { categoryOptions, moneyAccountOptions, partyOptions } from '../shared/options';

export default function RecurringPage() {
  const L = useLookups();
  const repo = useRepo();
  const qc = useQueryClient();
  const { member } = useAppData();
  const { openQuickAdd } = useUi();
  const templates = useTable('recurring_templates', { order: { column: 'next_date' } });
  const [editing, setEditing] = useState<RecurringTemplate | 'new' | null>(null);
  if (L.loading || templates.isLoading) return <Spinner />;
  const due = new Set(dueTemplates(templates.data ?? [], today(), 3).map((t) => t.id));

  const postNow = (t: RecurringTemplate) => {
    const money = L.accountMap.get(t.money_account_id);
    openQuickAdd({
      tab: t.kind,
      prefill: {
        date: t.next_date <= today() ? t.next_date : today(),
        accountId: t.money_account_id,
        departmentId: t.department_id,
        projectId: t.project_id,
        partyId: t.party_id,
        description: t.description,
        categoryTouched: true,
        ...(t.kind === 'income' ? { categoryId: t.category_account_id, amountMinor: t.amount_minor } : { splits: [{ key: crypto.randomUUID(), accountId: t.category_account_id, amountMinor: t.amount_minor, projectId: t.project_id }] }),
        rateTouched: money?.currency === 'LKR',
      },
      onSaved: async () => {
        const next = advanceTemplate(t);
        await repo.update('recurring_templates', t.id, next ? { next_date: next } : { active: false });
        await qc.invalidateQueries({ queryKey: ['recurring_templates'] });
      },
    });
  };

  return (
    <>
      <PageHeader title="Recurring" description="Subscriptions, rent, internet and other regular items. When one is due, post it with one click — you confirm the amount first." actions={canRecord(member) && <Button variant="primary" onClick={() => setEditing('new')}><Plus /> Add recurring item</Button>} />
      <Card padded={false}>
        <DataTable<RecurringTemplate>
          rows={templates.data ?? []}
          rowKey={(t) => t.id}
          onRowClick={(t) => canWriteDepartment(member, t.department_id, L.departments) && setEditing(t)}
          empty={<EmptyState icon={<CalendarClock />} title="No recurring items" body="Add things you pay or receive regularly, like Autodesk, office rent or a retainer." />}
          columns={[
            { key: 'name', header: 'Item', cell: (t) => (<div><p className="font-medium">{t.name}</p><p className="text-xs text-muted">{L.partyMap.get(t.party_id ?? '')?.name ?? ''} · {L.accountMap.get(t.category_account_id)?.name}</p></div>) },
            { key: 'dept', header: 'Department', cell: (t) => <DeptTag dept={L.deptMap.get(t.department_id)} /> },
            { key: 'freq', header: 'Every', cell: (t) => FREQUENCY_LABELS[t.frequency] },
            { key: 'account', header: 'Account', cell: (t) => <span className="text-ink-2">{L.accountMap.get(t.money_account_id)?.name}</span> },
            { key: 'amount', header: 'Amount', align: 'right', cell: (t) => <span className={t.kind === 'income' ? 'text-positive' : ''}>{formatMoney(t.kind === 'income' ? t.amount_minor : -t.amount_minor, L.accountMap.get(t.money_account_id)?.currency ?? 'LKR', { signed: true })}</span> },
            { key: 'next', header: 'Next', cell: (t) => (t.active ? <span className={due.has(t.id) ? 'font-medium text-caution' : ''}>{formatDate(t.next_date)}</span> : <Badge>Paused</Badge>), sort: (t) => t.next_date },
            { key: 'go', header: '', align: 'right', cell: (t) => (t.active && canWriteDepartment(member, t.department_id, L.departments) ? <span onClick={(e) => e.stopPropagation()}><Button size="sm" variant={due.has(t.id) ? 'primary' : 'secondary'} onClick={() => postNow(t)}><Play /> Post {due.has(t.id) ? 'now' : 'early'}</Button></span> : null) },
          ]}
        />
      </Card>
      {editing && <RecurringDialog template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RecurringDialog({ template, onClose }: { template: RecurringTemplate | null; onClose: () => void }) {
  const L = useLookups();
  const repo = useRepo();
  const qc = useQueryClient();
  const { member } = useAppData();
  const writable = writableDepartments(member, L.departments);
  const [v, setV] = useState<Partial<RecurringTemplate>>(template ?? { kind: 'expense', frequency: 'monthly', next_date: today(), active: true, department_id: member?.department_id ?? writable[0]?.id, name: '', description: '', amount_minor: 0 });
  const money = L.accountMap.get(v.money_account_id ?? '');
  const save = async () => {
    if (!v.name?.trim() || !v.money_account_id || !v.category_account_id || !v.amount_minor) return toast.error('Fill in the name, account, category and amount.');
    try {
      const values = { name: v.name.trim(), kind: v.kind!, frequency: v.frequency!, next_date: v.next_date!, end_date: v.end_date || null, department_id: v.department_id!, project_id: v.project_id ?? null, party_id: v.party_id ?? null, money_account_id: v.money_account_id, category_account_id: v.category_account_id, amount_minor: v.amount_minor, description: v.description?.trim() || v.name.trim(), active: v.active ?? true };
      if (template) await repo.update('recurring_templates', template.id, values);
      else await repo.insert('recurring_templates', values);
      await qc.invalidateQueries({ queryKey: ['recurring_templates'] });
      toast.success('Saved');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={template ? `Edit ${template.name}` : 'Add recurring item'} size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name"><Input autoFocus value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Autodesk — Civil" /></Field>
        <Field label="Type"><Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as 'income' | 'expense', category_account_id: undefined })} options={[{ value: 'expense', label: 'Money out' }, { value: 'income', label: 'Money in' }]} /></Field>
        <Field label="Department"><Select value={v.department_id ?? ''} onChange={(e) => setV({ ...v, department_id: e.target.value })} options={L.departments.map((d) => ({ value: d.id, label: d.name, disabled: !writable.some((w) => w.id === d.id) }))} /></Field>
        <Field label="Account"><Combobox options={moneyAccountOptions(L.accounts, L.departments, { departmentIds: v.kind === 'income' ? undefined : writable.map((d) => d.id) })} value={v.money_account_id ?? null} onChange={(a) => setV({ ...v, money_account_id: a ?? undefined })} /></Field>
        <Field label="Category"><Combobox options={categoryOptions(L.accounts, v.kind === 'income' ? ['revenue', 'other_income'] : ['direct_cost', 'operating'])} value={v.category_account_id ?? null} onChange={(a) => setV({ ...v, category_account_id: a ?? undefined })} /></Field>
        <Field label="Contact"><Combobox options={partyOptions(L.parties, v.kind === 'income' ? ['client'] : ['vendor'])} value={v.party_id ?? null} onChange={(p) => setV({ ...v, party_id: p })} allowClear placeholder="Optional" /></Field>
        <Field label="Amount"><MoneyInput currency={money?.currency ?? 'LKR'} value={v.amount_minor ?? null} onChange={(a) => setV({ ...v, amount_minor: a ?? 0 })} /></Field>
        <Field label="Frequency"><Select value={v.frequency} onChange={(e) => setV({ ...v, frequency: e.target.value as Frequency })} options={Object.entries(FREQUENCY_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Next date"><Input type="date" value={v.next_date ?? ''} onChange={(e) => setV({ ...v, next_date: e.target.value })} /></Field>
        <Field label="End date (optional)"><Input type="date" value={v.end_date ?? ''} onChange={(e) => setV({ ...v, end_date: e.target.value || null })} /></Field>
        <Field label="Description" className="col-span-2"><Input value={v.description ?? ''} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <label className="col-span-2 flex items-center gap-3 text-[13px] text-ink-2"><Switch checked={v.active ?? true} onCheckedChange={(c) => setV({ ...v, active: c })} /> Active</label>
      </div>
    </Dialog>
  );
}
