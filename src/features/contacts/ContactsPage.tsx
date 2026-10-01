import { Plus, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { Badge, Card, EmptyState, PageHeader, Spinner, Tabs } from '@/components/ui/misc';
import { formatMoney } from '@/domain/money';
import { countableRows } from '@/domain/reports';
import type { Party, PartyKind } from '@/domain/types';
import { useAppData } from '@/data/context';
import { useSaveRow } from '@/data/hooks';
import { canEditMaster } from '@/data/permissions';
import { errorMessage } from '@/lib/cn';
import { DeptTag } from '../shared/bits';
import { categoryOptions } from '../shared/options';
import { useReportData } from '../shared/useFinance';

const KIND_LABEL: Record<PartyKind, string> = { client: 'Clients', vendor: 'Vendors', staff: 'Staff' };

export default function ContactsPage() {
  const { L, rows, loading } = useReportData();
  const { member } = useAppData();
  const [kind, setKind] = useState<PartyKind>('client');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Party | 'new' | null>(null);
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of countableRows(rows)) {
      if (!r.party_id || r.role !== 'money') continue;
      m.set(r.party_id, (m.get(r.party_id) ?? 0) + r.amount_lkr_minor);
    }
    return m;
  }, [rows]);
  if (loading) return <Spinner />;
  const list = L.parties.filter((p) => p.kind === kind && (!search || p.name.toLowerCase().includes(search.toLowerCase())));
  const columns: Column<Party>[] = [
    { key: 'name', header: 'Name', cell: (p) => (<div><p className={p.archived ? 'text-muted line-through' : 'font-medium text-ink'}>{p.name}</p><p className="text-xs text-muted">{[p.email, p.phone].filter(Boolean).join(' · ')}</p></div>), sort: (p) => p.name },
    ...(kind === 'staff'
      ? [
          { key: 'role', header: 'Role', cell: (p: Party) => (<div><p>{p.designation ?? '—'}</p><p className="text-xs text-muted">{p.staff_type === 'contractor' ? 'Contractor — no EPF/ETF/APIT' : `Employee${p.epf_number ? ` · ${p.epf_number}` : ''}`}</p></div>) } as Column<Party>,
          { key: 'dept', header: 'Department', cell: (p: Party) => <DeptTag dept={L.deptMap.get(p.default_department_id ?? '')} /> } as Column<Party>,
          { key: 'salary', header: 'Basic salary', align: 'right', cell: (p: Party) => (p.basic_salary_minor ? formatMoney(p.basic_salary_minor, 'LKR', { plain: true }) : '—'), sort: (p: Party) => p.basic_salary_minor ?? 0 } as Column<Party>,
        ]
      : [
          { key: 'country', header: 'Country', cell: (p: Party) => p.country ?? '—', sort: (p: Party) => p.country ?? '' } as Column<Party>,
          { key: 'category', header: 'Default category', cell: (p: Party) => <span className="text-ink-2">{L.accountMap.get(p.default_account_id ?? '')?.name ?? '—'}</span> } as Column<Party>,
        ]),
    { key: 'total', header: kind === 'client' ? 'Received (LKR)' : 'Paid (LKR)', align: 'right', cell: (p) => formatMoney(Math.abs(totals.get(p.id) ?? 0), 'LKR', { plain: true, whole: true }), sort: (p) => Math.abs(totals.get(p.id) ?? 0) },
    { key: 'status', header: '', cell: (p) => (p.archived ? <Badge>Archived</Badge> : null) },
  ];
  return (
    <>
      <PageHeader title="Contacts" description="Clients, vendors and staff. Defaults here speed up data entry." actions={canEditMaster(member) && <Button variant="primary" onClick={() => setEditing('new')}><Plus /> Add {kind === 'staff' ? 'staff member' : kind}</Button>} />
      <Card padded={false}>
        <div className="flex items-center justify-between gap-3 px-5 pt-2">
          <Tabs value={kind} onChange={setKind} tabs={(['client', 'vendor', 'staff'] as PartyKind[]).map((k) => ({ value: k, label: KIND_LABEL[k], count: L.parties.filter((p) => p.kind === k).length }))} listClassName="border-b-0" />
          <div className="relative w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input aria-label="Search contacts" className="pl-9" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="border-t border-line">
          <DataTable rows={list} columns={columns} rowKey={(p) => p.id} onRowClick={canEditMaster(member) ? (p) => setEditing(p) : undefined} initialSort={{ key: 'name' }} empty={<EmptyState icon={<Users />} title={`No ${KIND_LABEL[kind].toLowerCase()} yet`} />} />
        </div>
      </Card>
      {editing && <ContactDialog party={editing === 'new' ? null : editing} kind={kind} onClose={() => setEditing(null)} />}
    </>
  );
}

export function ContactDialog({ party, kind, onClose }: { party: Party | null; kind: PartyKind; onClose: () => void }) {
  const { L } = useReportData();
  const save = useSaveRow('parties');
  const [v, setV] = useState<Partial<Party>>(party ?? { kind, name: '', staff_type: kind === 'staff' ? 'employee' : null, archived: false });
  const submit = async () => {
    if (!v.name?.trim()) return toast.error('Enter a name.');
    try {
      const { id: _i, ...values } = v as Party & { created_at?: string; updated_at?: string };
      void _i;
      delete (values as { created_at?: string }).created_at;
      delete (values as { updated_at?: string }).updated_at;
      await save.mutateAsync({ id: party?.id, values: { ...values, name: values.name.trim() } });
      toast.success(party ? 'Saved' : 'Added');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const k = v.kind ?? kind;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={party ? `Edit ${party.name}` : `Add ${k === 'staff' ? 'staff member' : k}`} size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => void submit()}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name" className="col-span-2"><Input autoFocus value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={v.email ?? ''} onChange={(e) => setV({ ...v, email: e.target.value || null })} /></Field>
        <Field label="Phone"><Input value={v.phone ?? ''} onChange={(e) => setV({ ...v, phone: e.target.value || null })} /></Field>
        {k === 'staff' ? (
          <>
            <Field label="Type" hint="Contractors are paid gross: no EPF, ETF or APIT.">
              <Select value={v.staff_type ?? 'employee'} onChange={(e) => setV({ ...v, staff_type: e.target.value as 'employee' | 'contractor' })} options={[{ value: 'employee', label: 'Employee' }, { value: 'contractor', label: 'Contractor' }]} />
            </Field>
            <Field label="Department"><Select value={v.default_department_id ?? ''} onChange={(e) => setV({ ...v, default_department_id: e.target.value || null })} options={L.departments.map((d) => ({ value: d.id, label: d.name }))} placeholder="Choose" /></Field>
            <Field label="Designation"><Input value={v.designation ?? ''} onChange={(e) => setV({ ...v, designation: e.target.value || null })} /></Field>
            <Field label="EPF number"><Input value={v.epf_number ?? ''} onChange={(e) => setV({ ...v, epf_number: e.target.value || null })} /></Field>
            <Field label="Basic monthly salary" hint="Used to pre-fill payroll runs."><MoneyInput value={v.basic_salary_minor ?? null} onChange={(m) => setV({ ...v, basic_salary_minor: m })} /></Field>
          </>
        ) : (
          <>
            <Field label="Country"><Input value={v.country ?? ''} onChange={(e) => setV({ ...v, country: e.target.value || null })} /></Field>
            <Field label="Tax / registration no."><Input value={v.tax_id ?? ''} onChange={(e) => setV({ ...v, tax_id: e.target.value || null })} /></Field>
            <Field label="Default category" hint="Pre-selected when you pick this contact." className="col-span-2">
              <Combobox options={categoryOptions(L.accounts, k === 'client' ? ['revenue', 'other_income'] : ['direct_cost', 'operating'])} value={v.default_account_id ?? null} onChange={(c) => setV({ ...v, default_account_id: c })} allowClear />
            </Field>
            <Field label="Address" className="col-span-2"><Textarea value={v.address ?? ''} onChange={(e) => setV({ ...v, address: e.target.value || null })} /></Field>
          </>
        )}
        <Field label="Notes" className="col-span-2"><Textarea value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.target.value || null })} /></Field>
        {party && (
          <label className="col-span-2 flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={!!v.archived} onChange={(e) => setV({ ...v, archived: e.target.checked })} /> Archived
          </label>
        )}
      </div>
    </Dialog>
  );
}
