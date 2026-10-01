import { useQueryClient } from '@tanstack/react-query';
import { Keyboard, Lock, Plus, RotateCcw, Save, Trash2, Unlock, Upload } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { DataTable } from '@/components/ui/data-table';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, MoneyInput, Select, Switch, Textarea } from '@/components/ui/form';
import { Badge, Callout, Card, Kbd, PageHeader, Spinner, Tabs } from '@/components/ui/misc';
import { CURRENCY_NAMES } from '@/domain/defaults';
import { formatDate, monthEnd, today, addMonths, monthStart } from '@/domain/period';
import { GROUP_LABELS } from '@/domain/reports';
import type { CategorisationRule, CategoryGroup, CompanySettings, Department, LedgerAccount, Role } from '@/domain/types';
import { useAppData, useRepo } from '@/data/context';
import { useLookups, useMembers, usePeriodLock, useSaveRow, useSaveSettings, useSetMember, useSetPeriodLock, useTable } from '@/data/hooks';
import { canEditChart, canEditMaster, isAdmin, ROLE_LABELS } from '@/data/permissions';
import { cn, errorMessage } from '@/lib/cn';
import { WorkbookImport } from './WorkbookImport';
import { categoryOptions, partyOptions, projectOptions } from '../shared/options';

type Tab = 'company' | 'departments' | 'categories' | 'tax' | 'rules' | 'users' | 'lock' | 'data' | 'help';

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'company';
  const { member } = useAppData();
  const L = useLookups();
  if (L.loading || !L.settings) return <Spinner />;
  const tabs: { value: Tab; label: string }[] = [
    { value: 'company', label: 'Company' },
    { value: 'departments', label: 'Departments' },
    { value: 'categories', label: 'Categories' },
    { value: 'tax', label: 'Payroll & tax' },
    { value: 'rules', label: 'Auto-categorise' },
    { value: 'users', label: 'Users' },
    { value: 'lock', label: 'Month lock' },
    { value: 'data', label: 'Import & export' },
    { value: 'help', label: 'Help' },
  ];
  return (
    <>
      <PageHeader title="Settings" description={isAdmin(member) ? 'Company-wide settings. Changes are recorded in the audit log.' : 'Only an admin can change most settings.'} />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={tabs} className="mb-5" />
      {tab === 'company' && <CompanyTab settings={L.settings} />}
      {tab === 'departments' && <DepartmentsTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'tax' && <TaxTab settings={L.settings} />}
      {tab === 'rules' && <RulesTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'lock' && <LockTab />}
      {tab === 'data' && <DataTab />}
      {tab === 'help' && <HelpTab />}
    </>
  );
}

function useSettingsDraft(settings: CompanySettings) {
  const [s, setS] = useState(settings);
  useEffect(() => setS(settings), [settings]);
  const save = useSaveSettings();
  const dirty = JSON.stringify(s) !== JSON.stringify(settings);
  const commit = async () => {
    try {
      await save.mutateAsync(s);
      toast.success('Settings saved');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return { s, setS, dirty, commit, saving: save.isPending };
}

function SaveBar({ dirty, onSave, saving, disabled }: { dirty: boolean; onSave: () => void; saving: boolean; disabled?: boolean }) {
  if (disabled) return <Callout className="mt-4" tone="info">Only an admin can change these settings.</Callout>;
  return (
    <div className="mt-5 flex items-center justify-end gap-3">
      {dirty && <span className="text-xs text-caution">Unsaved changes</span>}
      <Button variant="primary" disabled={!dirty} loading={saving} onClick={onSave}><Save /> Save changes</Button>
    </div>
  );
}

function ListEditor({ label, values, onChange, disabled }: { label: string; values: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const [text, setText] = useState('');
  return (
    <Field label={label}>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <Badge key={v} className="gap-1">{v}{!disabled && <button type="button" aria-label={`Remove ${v}`} className="cursor-pointer text-muted hover:text-ink" onClick={() => onChange(values.filter((x) => x !== v))}>×</button>}</Badge>
        ))}
        {!disabled && (
          <input
            className="h-6 w-40 rounded-md border border-dashed border-line-strong bg-transparent px-2 text-xs outline-none focus:border-focus"
            placeholder="Add and press Enter"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim()) {
                e.preventDefault();
                if (!values.includes(text.trim())) onChange([...values, text.trim()]);
                setText('');
              }
            }}
          />
        )}
      </div>
    </Field>
  );
}

function CompanyTab({ settings }: { settings: CompanySettings }) {
  const { member } = useAppData();
  const { s, setS, dirty, commit, saving } = useSettingsDraft(settings);
  const admin = isAdmin(member);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return (
    <Card>
      <div className="grid grid-cols-2 gap-5">
        <Field label="Company name"><Input disabled={!admin} value={s.company_name} onChange={(e) => setS({ ...s, company_name: e.target.value })} /></Field>
        <Field label="Tax identification number (TIN)"><Input disabled={!admin} value={s.tax_id ?? ''} onChange={(e) => setS({ ...s, tax_id: e.target.value || null })} /></Field>
        <Field label="Address (shown on invoices and payslips)" className="col-span-2"><Textarea disabled={!admin} value={s.address ?? ''} onChange={(e) => setS({ ...s, address: e.target.value || null })} /></Field>
        <Field label="Financial year starts in" hint="Sri Lanka's year of assessment starts in April."><Select disabled={!admin} value={String(s.fy_start_month)} onChange={(e) => setS({ ...s, fy_start_month: Number(e.target.value) })} options={months.map((m, i) => ({ value: String(i + 1), label: m }))} /></Field>
        <Field label="Reporting currency" hint="All reports are in LKR."><Input disabled value="LKR — Sri Lankan Rupee" /></Field>
        <Field label="Currencies in use" className="col-span-2">
          <div className="flex flex-wrap gap-3">
            {Object.keys(CURRENCY_NAMES).map((c) => (
              <label key={c} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" disabled={!admin || c === 'LKR'} checked={s.currencies.includes(c)} onChange={(e) => setS({ ...s, currencies: e.target.checked ? [...s.currencies, c] : s.currencies.filter((x) => x !== c) })} />
                {c} <span className="text-muted">{CURRENCY_NAMES[c]}</span>
              </label>
            ))}
          </div>
        </Field>
        <ListEditor label="Revenue channels" values={s.lists.channels} disabled={!admin} onChange={(v) => setS({ ...s, lists: { ...s.lists, channels: v } })} />
        <ListEditor label="Payment methods" values={s.lists.payment_methods} disabled={!admin} onChange={(v) => setS({ ...s, lists: { ...s.lists, payment_methods: v } })} />
        <ListEditor label="Pricing types" values={s.lists.pricing_types} disabled={!admin} onChange={(v) => setS({ ...s, lists: { ...s.lists, pricing_types: v } })} />
        <Field label="Invoice footer"><Input disabled={!admin} value={s.invoice_footer ?? ''} onChange={(e) => setS({ ...s, invoice_footer: e.target.value || null })} /></Field>
        <Field label="Ask for a receipt on expenses above" hint="Shown in “Needs attention”."><MoneyInput disabled={!admin} value={s.attention.receipt_required_above_minor} onChange={(v) => setS({ ...s, attention: { ...s.attention, receipt_required_above_minor: v ?? 0 } })} /></Field>
        <Field label="Remind to reconcile after (days)"><Input disabled={!admin} type="number" min={7} value={s.attention.reconcile_after_days} onChange={(e) => setS({ ...s, attention: { ...s.attention, reconcile_after_days: Number(e.target.value) || 31 } })} /></Field>
      </div>
      <SaveBar dirty={dirty} saving={saving} onSave={() => void commit()} disabled={!admin} />
    </Card>
  );
}

function DepartmentsTab() {
  const L = useLookups();
  const { member } = useAppData();
  const save = useSaveRow('departments');
  const [editing, setEditing] = useState<Partial<Department> | null>(null);
  const admin = isAdmin(member);
  return (
    <Card title="Departments" description="Operating departments earn revenue and are measured independently. Non-operating departments (Corporate / Shared) hold company-level costs." action={admin && <Button variant="primary" onClick={() => setEditing({ is_operating: true, color: '#9085e9', sort_order: L.departments.length + 1 })}><Plus /> Add department</Button>} padded={false}>
      <DataTable<Department>
        rows={L.departments}
        rowKey={(d) => d.id}
        onRowClick={admin ? setEditing : undefined}
        columns={[
          { key: 'name', header: 'Department', cell: (d) => <span className="inline-flex items-center gap-2 font-medium"><span className="size-2.5 rounded-full" style={{ background: d.color }} />{d.name}</span> },
          { key: 'code', header: 'Code', cell: (d) => d.code },
          { key: 'type', header: 'Type', cell: (d) => (d.is_operating ? <Badge tone="positive">Operating</Badge> : <Badge>Shared costs</Badge>) },
          { key: 'director', header: 'Director', cell: (d) => d.director_name ?? '—' },
          { key: 'status', header: '', cell: (d) => (d.archived ? <Badge>Archived</Badge> : null) },
        ]}
      />
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)} title={editing.id ? `Edit ${editing.name}` : 'Add department'} footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => {
          try {
            await save.mutateAsync({ id: editing.id, values: { code: editing.code?.toUpperCase(), name: editing.name, is_operating: editing.is_operating, director_name: editing.director_name ?? null, color: editing.color, sort_order: editing.sort_order, archived: editing.archived ?? false } });
            toast.success('Saved');
            setEditing(null);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}>Save</Button></>}>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name"><Input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Code" hint="2–8 capital letters, used in project codes."><Input disabled={!!editing.id} value={editing.code ?? ''} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) })} /></Field>
            <Field label="Director"><Input value={editing.director_name ?? ''} onChange={(e) => setEditing({ ...editing, director_name: e.target.value })} /></Field>
            <Field label="Colour"><Input type="color" value={editing.color ?? '#9085e9'} onChange={(e) => setEditing({ ...editing, color: e.target.value })} className="h-9 p-1" /></Field>
            <label className="flex items-center gap-3 text-[13px]"><Switch checked={!!editing.is_operating} onCheckedChange={(v) => setEditing({ ...editing, is_operating: v })} /> Operating (earns revenue)</label>
            {editing.id && <label className="flex items-center gap-3 text-[13px]"><Switch checked={!!editing.archived} onCheckedChange={(v) => setEditing({ ...editing, archived: v })} /> Archived</label>}
          </div>
        </Dialog>
      )}
    </Card>
  );
}

function CategoriesTab() {
  const L = useLookups();
  const { member } = useAppData();
  const save = useSaveRow('ledger_accounts');
  const [editing, setEditing] = useState<Partial<LedgerAccount> | null>(null);
  const can = canEditChart(member);
  const groups: CategoryGroup[] = ['revenue', 'other_income', 'direct_cost', 'operating', 'payroll', 'income_tax'];
  const nextCode = (g: CategoryGroup) => {
    const base = { revenue: 4000, other_income: 4900, direct_cost: 5000, operating: 6000, payroll: 7000, income_tax: 8000 }[g];
    const used = new Set(L.accounts.map((a) => a.code));
    for (let c = base + 10; c < base + 999; c += 10) if (!used.has(String(c))) return String(c);
    return String(base + 999);
  };
  return (
    <div className="space-y-5">
      <Callout tone="info">Categories replace the workbook&apos;s Lists sheet. <b>Direct project costs</b> count towards project contribution (the workbook hard-coded five names — here it is a setting). Payroll categories can only be used by payroll runs.</Callout>
      {groups.map((g) => {
        const list = L.accounts.filter((a) => a.category_group === g);
        return (
          <Card key={g} title={GROUP_LABELS[g]} action={can && g !== 'payroll' && <Button size="sm" onClick={() => setEditing({ type: g === 'revenue' || g === 'other_income' ? 'income' : 'expense', category_group: g, code: nextCode(g), name: '' })}><Plus /> Add</Button>} padded={false}>
            <DataTable<LedgerAccount>
              rows={list}
              rowKey={(a) => a.id}
              dense
              onRowClick={can ? setEditing : undefined}
              columns={[
                { key: 'code', header: 'Code', width: '80px', cell: (a) => <span className="text-ink-2 tabular">{a.code}</span> },
                { key: 'name', header: 'Name', cell: (a) => <span className={a.archived ? 'text-muted line-through' : ''}>{a.name}</span> },
                { key: 'sys', header: '', align: 'right', cell: (a) => (a.system_key ? <Badge tone="info">Used automatically</Badge> : a.archived ? <Badge>Archived</Badge> : null) },
              ]}
            />
          </Card>
        );
      })}
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)} title={editing.id ? `Edit ${editing.name}` : 'Add category'} footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={async () => {
          if (!editing.name?.trim()) return toast.error('Enter a name.');
          try {
            await save.mutateAsync({ id: editing.id, values: { code: editing.code, name: editing.name.trim(), type: editing.type, category_group: editing.category_group, archived: editing.archived ?? false, currency: null, department_id: null } });
            toast.success('Saved');
            setEditing(null);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}>Save</Button></>}>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name" className="col-span-2"><Input autoFocus value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Code"><Input value={editing.code ?? ''} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></Field>
            <Field label="Group" hint={editing.system_key ? 'Fixed for categories the app uses automatically.' : undefined}>
              <Select disabled={!!editing.system_key} value={editing.category_group ?? 'operating'} onChange={(e) => { const g = e.target.value as CategoryGroup; setEditing({ ...editing, category_group: g, type: g === 'revenue' || g === 'other_income' ? 'income' : 'expense' }); }} options={groups.filter((g) => g !== 'payroll' || editing.category_group === 'payroll').map((g) => ({ value: g, label: GROUP_LABELS[g] }))} />
            </Field>
            {editing.id && !editing.system_key && <label className="flex items-center gap-3 text-[13px]"><Switch checked={!!editing.archived} onCheckedChange={(v) => setEditing({ ...editing, archived: v })} /> Archived (kept for history)</label>}
          </div>
        </Dialog>
      )}
    </div>
  );
}

function TaxTab({ settings }: { settings: CompanySettings }) {
  const { member } = useAppData();
  const L = useLookups();
  const { s, setS, dirty, commit, saving } = useSettingsDraft(settings);
  const admin = isAdmin(member);
  const num = (v: string) => (v === '' ? 0 : Number(v));
  const P = s.payroll;
  const T = s.tax;
  return (
    <div className="space-y-5">
      <Callout tone="caution">These rates come from public sources as of September 2026 and must be confirmed by your accountant. Changing them affects new calculations only; posted entries keep their amounts.</Callout>
      <Card title="Payroll">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Employee EPF %"><Input disabled={!admin} type="number" step="0.5" value={P.employee_epf_pct} onChange={(e) => setS({ ...s, payroll: { ...P, employee_epf_pct: num(e.target.value) } })} /></Field>
          <Field label="Employer EPF %"><Input disabled={!admin} type="number" step="0.5" value={P.employer_epf_pct} onChange={(e) => setS({ ...s, payroll: { ...P, employer_epf_pct: num(e.target.value) } })} /></Field>
          <Field label="Employer ETF %"><Input disabled={!admin} type="number" step="0.5" value={P.employer_etf_pct} onChange={(e) => setS({ ...s, payroll: { ...P, employer_etf_pct: num(e.target.value) } })} /></Field>
          <Field label="APIT monthly tax-free amount"><MoneyInput disabled={!admin} value={P.apit_monthly_relief_minor} onChange={(v) => setS({ ...s, payroll: { ...P, apit_monthly_relief_minor: v ?? 0 } })} /></Field>
        </div>
        <p className="mt-5 mb-2 text-[13px] font-medium text-ink-2">APIT monthly bands (after the tax-free amount)</p>
        <div className="space-y-2">
          {P.apit_bands.map((b, i) => (
            <div key={i} className="grid grid-cols-[200px_120px_36px] items-center gap-3">
              {b.width_minor === null ? <span className="text-[13px] text-ink-2">Remainder</span> : <MoneyInput disabled={!admin} value={b.width_minor} onChange={(v) => setS({ ...s, payroll: { ...P, apit_bands: P.apit_bands.map((x, j) => (j === i ? { ...x, width_minor: v ?? 0 } : x)) } })} />}
              <div className="relative"><Input disabled={!admin} type="number" value={b.rate_pct} onChange={(e) => setS({ ...s, payroll: { ...P, apit_bands: P.apit_bands.map((x, j) => (j === i ? { ...x, rate_pct: num(e.target.value) } : x)) } })} /><span className="absolute top-2 right-3 text-xs text-muted">%</span></div>
              {admin && b.width_minor !== null && P.apit_bands.length > 1 && <Button size="icon-sm" variant="ghost" aria-label="Remove band" onClick={() => setS({ ...s, payroll: { ...P, apit_bands: P.apit_bands.filter((_, j) => j !== i) } })}><Trash2 /></Button>}
            </div>
          ))}
          {admin && <Button size="sm" variant="ghost" onClick={() => setS({ ...s, payroll: { ...P, apit_bands: [...P.apit_bands.slice(0, -1), { width_minor: 4166667, rate_pct: 0 }, P.apit_bands[P.apit_bands.length - 1]] } })}><Plus /> Add band</Button>}
        </div>
      </Card>
      <Card title="Company taxes">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Income tax on profits %" hint="Service exports: 15% from 1 April 2025."><Input disabled={!admin} type="number" value={T.income_tax_pct} onChange={(e) => setS({ ...s, tax: { ...T, income_tax_pct: num(e.target.value) } })} /></Field>
          <Field label="SSCL %"><Input disabled={!admin} type="number" step="0.1" value={T.sscl_pct} onChange={(e) => setS({ ...s, tax: { ...T, sscl_pct: num(e.target.value) } })} /></Field>
          <Field label="VAT %"><Input disabled={!admin} type="number" value={T.vat_pct} onChange={(e) => setS({ ...s, tax: { ...T, vat_pct: num(e.target.value) } })} /></Field>
        </div>
        {(['sscl_thresholds', 'vat_thresholds'] as const).map((k) => (
          <div key={k} className="mt-5">
            <p className="mb-2 text-[13px] font-medium text-ink-2">{k === 'sscl_thresholds' ? 'SSCL' : 'VAT'} registration thresholds</p>
            <div className="space-y-2">
              {T[k].map((t, i) => (
                <div key={i} className="grid grid-cols-[170px_200px_200px_36px] items-center gap-3 text-[13px]">
                  <Input disabled={!admin} type="date" aria-label="Effective from" value={t.effective_from} onChange={(e) => setS({ ...s, tax: { ...T, [k]: T[k].map((x, j) => (j === i ? { ...x, effective_from: e.target.value } : x)) } })} />
                  <MoneyInput disabled={!admin} aria-label="Quarterly" value={t.quarterly_minor} onChange={(v) => setS({ ...s, tax: { ...T, [k]: T[k].map((x, j) => (j === i ? { ...x, quarterly_minor: v ?? 0 } : x)) } })} />
                  <MoneyInput disabled={!admin} aria-label="Annual" value={t.annual_minor} onChange={(v) => setS({ ...s, tax: { ...T, [k]: T[k].map((x, j) => (j === i ? { ...x, annual_minor: v ?? 0 } : x)) } })} />
                  {admin && T[k].length > 1 && <Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => setS({ ...s, tax: { ...T, [k]: T[k].filter((_, j) => j !== i) } })}><Trash2 /></Button>}
                </div>
              ))}
              <p className="text-xs text-muted">Columns: effective from · per quarter · per year.</p>
              {admin && <Button size="sm" variant="ghost" onClick={() => setS({ ...s, tax: { ...T, [k]: [...T[k], { effective_from: today(), quarterly_minor: T[k].at(-1)?.quarterly_minor ?? 0, annual_minor: T[k].at(-1)?.annual_minor ?? 0 }] } })}><Plus /> Add change</Button>}
            </div>
          </div>
        ))}
      </Card>
      <Card title="Shared-cost allocation" description="How Corporate / Shared costs are spread over departments in the “fully loaded” view. Nothing is posted.">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Method"><Select disabled={!admin} value={s.allocation.method} onChange={(e) => setS({ ...s, allocation: { ...s.allocation, method: e.target.value as CompanySettings['allocation']['method'] } })} options={[{ value: 'none', label: 'Do not allocate' }, { value: 'revenue_share', label: 'By share of revenue' }, { value: 'fixed', label: 'Fixed percentages' }]} /></Field>
          {s.allocation.method === 'fixed' && L.departments.filter((d) => d.is_operating).map((d) => (
            <Field key={d.id} label={`${d.name} %`}><Input disabled={!admin} type="number" value={s.allocation.fixed_pct[d.id] ?? ''} onChange={(e) => setS({ ...s, allocation: { ...s.allocation, fixed_pct: { ...s.allocation.fixed_pct, [d.id]: num(e.target.value) } } })} /></Field>
          ))}
        </div>
      </Card>
      <SaveBar dirty={dirty} saving={saving} onSave={() => void commit()} disabled={!admin} />
    </div>
  );
}

function RulesTab() {
  const L = useLookups();
  const { member } = useAppData();
  const rules = useTable('categorisation_rules', { order: { column: 'priority' } });
  const save = useSaveRow('categorisation_rules');
  const qc = useQueryClient();
  const repo = useRepo();
  const [editing, setEditing] = useState<Partial<CategorisationRule> | null>(null);
  const can = canEditMaster(member);
  return (
    <Card title="Auto-categorise" description="When a description or contact contains the text, the category (and optionally contact, department and project) is filled in for you — in Quick Add and when creating entries from a bank statement." action={can && <Button variant="primary" onClick={() => setEditing({ applies_to: 'expense', priority: 100, active: true, match_text: '', name: '' })}><Plus /> Add rule</Button>} padded={false}>
      <DataTable<CategorisationRule>
        rows={rules.data ?? []}
        rowKey={(r) => r.id}
        onRowClick={can ? setEditing : undefined}
        columns={[
          { key: 'text', header: 'When text contains', cell: (r) => <code className="rounded bg-surface-3 px-1.5 py-0.5 text-xs">{r.match_text}</code> },
          { key: 'for', header: 'For', cell: (r) => ({ income: 'Money in', expense: 'Money out', any: 'Both' })[r.applies_to] },
          { key: 'cat', header: 'Use category', cell: (r) => L.accountMap.get(r.account_id ?? '')?.name ?? '—' },
          { key: 'dept', header: 'Department', cell: (r) => L.deptMap.get(r.department_id ?? '')?.name ?? '—' },
          { key: 'active', header: '', cell: (r) => (r.active ? null : <Badge>Off</Badge>) },
        ]}
      />
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)} title={editing.id ? 'Edit rule' : 'Add rule'} footer={<>
          {editing.id && <Button variant="ghost" className="mr-auto text-negative" onClick={async () => { await repo.remove('categorisation_rules', editing.id!); await qc.invalidateQueries({ queryKey: ['categorisation_rules'] }); setEditing(null); }}><Trash2 /> Delete</Button>}
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="primary" onClick={async () => {
            if (!editing.match_text?.trim()) return toast.error('Enter the text to look for.');
            try {
              await save.mutateAsync({ id: editing.id, values: { name: editing.name || editing.match_text, match_text: editing.match_text.trim(), applies_to: editing.applies_to ?? 'any', account_id: editing.account_id ?? null, party_id: editing.party_id ?? null, department_id: editing.department_id ?? null, project_id: editing.project_id ?? null, priority: editing.priority ?? 100, active: editing.active ?? true } });
              setEditing(null);
            } catch (e) {
              toast.error(errorMessage(e));
            }
          }}>Save</Button></>}>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Text to look for" hint="Not case-sensitive, e.g. “autodesk”"><Input autoFocus value={editing.match_text ?? ''} onChange={(e) => setEditing({ ...editing, match_text: e.target.value })} /></Field>
            <Field label="Applies to"><Select value={editing.applies_to} onChange={(e) => setEditing({ ...editing, applies_to: e.target.value as CategorisationRule['applies_to'] })} options={[{ value: 'expense', label: 'Money out' }, { value: 'income', label: 'Money in' }, { value: 'any', label: 'Both' }]} /></Field>
            <Field label="Category"><Combobox options={categoryOptions(L.accounts, editing.applies_to === 'income' ? ['revenue', 'other_income'] : editing.applies_to === 'expense' ? ['direct_cost', 'operating'] : ['revenue', 'other_income', 'direct_cost', 'operating'])} value={editing.account_id ?? null} onChange={(v) => setEditing({ ...editing, account_id: v })} /></Field>
            <Field label="Contact (optional)"><Combobox options={partyOptions(L.parties, ['client', 'vendor'])} value={editing.party_id ?? null} onChange={(v) => setEditing({ ...editing, party_id: v })} allowClear /></Field>
            <Field label="Department (optional)"><Select value={editing.department_id ?? ''} onChange={(e) => setEditing({ ...editing, department_id: e.target.value || null })} options={L.departments.map((d) => ({ value: d.id, label: d.name }))} placeholder="—" /></Field>
            <Field label="Project (optional)"><Combobox options={projectOptions(L.projects, editing.department_id)} value={editing.project_id ?? null} onChange={(v) => setEditing({ ...editing, project_id: v })} allowClear /></Field>
            <Field label="Priority" hint="Lower numbers are checked first."><Input type="number" value={editing.priority ?? 100} onChange={(e) => setEditing({ ...editing, priority: Number(e.target.value) })} /></Field>
            <label className="flex items-center gap-3 self-end text-[13px]"><Switch checked={editing.active ?? true} onCheckedChange={(v) => setEditing({ ...editing, active: v })} /> Active</label>
          </div>
        </Dialog>
      )}
    </Card>
  );
}

function UsersTab() {
  const members = useMembers();
  const L = useLookups();
  const { member } = useAppData();
  const setMember = useSetMember();
  const admin = isAdmin(member);
  if (members.isLoading) return <Spinner />;
  const pending = (members.data ?? []).filter((m) => !m.role && m.active);
  return (
    <div className="space-y-5">
      {pending.length > 0 && admin && <Callout tone="caution" title={`${pending.length} person(s) waiting for access`}>Choose a role for each new sign-up below. Directors can record entries for their own department (and shared costs) and see everything.</Callout>}
      <Card title="Users" description="People sign up from the app's login screen with their work email; an admin then gives them a role here." padded={false}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="px-5 py-2.5 text-left font-medium">Person</th>
              <th className="px-3 py-2.5 text-left font-medium">Role</th>
              <th className="px-3 py-2.5 text-left font-medium">Department</th>
              <th className="px-5 py-2.5 text-left font-medium">Access</th>
            </tr>
          </thead>
          <tbody>
            {(members.data ?? []).map((m) => (
              <tr key={m.user_id} className={cn('border-b border-line last:border-0', !m.role && 'bg-caution-soft/40')}>
                <td className="px-5 py-2.5"><p className="font-medium">{m.full_name ?? m.email}</p><p className="text-xs text-muted">{m.email}{m.user_id === member?.user_id ? ' · you' : ''}</p></td>
                <td className="px-3 py-2.5">
                  <Select aria-label={`Role for ${m.email}`} className="w-56" disabled={!admin} value={m.role ?? ''} onChange={(e) => {
                    const role = (e.target.value || null) as Role | null;
                    const dept = role === 'director' ? m.department_id ?? L.departments.find((d) => d.is_operating)?.id ?? null : null;
                    setMember.mutateAsync({ userId: m.user_id, role, departmentId: dept, active: m.active }).then(() => toast.success('Updated')).catch((err) => toast.error(errorMessage(err)));
                  }} options={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))} placeholder="Waiting for approval" />
                </td>
                <td className="px-3 py-2.5">
                  {m.role === 'director' ? (
                    <Select aria-label={`Department for ${m.email}`} className="w-48" disabled={!admin} value={m.department_id ?? ''} onChange={(e) => setMember.mutateAsync({ userId: m.user_id, role: m.role, departmentId: e.target.value, active: m.active }).then(() => toast.success('Updated')).catch((err) => toast.error(errorMessage(err)))} options={L.departments.filter((d) => d.is_operating).map((d) => ({ value: d.id, label: d.name }))} />
                  ) : <span className="text-muted">{m.role === 'admin' || m.role === 'bookkeeper' ? 'All departments' : '—'}</span>}
                </td>
                <td className="px-5 py-2.5">
                  <label className="flex items-center gap-2"><Switch disabled={!admin || m.user_id === member?.user_id} checked={m.active} onCheckedChange={(v) => setMember.mutateAsync({ userId: m.user_id, role: m.role, departmentId: m.department_id, active: v }).catch((err) => toast.error(errorMessage(err)))} aria-label={`Access for ${m.email}`} />{m.active ? 'On' : 'Off'}</label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="What each role can do">
        <ul className="grid grid-cols-2 gap-3 text-[13px] text-ink-2">
          <li><b className="text-ink">Admin</b> — everything, including users, settings, categories and the month lock.</li>
          <li><b className="text-ink">Department director</b> — records income, costs, payroll, invoices and budgets for their department and for shared costs; pays only from their department&apos;s accounts; sees all reports.</li>
          <li><b className="text-ink">Bookkeeper</b> — records entries for every department and maintains contacts and categories; no settings or users.</li>
          <li><b className="text-ink">Read-only (accountant)</b> — sees everything and exports reports; cannot change anything.</li>
        </ul>
      </Card>
    </div>
  );
}

function LockTab() {
  const lock = usePeriodLock();
  const setLock = useSetPeriodLock();
  const { member } = useAppData();
  const admin = isAdmin(member);
  const lastMonthEnd = monthEnd(addMonths(monthStart(today()), -1));
  const [date, setDate] = useState(lastMonthEnd);
  const [confirm, setConfirm] = useState<'lock' | 'unlock' | null>(null);
  return (
    <Card title="Month lock (period close)" description="After a month is reconciled and reviewed, lock it so nobody can add, change or void entries dated in it. Reports then stay exactly as they were sent to the accountant.">
      <div className="flex items-center gap-4 rounded-lg bg-surface-2 p-4">
        {lock.data ? <Lock className="size-5 text-caution" /> : <Unlock className="size-5 text-muted" />}
        <div>
          <p className="font-semibold">{lock.data ? `Locked up to and including ${formatDate(lock.data)}` : 'No months are locked'}</p>
          <p className="text-[13px] text-ink-2">Only an admin can lock or unlock. Every change is recorded in the audit log.</p>
        </div>
      </div>
      {admin && (
        <div className="mt-5 flex flex-wrap items-end gap-3">
          <Field label="Lock everything up to"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-48" /></Field>
          <Button variant="primary" onClick={() => setConfirm('lock')}><Lock /> Lock</Button>
          {lock.data && <Button onClick={() => setConfirm('unlock')}><Unlock /> Unlock all</Button>}
        </div>
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'lock' ? `Lock the books up to ${formatDate(date)}?` : 'Unlock all months?'}
        body={confirm === 'lock' ? 'Entries dated on or before this day cannot be added, edited or voided until an admin unlocks.' : 'Anyone with permission will be able to change past entries again.'}
        confirmLabel={confirm === 'lock' ? 'Lock' : 'Unlock'}
        danger={confirm === 'unlock'}
        onConfirm={async () => {
          try {
            await setLock.mutateAsync(confirm === 'lock' ? date : null);
            toast.success(confirm === 'lock' ? 'Books locked' : 'Books unlocked');
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </Card>
  );
}

function DataTab() {
  const { mode, resetDemo, member } = useAppData();
  const [importing, setImporting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <div className="space-y-5">
      <Card title="Import the Excel tracker" description="Bring in accounts, projects, income, expenses, payroll and transfers from the “AptoCAD Department Finance Tracker” workbook. You will see a preview and any problem rows before anything is saved.">
        <Button variant="primary" disabled={!isAdmin(member)} onClick={() => setImporting(true)}><Upload /> Choose workbook…</Button>
        {!isAdmin(member) && <p className="mt-2 text-xs text-muted">Only an admin can import.</p>}
      </Card>
      <Card title="Export">
        <p className="text-[13px] text-ink-2">Every list has an Excel button, and Reports → Accountant&apos;s pack exports a full year (trial balance, P&amp;L, general ledger, payroll register, invoices and bills) in one workbook.</p>
      </Card>
      <Card title="Backups">
        <p className="text-[13px] text-ink-2">{mode === 'demo' ? 'Demo data lives only on this PC.' : 'The company database is hosted by Supabase. Turn on daily backups (and point-in-time recovery if available) in the Supabase dashboard → Database → Backups, and export the accountant pack monthly as an offline copy. See docs/SETUP.md.'}</p>
      </Card>
      {mode === 'demo' && (
        <Card title="Demo data">
          <Button onClick={() => setConfirmReset(true)}><RotateCcw /> Reset demo data</Button>
          <ConfirmDialog open={confirmReset} onOpenChange={setConfirmReset} title="Reset the demo?" body="All demo changes are discarded and fresh sample data is generated." confirmLabel="Reset" danger onConfirm={async () => { await resetDemo(); toast.success('Demo data reset'); }} />
        </Card>
      )}
      {importing && <WorkbookImport onClose={() => setImporting(false)} />}
    </div>
  );
}

function HelpTab() {
  const { mode } = useAppData();
  const rows: [string, ReactNode][] = [
    ['New entry', <><Kbd>Ctrl N</Kbd></>],
    ['New money in / money out / move money', <><Kbd>Ctrl Shift I</Kbd> <Kbd>Ctrl Shift E</Kbd> <Kbd>Ctrl Shift T</Kbd></>],
    ['Save and start another', <Kbd>Ctrl Enter</Kbd>],
    ['Save and close', <Kbd>Ctrl Shift Enter</Kbd>],
    ['Attach a screenshot of a receipt', <><Kbd>Ctrl V</Kbd> in the entry form</>],
  ];
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Card title={<span className="inline-flex items-center gap-2"><Keyboard className="size-4" />Keyboard shortcuts</span>}>
        <table className="w-full text-[13px]"><tbody>{rows.map(([a, b]) => <tr key={a} className="border-b border-line last:border-0"><td className="py-2.5 text-ink-2">{a}</td><td className="py-2.5 text-right">{b}</td></tr>)}</tbody></table>
      </Card>
      <Card title="How things are recorded">
        <ul className="list-disc space-y-2 pl-5 text-[13px] text-ink-2">
          <li><b className="text-ink">Money in</b> is recorded at the gross amount earned; a platform fee (e.g. Upwork) is a separate cost, so fees stay visible.</li>
          <li><b className="text-ink">Move money</b> covers withdrawals (Payoneer → bank), card payments and department transfers. Transfers never change profit; currency conversions book the realised exchange gain or loss.</li>
          <li><b className="text-ink">Pending</b> entries do not count until cleared. <b className="text-ink">Void</b> keeps the record but removes it from totals.</li>
          <li><b className="text-ink">Payroll</b> posts the full cost on payday; EPF, ETF and APIT are owed until you record the statutory payment.</li>
          <li>Full details: docs/ACCOUNTING.md.</li>
        </ul>
      </Card>
      <Card title="About">
        <p className="text-[13px] text-ink-2">AptoCAD Finance v{__APP_VERSION__} · reports in LKR · data {mode === 'demo' ? 'stored on this PC (demo)' : 'stored in your Supabase project'}.</p>
      </Card>
    </div>
  );
}
