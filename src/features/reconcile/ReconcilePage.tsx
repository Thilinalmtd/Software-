import { useQueryClient } from '@tanstack/react-query';
import Papa from 'papaparse';
import { ArrowLeft, Check, CheckCheck, EyeOff, FileUp, Link2, Plus, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, MoneyInput, Select } from '@/components/ui/form';
import { Badge, Callout, Card, EmptyState, PageHeader, Spinner, Tabs } from '@/components/ui/misc';
import { formatMoney } from '@/domain/money';
import { formatDate, today } from '@/domain/period';
import { findMatches, guessMapping, parseStatementRows, type ColumnMapping, type DateFormat } from '@/domain/statements';
import type { LedgerAccount, StatementLine } from '@/domain/types';
import { useAppData, useRepo } from '@/data/context';
import { useLedger, useLookups, useReconcile, useTable } from '@/data/hooks';
import { canWriteDepartment } from '@/data/permissions';
import { cn, errorMessage } from '@/lib/cn';
import { useUi } from '@/app/ui-state';

export default function ReconcilePage() {
  const { id } = useParams();
  const L = useLookups();
  const ledger = useLedger();
  const repo = useRepo();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { member } = useAppData();
  const { openQuickAdd } = useUi();
  const statement = useTable('statement_lines', { eq: { account_id: id ?? '' }, order: { column: 'date' } });
  const reconcile = useReconcile();
  const [tab, setTab] = useState<'statement' | 'ledger'>('statement');
  const [importing, setImporting] = useState(false);
  const [asOf, setAsOf] = useState(today());
  const [closing, setClosing] = useState<number | null>(null);
  const account = L.accountMap.get(id ?? '');
  const moneyRows = useMemo(() => (ledger.data ?? []).filter((r) => r.account_id === id && r.status !== 'void'), [ledger.data, id]);
  if (L.loading || ledger.isLoading || statement.isLoading) return <Spinner />;
  if (!account) return <EmptyState title="Account not found" />;
  const ccy = account.currency ?? 'LKR';
  const canRec = canWriteDepartment(member, account.department_id, L.departments) && member?.role !== 'viewer';
  const unmatched = (statement.data ?? []).filter((s) => s.status === 'unmatched');
  const unreconciled = moneyRows.filter((r) => !r.reconciled).sort((a, b) => a.date.localeCompare(b.date));
  const clearedBalance = moneyRows.filter((r) => r.status === 'cleared' && r.date <= asOf).reduce((s, r) => s + r.amount_minor, 0);
  const reconciledBalance = moneyRows.filter((r) => r.status === 'cleared' && r.reconciled && r.date <= asOf).reduce((s, r) => s + r.amount_minor, 0);
  const difference = closing === null ? null : closing - clearedBalance;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['statement_lines'] }), qc.invalidateQueries({ queryKey: ['ledger'] })]);

  const match = async (s: StatementLine, lineId: string) => {
    try {
      await reconcile.mutateAsync({ lineIds: [lineId], reconciled: true, statementLineId: s.id, date: s.date });
      toast.success('Matched');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const createFrom = (s: StatementLine) =>
    openQuickAdd({
      tab: s.amount_minor > 0 ? 'income' : 'expense',
      prefill: {
        date: s.date,
        accountId: account.id,
        description: s.description,
        reference: s.reference ?? '',
        statementLineId: s.id,
        ...(s.amount_minor > 0 ? { amountMinor: s.amount_minor, departmentId: account.department_id } : { splits: [{ key: crypto.randomUUID(), accountId: null, amountMinor: -s.amount_minor, projectId: null }], departmentId: account.department_id }),
      },
      onSaved: () => void refresh(),
    });
  const ignore = async (s: StatementLine) => {
    await repo.update('statement_lines', s.id, { status: 'ignored' });
    await refresh();
  };
  const finish = async () => {
    try {
      await repo.completeReconciliation(account.id, asOf);
      await qc.invalidateQueries({ queryKey: ['ledger_accounts'] });
      toast.success(`${account.name} reconciled to ${formatDate(asOf)}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title={`Reconcile ${account.name}`}
        description={`Tick off each item against the ${account.type === 'platform' ? 'platform' : 'bank'} statement. Last reconciled: ${formatDate(account.last_reconciled_date)}.`}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate(`/accounts/${account.id}`)}><ArrowLeft /> Account</Button>
            {canRec && <Button variant="primary" onClick={() => setImporting(true)}><Upload /> Import statement (CSV)</Button>}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-3" padded={false}>
          <div className="px-5 pt-2">
            <Tabs value={tab} onChange={setTab} tabs={[{ value: 'statement', label: 'Statement lines to match', count: unmatched.length }, { value: 'ledger', label: 'Unreconciled in app', count: unreconciled.length }]} listClassName="border-b-0" />
          </div>
          <div className="border-t border-line">
            {tab === 'statement' ? (
              unmatched.length === 0 ? (
                <EmptyState icon={<FileUp />} title={statement.data?.length ? 'Everything on the statement is matched' : 'No statement imported'} body={statement.data?.length ? 'Check the other tab for app entries not on the statement.' : 'Export a CSV from online banking, Payoneer or Upwork and import it here — or tick items manually on the other tab.'} />
              ) : (
                <ul className="divide-y divide-line">
                  {unmatched.map((s) => {
                    const candidates = findMatches(s, moneyRows).slice(0, 2);
                    return (
                      <li key={s.id} className="grid grid-cols-[1fr_auto] gap-4 px-5 py-3">
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-3">
                            <span className="w-24 shrink-0 text-[13px] text-ink-2 tabular">{formatDate(s.date)}</span>
                            <span className="truncate text-[13px] font-medium text-ink">{s.description}</span>
                            <span className={cn('ml-auto shrink-0 text-[13px] font-semibold tabular', s.amount_minor > 0 && 'text-positive')}>{formatMoney(s.amount_minor, ccy, { signed: true })}</span>
                          </div>
                          {candidates.length > 0 ? (
                            <div className="mt-2 space-y-1.5 pl-27">
                              {candidates.map((c) => (
                                <div key={c.row.id} className="flex items-center gap-3 rounded-lg bg-positive-soft/60 px-3 py-1.5 text-xs">
                                  <Link2 className="size-3.5 text-positive" />
                                  <span className="truncate text-ink">{c.row.entry_number} · {c.row.entry_description}</span>
                                  <span className="text-ink-2">{formatDate(c.row.date)}{c.dayGap ? ` (${c.dayGap}d apart)` : ''}</span>
                                  {canRec && <Button size="sm" className="ml-auto h-7" onClick={() => void match(s, c.row.id)}><Check /> Match</Button>}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-1 pl-27 text-xs text-muted">No matching entry in the app.</p>
                          )}
                        </div>
                        {canRec && (
                          <div className="flex items-start gap-1">
                            <Button size="sm" onClick={() => createFrom(s)}><Plus /> Create entry</Button>
                            <Button size="sm" variant="ghost" title="Ignore (e.g. already covered elsewhere)" aria-label="Ignore" onClick={() => void ignore(s)}><EyeOff /></Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )
            ) : unreconciled.length === 0 ? (
              <EmptyState icon={<CheckCheck />} title="All app entries are reconciled" />
            ) : (
              <table className="w-full text-[13px]">
                <tbody>
                  {unreconciled.map((r) => (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className="w-12 pl-5">{canRec && <Checkbox aria-label="Reconciled" checked={r.reconciled} onCheckedChange={(v) => reconcile.mutate({ lineIds: [r.id], reconciled: v, date: r.date })} />}</td>
                      <td className="w-28 px-3 py-2.5 text-ink-2 tabular">{formatDate(r.date)}</td>
                      <td className="px-3 py-2.5"><p>{r.entry_description}</p><p className="text-xs text-muted">{r.entry_number}{r.status === 'pending' ? ' · pending' : ''}</p></td>
                      <td className={cn('px-5 py-2.5 text-right font-medium tabular', r.amount_minor > 0 && 'text-positive')}>{formatMoney(r.amount_minor, ccy, { signed: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
        <Card title="Check the balance">
          <div className="space-y-3">
            <Field label="Statement date"><Input type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} /></Field>
            <Field label="Statement closing balance"><MoneyInput currency={ccy} value={closing} onChange={setClosing} allowNegative /></Field>
            <div className="space-y-1.5 rounded-lg bg-surface-2 p-3 text-[13px]">
              <div className="flex justify-between"><span className="text-ink-2">Cleared balance in app</span><span className="tabular">{formatMoney(clearedBalance, ccy)}</span></div>
              <div className="flex justify-between"><span className="text-ink-2">Of which ticked</span><span className="tabular">{formatMoney(reconciledBalance, ccy)}</span></div>
              {difference !== null && (
                <div className={cn('flex justify-between border-t border-line pt-1.5 font-semibold', difference === 0 ? 'text-positive' : 'text-negative')}>
                  <span>Difference</span>
                  <span className="tabular">{formatMoney(difference, ccy, { signed: true })}</span>
                </div>
              )}
            </div>
            {difference !== null && difference !== 0 && <Callout tone="caution">Look for missing entries (bank charges, interest) or wrong amounts before finishing.</Callout>}
            {canRec && <Button variant="primary" className="w-full" disabled={difference !== 0} onClick={() => void finish()}><CheckCheck /> Finish reconciliation</Button>}
            {difference === 0 && <Badge tone="positive">Balances agree</Badge>}
          </div>
        </Card>
      </div>
      {importing && <ImportDialog account={account} onClose={() => setImporting(false)} onDone={refresh} />}
    </>
  );
}

function ImportDialog({ account, onClose, onDone }: { account: LedgerAccount; onClose: () => void; onDone: () => Promise<unknown> }) {
  const repo = useRepo();
  const [fileName, setFileName] = useState('');
  const [records, setRecords] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [busy, setBusy] = useState(false);
  const ccy = account.currency ?? 'LKR';
  const parsed = useMemo(() => (mapping ? parseStatementRows(records, mapping, ccy, account.id) : null), [records, mapping, ccy, account.id]);
  const load = (file: File) => {
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (res) => {
        const hs = (res.meta.fields ?? []).filter(Boolean);
        setHeaders(hs);
        setRecords(res.data);
        setMapping(guessMapping(hs));
      },
      error: (err) => toast.error(err.message),
    });
  };
  const opts = [{ value: '', label: '—' }, ...headers.map((h) => ({ value: h, label: h }))];
  const doImport = async () => {
    if (!parsed?.rows.length) return;
    setBusy(true);
    try {
      const imp = await repo.insert('statement_imports', { account_id: account.id, file_name: fileName, row_count: parsed.rows.length });
      const existing = new Set((await repo.list('statement_lines', { eq: { account_id: account.id } })).map((s) => s.hash));
      const fresh = parsed.rows.filter((r) => !existing.has(r.hash));
      await repo.insertMany('statement_lines', fresh.map((r) => ({ ...r, import_id: imp.id, account_id: account.id, status: 'unmatched' as const, matched_entry_id: null })));
      await onDone();
      toast.success(`Imported ${fresh.length} line(s)${parsed.rows.length - fresh.length ? ` · ${parsed.rows.length - fresh.length} already imported` : ''}`);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="xl" title={`Import statement — ${account.name}`} description="CSV exports from Sri Lankan banks, Payoneer, Wise and Upwork all work — tell the app which column is which." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!parsed?.rows.length} loading={busy} onClick={() => void doImport()}>Import {parsed?.rows.length ?? 0} lines</Button></>}>
      {!records.length ? (
        <label
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong px-6 py-12 text-center hover:bg-surface-2"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) load(f);
          }}
        >
          <Upload className="size-6 text-muted" />
          <span className="font-medium text-ink">Drop a CSV file here, or click to choose</span>
          <span className="text-xs text-muted">Amounts are read in {ccy}. Duplicate lines are skipped automatically.</span>
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </label>
      ) : (
        mapping && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <Field label="Date column"><Select value={mapping.date} onChange={(e) => setMapping({ ...mapping, date: e.target.value })} options={opts} /></Field>
              <Field label="Date format"><Select value={mapping.dateFormat} onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value as DateFormat })} options={[{ value: 'auto', label: 'Detect (day first)' }, { value: 'dd/mm/yyyy', label: 'dd/mm/yyyy' }, { value: 'mm/dd/yyyy', label: 'mm/dd/yyyy' }, { value: 'yyyy-mm-dd', label: 'yyyy-mm-dd' }]} /></Field>
              <Field label="Description column"><Select value={mapping.description} onChange={(e) => setMapping({ ...mapping, description: e.target.value })} options={opts} /></Field>
              <Field label="Reference column"><Select value={mapping.reference ?? ''} onChange={(e) => setMapping({ ...mapping, reference: e.target.value || null })} options={opts} /></Field>
              <Field label="Amount (signed)"><Select value={mapping.amount ?? ''} onChange={(e) => setMapping({ ...mapping, amount: e.target.value || null, credit: e.target.value ? null : mapping.credit, debit: e.target.value ? null : mapping.debit })} options={opts} /></Field>
              <Field label="…or money in column"><Select value={mapping.credit ?? ''} onChange={(e) => setMapping({ ...mapping, credit: e.target.value || null, amount: null })} options={opts} /></Field>
              <Field label="…and money out column"><Select value={mapping.debit ?? ''} onChange={(e) => setMapping({ ...mapping, debit: e.target.value || null, amount: null })} options={opts} /></Field>
              <Field label="Balance column"><Select value={mapping.balance ?? ''} onChange={(e) => setMapping({ ...mapping, balance: e.target.value || null })} options={opts} /></Field>
            </div>
            <label className="flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" checked={!!mapping.invertSign} onChange={(e) => setMapping({ ...mapping, invertSign: e.target.checked })} /> Flip signs (the file shows money out as positive)</label>
            {parsed && parsed.errors.length > 0 && <Callout tone="caution" title={`${parsed.errors.length} row(s) will be skipped`}>{parsed.errors.slice(0, 4).map((e) => `Row ${e.row}: ${e.message}`).join(' · ')}</Callout>}
            <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 text-left font-medium">Date</th><th className="px-3 py-2 text-left font-medium">Description</th><th className="px-3 py-2 text-right font-medium">Amount</th></tr></thead>
                <tbody>
                  {(parsed?.rows ?? []).slice(0, 50).map((r) => (
                    <tr key={r.hash} className="border-t border-line"><td className="px-3 py-1.5 tabular">{formatDate(r.date)}</td><td className="px-3 py-1.5">{r.description}</td><td className={cn('px-3 py-1.5 text-right tabular', r.amount_minor > 0 && 'text-positive')}>{formatMoney(r.amount_minor, ccy, { signed: true })}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">{fileName} · {parsed?.rows.length ?? 0} lines ready · money in {formatMoney((parsed?.rows ?? []).filter((r) => r.amount_minor > 0).reduce((s, r) => s + r.amount_minor, 0), ccy)} · money out {formatMoney(-(parsed?.rows ?? []).filter((r) => r.amount_minor < 0).reduce((s, r) => s + r.amount_minor, 0), ccy)}</p>
          </div>
        )
      )}
    </Dialog>
  );
}
