import { FileSpreadsheet, FolderKanban, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { Badge, Card, EmptyState, PageHeader, Spinner, Tabs } from '@/components/ui/misc';
import { formatMoney, formatPct, isValidRate } from '@/domain/money';
import { projectFigures, type ProjectFigures } from '@/domain/reports';
import type { Project, ProjectStatus } from '@/domain/types';
import { useAppData } from '@/data/context';
import { useLookups, useSaveRow } from '@/data/hooks';
import { canEditMaster, canWriteDepartment } from '@/data/permissions';
import { errorMessage } from '@/lib/cn';
import { exportWorkbook, xl } from '@/lib/excel';
import { usePeriod, useUi } from '@/app/ui-state';
import { MarginBar } from '../dashboard/Dashboard';
import { DeptTag } from '../shared/bits';
import { partyOptions } from '../shared/options';
import { useReportData } from '../shared/useFinance';

export const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: 'neutral' | 'positive' | 'caution' | 'info' | 'negative' }> = {
  lead: { label: 'Lead', tone: 'info' },
  active: { label: 'Active', tone: 'positive' },
  on_hold: { label: 'On hold', tone: 'caution' },
  completed: { label: 'Completed', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'negative' },
};

export default function ProjectsPage() {
  const { L, rows, ctx, rates, loading } = useReportData();
  const { member } = useAppData();
  const { dept } = useUi();
  const { range } = usePeriod();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'open' | 'all'>('open');
  const [scope, setScope] = useState<'lifetime' | 'period'>('lifetime');
  const [editing, setEditing] = useState<Project | 'new' | null>(null);
  const figures = useMemo(() => projectFigures(rows, L.projects, ctx, scope === 'period' ? { range } : {}, rates), [rows, L.projects, ctx, rates, scope, range]);
  const list = figures.filter((f) => (dept === 'all' || f.project.department_id === dept) && (tab === 'all' || !['completed', 'cancelled'].includes(f.project.status)) && !f.project.archived);
  if (loading) return <Spinner />;

  const columns: Column<ProjectFigures>[] = [
    { key: 'name', header: 'Project', cell: (f) => (<div><p className="font-medium text-ink">{f.project.name}</p><p className="text-xs text-muted">{f.project.code} · {L.partyMap.get(f.project.client_id ?? '')?.name ?? 'No client'}</p></div>), sort: (f) => f.project.code },
    { key: 'dept', header: 'Department', cell: (f) => <DeptTag dept={L.deptMap.get(f.project.department_id)} />, sort: (f) => f.project.department_id },
    { key: 'status', header: 'Status', cell: (f) => <Badge tone={PROJECT_STATUS[f.project.status].tone}>{PROJECT_STATUS[f.project.status].label}</Badge>, sort: (f) => f.project.status },
    { key: 'contract', header: 'Contract (LKR)', align: 'right', cell: (f) => (f.contractValueLkr === null ? <span className="text-muted">—</span> : formatMoney(f.contractValueLkr, 'LKR', { plain: true, whole: true })), sort: (f) => f.contractValueLkr ?? 0 },
    { key: 'revenue', header: 'Received', align: 'right', cell: (f) => (<span>{formatMoney(f.revenue, 'LKR', { plain: true, whole: true })}{f.receivedPct !== null && <span className="block text-xs whitespace-nowrap text-muted">{formatPct(f.receivedPct, 0)} of contract</span>}</span>), sort: (f) => f.revenue },
    { key: 'direct', header: 'Direct costs', align: 'right', cell: (f) => formatMoney(f.directCosts, 'LKR', { plain: true, whole: true }), sort: (f) => f.directCosts },
    { key: 'payroll', header: 'Payroll', align: 'right', cell: (f) => formatMoney(f.payroll, 'LKR', { plain: true, whole: true }), sort: (f) => f.payroll },
    { key: 'contribution', header: 'Contribution', align: 'right', cell: (f) => <span className={f.contribution < 0 ? 'font-semibold text-negative' : 'font-semibold'}>{formatMoney(f.contribution, 'LKR', { plain: true, whole: true, brackets: true })}</span>, sort: (f) => f.contribution },
    { key: 'margin', header: 'Margin', cell: (f) => <div className="w-32"><MarginBar value={f.margin} /></div>, sort: (f) => f.margin ?? -99 },
  ];
  const total = (k: 'revenue' | 'directCosts' | 'payroll' | 'contribution') => list.reduce((s, f) => s + f[k], 0);

  return (
    <>
      <PageHeader
        title="Projects"
        description="Contribution = revenue − direct project costs − payroll allocated to the project (as in the Excel Projects sheet)."
        actions={
          <>
            <Select aria-label="Scope" className="w-48" value={scope} onChange={(e) => setScope(e.target.value as 'lifetime' | 'period')} options={[{ value: 'lifetime', label: 'Project to date' }, { value: 'period', label: 'Selected period only' }]} />
            <Button onClick={() => void exportWorkbook('projects.xlsx', [{ name: 'Projects', title: 'Project profitability', columns: [{ header: 'Code', key: 'code', width: 14 }, { header: 'Project', key: 'name', width: 40 }, { header: 'Department', key: 'dept', width: 16 }, { header: 'Client', key: 'client', width: 28 }, { header: 'Status', key: 'status', width: 12 }, { header: 'Contract LKR', key: 'contract', type: 'money' }, { header: 'Revenue LKR', key: 'revenue', type: 'money' }, { header: 'Direct costs', key: 'direct', type: 'money' }, { header: 'Payroll', key: 'payroll', type: 'money' }, { header: 'Contribution', key: 'contribution', type: 'money' }, { header: 'Margin', key: 'margin', type: 'pct' }], rows: list.map((f) => ({ code: f.project.code, name: f.project.name, dept: L.deptMap.get(f.project.department_id)?.name, client: L.partyMap.get(f.project.client_id ?? '')?.name ?? '', status: PROJECT_STATUS[f.project.status].label, contract: xl(f.contractValueLkr), revenue: xl(f.revenue), direct: xl(f.directCosts), payroll: xl(f.payroll), contribution: xl(f.contribution), margin: f.margin })) }])}>
              <FileSpreadsheet /> Export
            </Button>
            {canEditMaster(member) && (
              <Button variant="primary" onClick={() => setEditing('new')}>
                <Plus /> New project
              </Button>
            )}
          </>
        }
      />
      <Card padded={false}>
        <div className="px-5 pt-2">
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} listClassName="border-b-0" />
        </div>
        <div className="border-t border-line">
          <DataTable
            rows={list}
            columns={columns}
            rowKey={(f) => f.project.id}
            initialSort={{ key: 'revenue', desc: true }}
            onRowClick={(f) => navigate(`/projects/${f.project.id}`)}
            empty={<EmptyState icon={<FolderKanban />} title="No projects yet" body="Create a project for each client job so income, direct costs and payroll roll up automatically." action={canEditMaster(member) && <Button variant="primary" onClick={() => setEditing('new')}><Plus /> New project</Button>} />}
            footer={
              <tr>
                <td className="px-5 py-2.5 text-[13px]" colSpan={4}>Total · {list.length} projects</td>
                <td className="px-3 py-2.5 text-right text-[13px] tabular">{formatMoney(total('revenue'), 'LKR', { plain: true, whole: true })}</td>
                <td className="px-3 py-2.5 text-right text-[13px] tabular">{formatMoney(total('directCosts'), 'LKR', { plain: true, whole: true })}</td>
                <td className="px-3 py-2.5 text-right text-[13px] tabular">{formatMoney(total('payroll'), 'LKR', { plain: true, whole: true })}</td>
                <td className="px-3 py-2.5 text-right text-[13px] tabular">{formatMoney(total('contribution'), 'LKR', { plain: true, whole: true, brackets: true })}</td>
                <td className="px-5 py-2.5" />
              </tr>
            }
          />
        </div>
      </Card>
      {editing && <ProjectDialog project={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

export function ProjectDialog({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const L = useLookups();
  const { member } = useAppData();
  const save = useSaveRow('projects');
  const [v, setV] = useState<Partial<Project>>(
    project ?? { department_id: member?.department_id ?? L.departments.find((d) => d.is_operating)?.id, name: '', status: 'active', contract_currency: 'USD', contract_value_minor: null, planning_fx_rate: null, client_id: null, channel: null, pricing_type: 'Fixed Price', country: null, site: null, start_date: null, target_date: null, notes: null },
  );
  const submit = async () => {
    if (!v.name?.trim()) return toast.error('Give the project a name.');
    if (v.planning_fx_rate && !isValidRate(v.planning_fx_rate)) return toast.error('The planning rate must be a positive number.');
    try {
      const { id: _id, code, created_at: _c, updated_at: _u, ...values } = v as Project & { created_at?: string; updated_at?: string };
      void _id; void _c; void _u;
      await save.mutateAsync({ id: project?.id, values: { ...values, code: project ? code : undefined, planning_fx_rate: values.contract_currency === 'LKR' ? '1' : values.planning_fx_rate || null } as Partial<Project> });
      toast.success(project ? 'Project updated' : 'Project created');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={project ? `Edit ${project.code}` : 'New project'} size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => void submit()}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Project / site name" className="col-span-2">
          <Input autoFocus value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Smith Residence — permit set" />
        </Field>
        <Field label="Department" hint={project ? undefined : 'Project codes are assigned automatically (e.g. CIV-P-0007).'}>
          <Select value={v.department_id ?? ''} disabled={!!project} onChange={(e) => setV({ ...v, department_id: e.target.value })} options={L.departments.filter((d) => d.is_operating).map((d) => ({ value: d.id, label: d.name, disabled: !canWriteDepartment(member, d.id, L.departments) }))} />
        </Field>
        <Field label="Client">
          <Combobox options={partyOptions(L.parties, ['client'])} value={v.client_id ?? null} onChange={(c) => setV({ ...v, client_id: c, country: v.country ?? L.partyMap.get(c ?? '')?.country ?? null })} allowClear placeholder="Choose client" />
        </Field>
        <Field label="Status">
          <Select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as ProjectStatus })} options={Object.entries(PROJECT_STATUS).map(([value, s]) => ({ value, label: s.label }))} />
        </Field>
        <Field label="Revenue channel">
          <Select value={v.channel ?? ''} onChange={(e) => setV({ ...v, channel: e.target.value || null })} options={(L.settings?.lists.channels ?? []).map((c) => ({ value: c, label: c }))} placeholder="—" />
        </Field>
        <Field label="Contract currency">
          <Select value={v.contract_currency} onChange={(e) => setV({ ...v, contract_currency: e.target.value })} options={(L.settings?.currencies ?? ['USD']).map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label="Contract value">
          <MoneyInput currency={v.contract_currency ?? 'USD'} value={v.contract_value_minor ?? null} onChange={(m) => setV({ ...v, contract_value_minor: m })} placeholder="Optional" />
        </Field>
        {v.contract_currency !== 'LKR' && (
          <Field label={`Planning rate ${v.contract_currency} → LKR`} hint="Used only to show the contract value in LKR.">
            <Input value={v.planning_fx_rate ?? ''} onChange={(e) => setV({ ...v, planning_fx_rate: e.target.value.replace(/[^\d.]/g, '') || null })} placeholder="e.g. 300" />
          </Field>
        )}
        <Field label="Pricing type">
          <Select value={v.pricing_type ?? ''} onChange={(e) => setV({ ...v, pricing_type: e.target.value || null })} options={(L.settings?.lists.pricing_types ?? []).map((c) => ({ value: c, label: c }))} placeholder="—" />
        </Field>
        <Field label="Country">
          <Input value={v.country ?? ''} onChange={(e) => setV({ ...v, country: e.target.value || null })} />
        </Field>
        <Field label="Start date">
          <Input type="date" value={v.start_date ?? ''} onChange={(e) => setV({ ...v, start_date: e.target.value || null })} />
        </Field>
        <Field label="Target delivery">
          <Input type="date" value={v.target_date ?? ''} onChange={(e) => setV({ ...v, target_date: e.target.value || null })} />
        </Field>
        <Field label="Notes" className="col-span-2">
          <Textarea value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.target.value || null })} />
        </Field>
      </div>
    </Dialog>
  );
}

