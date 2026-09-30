import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Clock, Copy, Download, FileText, Image as ImageIcon, Paperclip, Pencil, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Sheet } from '@/components/ui/dialog';
import { Badge, Callout, Spinner } from '@/components/ui/misc';
import { formatMoney, formatRate } from '@/domain/money';
import { formatDate } from '@/domain/period';
import type { Attachment, AuditEvent } from '@/domain/types';
import { useAppData, useRepo } from '@/data/context';
import { useLookups, usePeriodLock, useSetEntryStatus, useTable, useVoidEntry } from '@/data/hooks';
import { canRecord, canWriteDepartment } from '@/data/permissions';
import { errorMessage } from '@/lib/cn';
import { openExternal } from '@/lib/files';
import { useUi } from '@/app/ui-state';
import { DeptTag, KindBadge, StatusBadge } from '../shared/bits';

const ROLE_LABELS: Record<string, string> = {
  money: 'Money',
  revenue: 'Revenue',
  expense: 'Cost',
  fee: 'Fee',
  fx: 'Exchange difference',
  salary: 'Gross salary',
  employer_epf: 'Employer EPF',
  employer_etf: 'Employer ETF',
  epf_payable: 'EPF payable',
  etf_payable: 'ETF payable',
  apit_payable: 'APIT payable',
  deduction: 'Deduction',
  liability: 'Liability settled',
  equity: 'Opening equity',
  adjustment: 'Adjustment',
};

export function EntryDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const repo = useRepo();
  const qc = useQueryClient();
  const { member } = useAppData();
  const L = useLookups();
  const { openQuickAdd } = useUi();
  const lock = usePeriodLock();
  const entries = useTable('entries');
  const attachments = useTable('attachments', { eq: { entry_id: id } });
  const audit = useQuery({ queryKey: ['audit_events', 'entry', id], queryFn: () => repo.list('audit_events', { eq: { table_name: 'entries', record_id: id }, order: { column: 'at', ascending: false } }) });
  const lines = useQuery({ queryKey: ['entry_lines', id], queryFn: () => repo.entryLines(id) });
  const voidEntry = useVoidEntry();
  const setStatus = useSetEntryStatus();
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const entry = entries.data?.find((e) => e.id === id);

  if (!entry) {
    return (
      <Sheet open onOpenChange={(o) => !o && onClose()} title="Entry">
        {entries.isLoading ? <Spinner /> : <p className="text-sm text-muted">This entry was not found.</p>}
      </Sheet>
    );
  }
  const locked = !!lock.data && entry.date <= lock.data;
  const canEdit = canRecord(member) && canWriteDepartment(member, entry.department_id, L.departments) && entry.status !== 'void' && !locked;
  const editableKind = entry.kind === 'income' || entry.kind === 'expense' || entry.kind === 'transfer';

  const upload = async (files: FileList | File[]) => {
    setUploading(true);
    try {
      for (const f of files) await repo.uploadAttachment(f, { entry_id: id });
      await qc.invalidateQueries({ queryKey: ['attachments'] });
      toast.success('Attached');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const openAttachment = async (a: Attachment) => {
    try {
      await openExternal(await repo.attachmentUrl(a));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        <span className="flex items-center gap-2">
          {entry.number}
          <KindBadge kind={entry.kind} cross={!!(entry.meta as { cross_department?: boolean }).cross_department} />
          <StatusBadge status={entry.status} />
        </span>
      }
      description={entry.description}
      footer={
        <>
          {canEdit && entry.status === 'pending' && (
            <Button onClick={() => setStatus.mutateAsync({ id, status: 'cleared' }).then(() => toast.success('Marked as cleared')).catch((e) => toast.error(errorMessage(e)))}>
              <CheckCircle2 /> Mark cleared
            </Button>
          )}
          {canEdit && entry.status === 'cleared' && (
            <Button variant="ghost" onClick={() => setStatus.mutateAsync({ id, status: 'pending' }).then(() => toast.success('Marked as pending')).catch((e) => toast.error(errorMessage(e)))}>
              <Clock /> Mark pending
            </Button>
          )}
          {canRecord(member) && editableKind && (
            <Button
              variant="ghost"
              onClick={() => {
                onClose();
                openQuickAdd({ tab: entry.kind as 'income' | 'expense' | 'transfer', prefill: duplicatePrefill(entry, lines.data ?? []) });
              }}
            >
              <Copy /> Duplicate
            </Button>
          )}
          {canEdit && (
            <Button variant="ghost" className="text-negative" onClick={() => setConfirmVoid(true)}>
              <Ban /> Void
            </Button>
          )}
          {canEdit && editableKind && (
            <Button
              variant="primary"
              onClick={() => {
                onClose();
                openQuickAdd({ entryId: id });
              }}
            >
              <Pencil /> Edit
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-6">
        {entry.status === 'void' && (
          <Callout tone="negative" title="Voided" icon={<Ban />}>
            {entry.void_reason} — {formatDate(entry.voided_at?.slice(0, 10))}. Voided entries stay on record and are excluded from all totals.
          </Callout>
        )}
        {locked && entry.status !== 'void' && <Callout tone="caution" icon={<Clock />}>This entry is in a locked period (up to {formatDate(lock.data)}). An admin must unlock the month to change it.</Callout>}

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
          <Fact label="Date">{formatDate(entry.date)}</Fact>
          <Fact label="Department"><DeptTag dept={L.deptMap.get(entry.department_id)} /></Fact>
          <Fact label="Contact">{L.partyMap.get(entry.party_id ?? '')?.name ?? '—'}</Fact>
          <Fact label="Project">{entry.project_id ? `${L.projectMap.get(entry.project_id)?.code} · ${L.projectMap.get(entry.project_id)?.name}` : '—'}</Fact>
          <Fact label="Reference">{entry.reference ?? '—'}</Fact>
          <Fact label="Channel / method">{[entry.channel, entry.payment_method].filter(Boolean).join(' · ') || '—'}</Fact>
          <Fact label="Recorded by">{L.memberMap.get(entry.created_by ?? '')?.full_name ?? L.memberMap.get(entry.created_by ?? '')?.email ?? '—'} · {formatDate(entry.created_at.slice(0, 10))}</Fact>
          <Fact label="Last changed">{formatDate(entry.updated_at.slice(0, 10))}</Fact>
        </dl>

        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-ink">How it was recorded</h3>
          {lines.isLoading ? (
            <Spinner className="py-4" />
          ) : (
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full text-[13px]">
                <thead className="bg-surface-2 text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Line</th>
                    <th className="px-3 py-2 text-left font-medium">Account / category</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 text-right font-medium">LKR</th>
                  </tr>
                </thead>
                <tbody>
                  {(lines.data ?? []).map((l) => (
                    <tr key={l.id} className="border-t border-line">
                      <td className="px-3 py-2 text-ink-2">{ROLE_LABELS[l.role] ?? l.role}</td>
                      <td className="px-3 py-2">
                        <span className="text-ink">{L.accountMap.get(l.account_id)?.name}</span>
                        <span className="block text-xs text-muted">
                          {L.deptMap.get(l.department_id)?.name}
                          {l.project_id && ` · ${L.projectMap.get(l.project_id)?.code}`}
                          {l.reconciled && ' · reconciled'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular">
                        {formatMoney(l.amount_minor, l.currency, { plain: l.currency === 'LKR' })}
                        {l.currency !== 'LKR' && <span className="block text-xs text-muted">@ {formatRate(l.fx_rate)}</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular">{formatMoney(l.amount_lkr_minor, 'LKR', { plain: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-muted">Positive = money arriving in an account or a cost; negative = money leaving or income earned. Every entry balances to zero in LKR.</p>
        </section>

        <section
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (canRecord(member)) void upload(e.dataTransfer.files);
          }}
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-ink">Receipts &amp; documents</h3>
            {canRecord(member) && (
              <>
                <Button size="sm" onClick={() => fileInput.current?.click()} loading={uploading}>
                  <Upload /> Attach
                </Button>
                <input ref={fileInput} type="file" multiple className="hidden" accept="image/*,application/pdf,.xlsx,.docx,.csv" onChange={(e) => e.target.files && void upload(e.target.files)} />
              </>
            )}
          </div>
          {(attachments.data ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong px-4 py-5 text-center text-[13px] text-muted">
              <Paperclip className="mx-auto mb-1 size-4" />
              No files yet{canRecord(member) ? ' — drop a receipt here' : ''}.
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {(attachments.data ?? []).map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  {a.mime_type.startsWith('image/') ? <ImageIcon className="size-4 text-muted" /> : <FileText className="size-4 text-muted" />}
                  <button type="button" className="min-w-0 flex-1 cursor-pointer truncate text-left text-info hover:underline" onClick={() => void openAttachment(a)}>
                    {a.file_name}
                  </button>
                  <span className="text-xs text-muted">{(a.size_bytes / 1024).toFixed(0)} KB</span>
                  <Button size="icon-sm" variant="ghost" aria-label="Open" onClick={() => void openAttachment(a)}>
                    <Download />
                  </Button>
                  {(a.created_by === member?.user_id || member?.role === 'admin') && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Delete attachment"
                      onClick={async () => {
                        try {
                          await repo.deleteAttachment(a);
                          await qc.invalidateQueries({ queryKey: ['attachments'] });
                        } catch (e) {
                          toast.error(errorMessage(e));
                        }
                      }}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-ink">History</h3>
          <ol className="space-y-2">
            {(audit.data ?? []).map((a) => (
              <HistoryItem key={a.id} event={a} />
            ))}
            {!audit.isLoading && (audit.data ?? []).length === 0 && <li className="text-[13px] text-muted">No history recorded.</li>}
          </ol>
        </section>
      </div>
      <ConfirmDialog
        open={confirmVoid}
        onOpenChange={setConfirmVoid}
        title={`Void ${entry.number}?`}
        body="The entry stays on record but no longer counts in any total. This is recorded in the audit log."
        confirmLabel="Void entry"
        danger
        requireReason
        reasonLabel="Why is it being voided?"
        onConfirm={async (reason) => {
          try {
            await voidEntry.mutateAsync({ id, reason });
            toast.success(`${entry.number} voided`);
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
        }}
      />
    </Sheet>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}

function HistoryItem({ event }: { event: AuditEvent }) {
  const verb = { post: 'Recorded', update: 'Changed', void: 'Voided', insert: 'Created', delete: 'Deleted' }[event.action] ?? event.action;
  const before = event.before as { status?: string; date?: string; description?: string } | null;
  const after = event.after as { status?: string; date?: string; description?: string } | null;
  const changes: string[] = [];
  if (before && after) {
    if (before.status !== after.status) changes.push(`status ${before.status} → ${after.status}`);
    if (before.date !== after.date) changes.push(`date ${before.date} → ${after.date}`);
    if (before.description !== after.description) changes.push('description');
  }
  return (
    <li className="flex items-start gap-3 text-[13px]">
      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-line-strong" />
      <span>
        <span className="font-medium text-ink">{verb}</span> <span className="text-ink-2">by {event.user_email ?? 'system'} · {new Date(event.at).toLocaleString()}</span>
        {changes.length > 0 && <span className="block text-xs text-muted">{changes.join(', ')}</span>}
        {event.action === 'void' && <Badge tone="negative" className="mt-1">Voided</Badge>}
      </span>
    </li>
  );
}

function duplicatePrefill(entry: { kind: string; department_id: string; project_id: string | null; party_id: string | null; description: string; channel: string | null; payment_method: string | null }, lines: { role: string; account_id: string; amount_minor: number; project_id: string | null }[]): Record<string, unknown> {
  const money = lines.filter((l) => l.role === 'money');
  const base = { departmentId: entry.department_id, projectId: entry.project_id, partyId: entry.party_id, description: entry.description, channel: entry.channel ?? '', paymentMethod: entry.payment_method ?? '', categoryTouched: true };
  if (entry.kind === 'income') {
    const rev = lines.find((l) => l.role === 'revenue');
    const fee = lines.find((l) => l.role === 'fee');
    return { ...base, accountId: money[0]?.account_id, categoryId: rev?.account_id, amountMinor: rev ? -rev.amount_minor : null, feeOn: !!fee, feeMinor: fee?.amount_minor ?? null, feeAccountId: fee?.account_id ?? null };
  }
  if (entry.kind === 'expense') {
    return { ...base, accountId: money[0]?.account_id, splits: lines.filter((l) => l.role === 'expense').map((l) => ({ key: crypto.randomUUID(), accountId: l.account_id, amountMinor: l.amount_minor, projectId: l.project_id })) };
  }
  return { ...base, accountId: money.find((m) => m.amount_minor < 0)?.account_id, toAccountId: money.find((m) => m.amount_minor > 0)?.account_id, amountMinor: -(money.find((m) => m.amount_minor < 0)?.amount_minor ?? 0) || null };
}
