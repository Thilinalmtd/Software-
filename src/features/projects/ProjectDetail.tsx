import { ArrowLeft, Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Badge, Card, EmptyState, PageHeader, Spinner, StatTile } from '@/components/ui/misc';
import { formatMoney, formatPct } from '@/domain/money';
import { formatDate } from '@/domain/period';
import { GROUP_LABELS, projectFigures } from '@/domain/reports';
import type { LedgerRow } from '@/domain/types';
import { useAppData } from '@/data/context';
import { useTable } from '@/data/hooks';
import { canEditMaster } from '@/data/permissions';
import { DeptTag, KindBadge } from '../shared/bits';
import { useReportData } from '../shared/useFinance';
import { PROJECT_STATUS, ProjectDialog } from './ProjectsPage';

export default function ProjectDetail() {
  const { id } = useParams();
  const { L, rows, ctx, rates, loading } = useReportData();
  const invoices = useTable('invoices');
  const { member } = useAppData();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const project = L.projectMap.get(id ?? '');
  const [fig] = useMemo(() => (project ? projectFigures(rows, [project], ctx, {}, rates) : []), [project, rows, ctx, rates]);
  const lines = useMemo(() => rows.filter((r) => r.project_id === id && r.status !== 'void' && r.role !== 'money' && ['income', 'expense'].includes(L.accountMap.get(r.account_id)?.type ?? '')), [rows, id, L.accountMap]);
  if (loading) return <Spinner />;
  if (!project || !fig) return <EmptyState title="Project not found" />;
  const projInvoices = (invoices.data ?? []).filter((i) => i.project_id === project.id);
  const status = PROJECT_STATUS[project.status];

  return (
    <>
      <PageHeader
        title={project.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {project.code} · <DeptTag dept={L.deptMap.get(project.department_id)} /> · {L.partyMap.get(project.client_id ?? '')?.name ?? 'No client'} <Badge tone={status.tone}>{status.label}</Badge>
          </span>
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate('/projects')}><ArrowLeft /> Projects</Button>
            {canEditMaster(member) && <Button onClick={() => setEditing(true)}><Pencil /> Edit</Button>}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-5">
        <StatTile label="Contract value" value={fig.contractValueLkr === null ? '—' : formatMoney(fig.contractValueLkr, 'LKR', { compact: true })} foot={project.contract_value_minor ? formatMoney(project.contract_value_minor, project.contract_currency) : undefined} />
        <StatTile label="Revenue received" value={formatMoney(fig.revenue, 'LKR', { compact: true })} foot={fig.receivedPct !== null ? `${formatPct(fig.receivedPct, 0)} of contract` : undefined} />
        <StatTile label="Direct costs" value={formatMoney(fig.directCosts, 'LKR', { compact: true })} foot={fig.otherCosts ? `+ ${formatMoney(fig.otherCosts, 'LKR', { compact: true })} other tagged costs` : undefined} />
        <StatTile label="Payroll allocated" value={formatMoney(fig.payroll, 'LKR', { compact: true })} />
        <StatTile label="Contribution" tone={fig.contribution < 0 ? 'negative' : 'neutral'} value={formatMoney(fig.contribution, 'LKR', { compact: true })} foot={`Margin ${formatPct(fig.margin)}`} />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Income and costs tagged to this project" padded={false}>
          <DataTable<LedgerRow>
            rows={lines}
            rowKey={(r) => r.id}
            initialSort={{ key: 'date', desc: true }}
            onRowClick={(r) => navigate(`/entries?id=${r.entry_id}`)}
            empty={<EmptyState title="Nothing recorded against this project yet" body="Choose this project when recording income, direct costs or payroll." />}
            columns={[
              { key: 'date', header: 'Date', cell: (r) => <span className="text-ink-2 tabular">{formatDate(r.date)}</span>, sort: (r) => r.date, width: '110px' },
              { key: 'desc', header: 'Description', cell: (r) => (<div><p>{r.entry_description}</p><p className="text-xs text-muted">{r.entry_number}</p></div>) },
              { key: 'cat', header: 'Category', cell: (r) => (<div><p className="text-ink-2">{L.accountMap.get(r.account_id)?.name}</p><p className="text-xs text-muted">{GROUP_LABELS[L.accountMap.get(r.account_id)?.category_group ?? 'operating']}</p></div>) },
              { key: 'kind', header: 'Type', cell: (r) => <KindBadge kind={r.kind} /> },
              { key: 'lkr', header: 'LKR', align: 'right', cell: (r) => { const income = L.accountMap.get(r.account_id)?.type === 'income'; return <span className={income ? 'text-positive' : 'text-ink'}>{formatMoney(-r.amount_lkr_minor, 'LKR', { plain: true, signed: true })}</span>; }, sort: (r) => r.amount_lkr_minor },
            ]}
          />
        </Card>
        <Card title="Invoices & quotes" padded={false}>
          {projInvoices.length === 0 ? (
            <EmptyState className="py-8" title="No invoices" action={<Button size="sm" onClick={() => navigate('/invoices')}>Go to invoices</Button>} />
          ) : (
            <ul className="divide-y divide-line">
              {projInvoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between px-5 py-3 text-[13px]">
                  <span>
                    <span className="block font-medium text-ink">{i.number}</span>
                    <span className="text-xs text-muted">{formatDate(i.issue_date)} · {i.kind}</span>
                  </span>
                  <span className="text-right">
                    <span className="block tabular">{formatMoney(i.total_minor, i.currency)}</span>
                    <Badge tone={i.status === 'paid' ? 'positive' : i.status === 'void' ? 'negative' : 'neutral'}>{i.status}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {editing && <ProjectDialog project={project} onClose={() => setEditing(false)} />}
    </>
  );
}
