import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, History, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Input, Select } from '@/components/ui/form';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '@/components/ui/misc';
import type { AuditEvent } from '@/domain/types';
import { useRepo } from '@/data/context';
import { cn } from '@/lib/cn';

const TABLE_LABELS: Record<string, string> = {
  entries: 'Entry',
  ledger_accounts: 'Account / category',
  parties: 'Contact',
  projects: 'Project',
  invoices: 'Invoice',
  bills: 'Bill',
  budgets: 'Budget',
  recurring_templates: 'Recurring item',
  categorisation_rules: 'Rule',
  company_settings: 'Settings',
  members: 'User',
  departments: 'Department',
  period_lock: 'Month lock',
  payroll_runs: 'Payroll run',
  attachments: 'Attachment',
  statement_lines: 'Statement line',
  statement_imports: 'Statement import',
  invoice_items: 'Invoice line',
  payslips: 'Payslip',
};

const ACTION_TONE: Record<string, 'positive' | 'info' | 'negative' | 'caution' | 'neutral'> = { post: 'positive', insert: 'positive', update: 'info', void: 'negative', delete: 'negative' };

function summary(e: AuditEvent): string {
  const a = (e.after ?? e.before ?? {}) as Record<string, unknown>;
  return String(a.number ?? a.name ?? a.description ?? a.email ?? a.code ?? (e.table_name === 'period_lock' ? `locked through ${(e.after as { locked_through?: string } | null)?.locked_through ?? 'nothing'}` : e.record_id));
}

function changedKeys(e: AuditEvent): string[] {
  if (!e.before || !e.after) return [];
  const keys = new Set([...Object.keys(e.before), ...Object.keys(e.after)]);
  return [...keys].filter((k) => !['updated_at', 'updated_by', 'lines'].includes(k) && JSON.stringify(e.before![k]) !== JSON.stringify(e.after![k]));
}

export default function AuditPage() {
  const repo = useRepo();
  const navigate = useNavigate();
  const events = useQuery({ queryKey: ['audit_events', 'all'], queryFn: () => repo.list('audit_events', { order: { column: 'at', ascending: false }, limit: 2000 }) });
  const [table, setTable] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const list = useMemo(() => (events.data ?? []).filter((e) => (!table || e.table_name === table) && (!q || `${summary(e)} ${e.user_email ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [events.data, table, q]);
  if (events.isLoading) return <Spinner />;
  return (
    <>
      <PageHeader title="Audit log" description="Every change to entries, master data, settings, users and the month lock — who, when, and what changed. It cannot be edited." />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2 px-5 py-3">
          <div className="relative w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input aria-label="Search audit log" className="pl-9" placeholder="Search number, name, person…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select aria-label="Record type" className="w-52" value={table} onChange={(e) => setTable(e.target.value)} options={Object.entries(TABLE_LABELS).map(([value, label]) => ({ value, label }))} placeholder="All record types" />
          <span className="ml-auto text-xs text-muted">Showing the latest {list.length.toLocaleString()} changes</span>
        </div>
        {list.length === 0 ? (
          <EmptyState icon={<History />} title="No changes recorded" />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((e) => {
              const changed = changedKeys(e);
              const expanded = open === e.id;
              return (
                <li key={e.id}>
                  <button type="button" className="grid w-full cursor-pointer grid-cols-[20px_170px_120px_1fr_auto] items-center gap-3 px-5 py-2.5 text-left text-[13px] hover:bg-surface-2" onClick={() => setOpen(expanded ? null : e.id)}>
                    {expanded ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />}
                    <span className="text-ink-2 tabular">{new Date(e.at).toLocaleString()}</span>
                    <span><Badge tone={ACTION_TONE[e.action] ?? 'neutral'}>{e.action}</Badge></span>
                    <span className="min-w-0 truncate">
                      <span className="text-muted">{TABLE_LABELS[e.table_name] ?? e.table_name} · </span>
                      <span className="font-medium text-ink">{summary(e)}</span>
                      {changed.length > 0 && <span className="text-muted"> — {changed.slice(0, 4).join(', ')}{changed.length > 4 ? '…' : ''}</span>}
                    </span>
                    <span className="text-xs text-ink-2">{e.user_email ?? 'system'}</span>
                  </button>
                  {expanded && (
                    <div className="grid grid-cols-2 gap-4 bg-surface-2 px-12 pb-4">
                      {(['before', 'after'] as const).map((k) => (
                        <div key={k}>
                          <p className="mb-1 text-xs font-semibold text-muted uppercase">{k}</p>
                          <pre className={cn('max-h-72 overflow-auto rounded-lg border border-line bg-surface p-3 text-[11px] leading-relaxed')}>{e[k] ? JSON.stringify(e[k], null, 2) : '—'}</pre>
                        </div>
                      ))}
                      {e.table_name === 'entries' && e.action !== 'delete' && <button type="button" className="col-span-2 cursor-pointer justify-self-start text-[13px] text-info hover:underline" onClick={() => navigate(`/entries?id=${e.record_id}`)}>Open entry</button>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
