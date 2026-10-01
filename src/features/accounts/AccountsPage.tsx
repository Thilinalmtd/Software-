import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCheck, Pencil, Plus, Scale } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/form';
import { Badge, Callout, Card, EmptyState, Menu, PageHeader, Spinner } from '@/components/ui/misc';
import { formatMoney, formatRate, isValidRate } from '@/domain/money';
import { formatDate, today } from '@/domain/period';
import { buildOpeningBalance, PostingError } from '@/domain/posting';
import { accountBalances, type AccountBalance } from '@/domain/reports';
import { MONEY_ACCOUNT_TYPES, type LedgerAccount } from '@/domain/types';
import { useAppData } from '@/data/context';
import { useCurrentRates, useLedger, useLookups, usePostEntry, useRateToLkr, useSaveRow } from '@/data/hooks';
import { canWriteDepartment, writableDepartments } from '@/data/permissions';
import { errorMessage } from '@/lib/cn';
import { useUi } from '@/app/ui-state';
import { AccountIcon } from '../shared/bits';

export default function AccountsPage() {
  const L = useLookups();
  const ledger = useLedger();
  const rates = useCurrentRates();
  const { member } = useAppData();
  const { dept } = useUi();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<LedgerAccount | 'new' | null>(null);
  const [opening, setOpening] = useState<LedgerAccount | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  if (L.loading || ledger.isLoading) return <Spinner />;
  const balances = accountBalances(ledger.data ?? [], L.accounts, rates).filter((b) => (showArchived || !b.account.archived) && (dept === 'all' || b.account.department_id === dept));
  const openingAccounts = new Set((ledger.data ?? []).filter((r) => r.kind === 'opening_balance' && r.status !== 'void').map((r) => r.account_id));
  const total = balances.reduce((s, b) => s + b.currentLkrMinor, 0);
  const unrealised = balances.reduce((s, b) => s + b.unrealisedLkrMinor, 0);
  const canAdd = writableDepartments(member, L.departments).length > 0 && member?.role !== 'viewer';

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Bank, platform and cash accounts. Balances are shown in each account's own currency and valued in LKR at today's rate."
        actions={
          <>
            <Button variant="ghost" onClick={() => setShowArchived((v) => !v)}>{showArchived ? 'Hide archived' : 'Show archived'}</Button>
            {canAdd && (
              <Button variant="primary" onClick={() => setEditing('new')}>
                <Plus /> Add account
              </Button>
            )}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-3 gap-4">
        <SummaryTile label="Total cash (LKR at today's rates)" value={formatMoney(total)} />
        <SummaryTile label="Unrealised exchange difference" value={formatMoney(unrealised, 'LKR', { signed: true })} hint="Foreign balances at today's rate minus their LKR book value" />
        <SummaryTile label="Accounts" value={String(balances.length)} hint={`${balances.filter((b) => b.account.currency !== 'LKR').length} in foreign currency`} />
      </div>
      {balances.length === 0 ? (
        <Card>
          <EmptyState icon={<Scale />} title="No accounts yet" body="Add each bank account, Upwork and Payoneer balance and cash box, assigned to the department that owns it." action={canAdd && <Button variant="primary" onClick={() => setEditing('new')}><Plus /> Add account</Button>} />
        </Card>
      ) : (
        <div className="space-y-6">
          {L.departments.filter((d) => balances.some((b) => b.account.department_id === d.id)).map((d) => {
            const list = balances.filter((b) => b.account.department_id === d.id);
            return (
              <section key={d.id}>
                <div className="mb-3 flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: d.color }} />
                  <h2 className="text-[15px] font-semibold text-ink">{d.name}</h2>
                  <span className="text-[13px] text-ink-2 tabular">· {formatMoney(list.reduce((s, b) => s + b.currentLkrMinor, 0))}</span>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                  {list.map((b) => (
                    <AccountCard
                      key={b.account.id}
                      b={b}
                      rate={rates[b.account.currency ?? 'LKR']}
                      needsOpening={!openingAccounts.has(b.account.id)}
                      canEdit={canWriteDepartment(member, b.account.department_id, L.departments) && member?.role !== 'viewer'}
                      onOpen={() => navigate(`/accounts/${b.account.id}`)}
                      onReconcile={() => navigate(`/reconcile/${b.account.id}`)}
                      onEdit={() => setEditing(b.account)}
                      onOpening={() => setOpening(b.account)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {editing && <AccountDialog account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {opening && <OpeningBalanceDialog account={opening} onClose={() => setOpening(null)} />}
    </>
  );
}

function SummaryTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-5 py-4">
      <p className="text-[13px] text-ink-2">{label}</p>
      <p className="mt-1 text-xl font-semibold text-ink tabular">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function AccountCard({ b, rate, needsOpening, canEdit, onOpen, onReconcile, onEdit, onOpening }: { b: AccountBalance; rate?: string; needsOpening: boolean; canEdit: boolean; onOpen: () => void; onReconcile: () => void; onEdit: () => void; onOpening: () => void }) {
  const a = b.account;
  const foreign = a.currency !== 'LKR';
  return (
    <div className="group flex flex-col rounded-xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={onOpen} className="flex min-w-0 cursor-pointer items-center gap-3 text-left">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-2">
            <AccountIcon type={a.type} />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-ink">{a.name}</span>
            <span className="block truncate text-xs text-muted">{a.code}{a.account_number ? ` · ${a.account_number}` : ''} · {a.currency}</span>
          </span>
        </button>
        {canEdit && (
          <Menu
            trigger={<Button size="icon-sm" variant="ghost" aria-label={`${a.name} actions`}><Pencil /></Button>}
            items={[
              { label: 'Edit account', onSelect: onEdit },
              { label: needsOpening ? 'Set opening balance' : 'Add another opening balance', onSelect: onOpening },
              { label: 'Reconcile', onSelect: onReconcile },
            ]}
          />
        )}
      </div>
      <p className={`mt-4 text-2xl font-semibold tracking-tight tabular ${b.balanceMinor < 0 ? 'text-negative' : 'text-ink'}`}>{formatMoney(b.balanceMinor, a.currency ?? 'LKR')}</p>
      {foreign && (
        <p className="mt-1 text-xs text-ink-2 tabular">
          ≈ {formatMoney(b.currentLkrMinor)}{rate ? ` @ ${formatRate(rate)}` : ''}
          {b.unrealisedLkrMinor !== 0 && <span className={b.unrealisedLkrMinor > 0 ? 'text-positive' : 'text-negative'}> · {formatMoney(b.unrealisedLkrMinor, 'LKR', { signed: true, compact: true })} unrealised</span>}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {a.archived && <Badge>Archived</Badge>}
        {needsOpening && <Badge tone="caution">No opening balance</Badge>}
        {b.pendingMinor !== 0 && <Badge tone="caution">{formatMoney(b.pendingMinor, a.currency ?? 'LKR', { signed: true })} pending</Badge>}
        {b.unreconciledCount > 0 ? <Badge tone="neutral">{b.unreconciledCount} to reconcile</Badge> : <Badge tone="positive"><CheckCheck className="size-3.5" />Reconciled</Badge>}
        <span className="ml-auto text-xs text-muted">{a.last_reconciled_date ? `Reconciled to ${formatDate(a.last_reconciled_date)}` : 'Never reconciled'}</span>
      </div>
      <div className="mt-4 flex gap-2 border-t border-line pt-3">
        <Button size="sm" variant="ghost" onClick={onOpen}>Transactions <ArrowRight /></Button>
        {canEdit && <Button size="sm" variant="ghost" onClick={onReconcile}>Reconcile</Button>}
      </div>
    </div>
  );
}

export function AccountDialog({ account, onClose }: { account: LedgerAccount | null; onClose: () => void }) {
  const L = useLookups();
  const { member } = useAppData();
  const save = useSaveRow('ledger_accounts');
  const [v, setV] = useState({
    name: account?.name ?? '',
    type: account?.type ?? 'bank',
    currency: account?.currency ?? 'LKR',
    department_id: account?.department_id ?? member?.department_id ?? L.departments[0]?.id ?? '',
    account_number: account?.account_number ?? '',
    code: account?.code ?? '',
    notes: account?.notes ?? '',
    archived: account?.archived ?? false,
  });
  const used = new Set(L.accounts.map((a) => a.code));
  const nextCode = () => {
    for (let c = 1010; c < 1999; c += 10) if (!used.has(String(c))) return String(c);
    return String(1900 + Math.floor(Math.random() * 99));
  };
  const submit = async () => {
    if (!v.name.trim()) return toast.error('Give the account a name.');
    try {
      await save.mutateAsync({
        id: account?.id,
        values: { name: v.name.trim(), type: v.type as LedgerAccount['type'], currency: v.currency, department_id: v.department_id, account_number: v.account_number || null, code: v.code || account?.code || nextCode(), notes: v.notes || null, archived: v.archived, category_group: null },
      });
      toast.success(account ? 'Account updated' : 'Account added — now set its opening balance');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const hasActivity = !!account;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={account ? `Edit ${account.name}` : 'Add account'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => void submit()}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name" className="col-span-2">
          <Input autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Civil — Commercial Bank" />
        </Field>
        <Field label="Type">
          <Select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as LedgerAccount['type'] })} options={MONEY_ACCOUNT_TYPES.map((t) => ({ value: t, label: { bank: 'Bank account', platform: 'Platform (Upwork, Payoneer, Wise)', cash: 'Cash', card: 'Credit card' }[t as 'bank'] ?? t }))} />
        </Field>
        <Field label="Currency" hint={hasActivity ? 'Currency cannot change once the account is in use.' : undefined}>
          <Select value={v.currency} disabled={hasActivity} onChange={(e) => setV({ ...v, currency: e.target.value })} options={(L.settings?.currencies ?? ['LKR', 'USD']).map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label="Owned by department">
          <Select value={v.department_id} onChange={(e) => setV({ ...v, department_id: e.target.value })} options={L.departments.map((d) => ({ value: d.id, label: d.name, disabled: !canWriteDepartment(member, d.id, L.departments) }))} />
        </Field>
        <Field label="Account number">
          <Input value={v.account_number} onChange={(e) => setV({ ...v, account_number: e.target.value })} placeholder="Optional" />
        </Field>
        <Field label="Notes" className="col-span-2">
          <Textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </Field>
        {account && (
          <label className="col-span-2 flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={v.archived} onChange={(e) => setV({ ...v, archived: e.target.checked })} /> Archived (hide from pickers; history is kept)
          </label>
        )}
      </div>
    </Dialog>
  );
}

function OpeningBalanceDialog({ account, onClose }: { account: LedgerAccount; onClose: () => void }) {
  const L = useLookups();
  const post = usePostEntry();
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState<number | null>(null);
  const [rate, setRate] = useState('');
  const spot = useRateToLkr(account.currency, date);
  const effectiveRate = account.currency === 'LKR' ? '1' : rate || spot.data?.rate || '';
  const submit = async () => {
    try {
      if (amount === null || amount === 0) throw new PostingError(['Enter the balance.']);
      const draft = buildOpeningBalance({ date, account, amountMinor: amount, fxRate: effectiveRate, equityAccount: L.sys('opening_equity')! });
      await post.mutateAsync({ draft });
      toast.success('Opening balance recorded');
      onClose();
    } catch (e) {
      toast.error(e instanceof PostingError ? e.issues.join(' ') : errorMessage(e));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Opening balance — ${account.name}`} description="The balance on the day you start using the app (e.g. the statement balance on 31 March)." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={post.isPending} onClick={() => void submit()}>Record</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="As at date">
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>
        <Field label={`Balance (${account.currency})`} hint="Negative for an overdraft or card balance owed.">
          <MoneyInput autoFocus currency={account.currency ?? 'LKR'} value={amount} onChange={setAmount} allowNegative />
        </Field>
        {account.currency !== 'LKR' && (
          <Field label={`Rate ${account.currency} → LKR`} hint={spot.data ? `${spot.data.source} ${spot.data.date}` : 'Enter the rate for that date'} className="col-span-2">
            <Input value={rate || spot.data?.rate || ''} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} aria-invalid={!isValidRate(effectiveRate)} />
          </Field>
        )}
      </div>
      <Callout className="mt-4" tone="info">Opening balances never count as income. They are recorded against “Opening Balance Equity”.</Callout>
    </Dialog>
  );
}

export function useInvalidateAccounts() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['ledger_accounts'] });
}
