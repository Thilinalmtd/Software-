import { useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Info, Plus, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, MoneyInput, SegmentedControl, Select } from '@/components/ui/form';
import { Callout, Kbd } from '@/components/ui/misc';
import { formatMoney, fromLkrMinor, formatRate, isValidRate, sum, toLkrMinor } from '@/domain/money';
import { today } from '@/domain/period';
import { buildExpense, buildIncome, buildTransfer, PostingError, validatePosting } from '@/domain/posting';
import { carryingRateFor } from '@/domain/reports';
import { applyRules } from '@/domain/statements';
import type { Entry, LedgerAccount, PostingDraft } from '@/domain/types';
import { useAppData, useRepo } from '@/data/context';
import { useLedger, useLookups, usePeriodLock, usePostEntry, useRateToLkr, useTable } from '@/data/hooks';
import { canWriteDepartment, writableDepartments } from '@/data/permissions';
import type { EntryLinks } from '@/data/repository';
import { errorMessage } from '@/lib/cn';
import { recall, remember, rememberTab, useUi, type QuickAddTab } from '@/app/ui-state';
import { categoryOptions, moneyAccountOptions, partyOptions, projectOptions } from '../shared/options';

interface Split {
  key: string;
  accountId: string | null;
  amountMinor: number | null;
  projectId: string | null;
}

interface FormState {
  date: string;
  accountId: string | null;
  toAccountId: string | null;
  departmentId: string | null;
  projectId: string | null;
  partyId: string | null;
  categoryId: string | null;
  categoryTouched: boolean;
  channel: string;
  paymentMethod: string;
  amountMinor: number | null;
  feeOn: boolean;
  feeMinor: number | null;
  feeAccountId: string | null;
  receivedMinor: number | null;
  receivedTouched: boolean;
  rate: string;
  rateTouched: boolean;
  toRate: string;
  toRateTouched: boolean;
  description: string;
  reference: string;
  status: 'cleared' | 'pending';
  splits: Split[];
  invoiceId: string | null;
  invoiceAmountMinor: number | null;
  billId: string | null;
  statementLineId: string | null;
}

const newSplit = (): Split => ({ key: crypto.randomUUID(), accountId: null, amountMinor: null, projectId: null });

function initialState(tab: QuickAddTab, prefill: Record<string, unknown> = {}): FormState {
  const last = recall<Partial<FormState>>(`quickadd.${tab}`, {});
  return {
    date: today(),
    accountId: last.accountId ?? null,
    toAccountId: last.toAccountId ?? null,
    departmentId: last.departmentId ?? null,
    projectId: null,
    partyId: null,
    categoryId: tab === 'income' ? last.categoryId ?? null : null,
    categoryTouched: false,
    channel: last.channel ?? '',
    paymentMethod: last.paymentMethod ?? '',
    amountMinor: null,
    feeOn: last.feeOn ?? false,
    feeMinor: null,
    feeAccountId: null,
    receivedMinor: null,
    receivedTouched: false,
    rate: '',
    rateTouched: false,
    toRate: '',
    toRateTouched: false,
    description: '',
    reference: '',
    status: 'cleared',
    splits: [newSplit()],
    invoiceId: null,
    invoiceAmountMinor: null,
    billId: null,
    statementLineId: null,
    ...(prefill as Partial<FormState>),
  };
}

/** Rebuild the form from a posted entry so it can be edited. */
function stateFromEntry(entry: Entry, lines: { account_id: string; amount_minor: number; fx_rate: string; role: string; project_id: string | null }[], accounts: Map<string, LedgerAccount>): FormState {
  const base = initialState(entry.kind as QuickAddTab);
  const money = lines.filter((l) => l.role === 'money');
  const common = { ...base, date: entry.date, departmentId: entry.department_id, projectId: entry.project_id, partyId: entry.party_id, description: entry.description, reference: entry.reference ?? '', status: entry.status === 'pending' ? 'pending' : 'cleared', channel: entry.channel ?? '', paymentMethod: entry.payment_method ?? '', invoiceId: entry.invoice_id, billId: entry.bill_id, rateTouched: true, toRateTouched: true, categoryTouched: true } as FormState;
  if (entry.kind === 'income') {
    const revenue = lines.find((l) => l.role === 'revenue');
    const fee = lines.find((l) => l.role === 'fee');
    return { ...common, accountId: money[0]?.account_id ?? null, categoryId: revenue?.account_id ?? null, amountMinor: revenue ? -revenue.amount_minor : null, feeOn: !!fee, feeMinor: fee?.amount_minor ?? null, feeAccountId: fee?.account_id ?? null, rate: money[0]?.fx_rate ?? '' };
  }
  if (entry.kind === 'expense') {
    const splits = lines.filter((l) => l.role === 'expense').map((l) => ({ key: crypto.randomUUID(), accountId: l.account_id, amountMinor: l.amount_minor, projectId: l.project_id }));
    return { ...common, accountId: money[0]?.account_id ?? null, splits, amountMinor: sum(splits.map((s) => s.amountMinor ?? 0)), rate: money[0]?.fx_rate ?? '' };
  }
  const from = money.find((l) => l.amount_minor < 0);
  const to = money.find((l) => l.amount_minor > 0);
  const fee = lines.find((l) => l.role === 'fee');
  void accounts;
  return { ...common, accountId: from?.account_id ?? null, toAccountId: to?.account_id ?? null, amountMinor: from ? -from.amount_minor : null, receivedMinor: to?.amount_minor ?? null, receivedTouched: true, feeOn: !!fee, feeMinor: fee?.amount_minor ?? null, feeAccountId: fee?.account_id ?? null, rate: from?.fx_rate ?? '', toRate: to?.fx_rate ?? '' };
}

export function QuickAddDialog() {
  const { quickAdd, closeQuickAdd } = useUi();
  const repo = useRepo();
  const [tab, setTab] = useState<QuickAddTab>(quickAdd?.tab ?? 'expense');
  const [loadedEntry, setLoadedEntry] = useState<Entry | null>(null);
  const [state, setState] = useState<FormState | null>(quickAdd?.entryId ? null : initialState(quickAdd?.tab ?? 'expense', quickAdd?.prefill));
  const lookups = useLookups();

  useEffect(() => {
    if (!quickAdd?.entryId || lookups.loading) return;
    (async () => {
      const entries = await repo.list('entries', { eq: { id: quickAdd.entryId! } });
      const lines = await repo.entryLines(quickAdd.entryId!);
      const e = entries[0];
      if (!e) return;
      setLoadedEntry(e);
      setTab(e.kind as QuickAddTab);
      setState(stateFromEntry(e, lines, lookups.accountMap));
    })();
  }, [quickAdd?.entryId, repo, lookups.loading, lookups.accountMap]);

  const editing = !!quickAdd?.entryId;
  const title = editing ? `Edit ${loadedEntry?.number ?? 'entry'}` : 'New entry';
  return (
    <Dialog open onOpenChange={(o) => !o && closeQuickAdd()} title={title} size="lg" description={editing ? 'Changes are recorded in the audit log.' : 'Record money coming in, going out, or moving between accounts.'}>
      {!editing && (
        <SegmentedControl
          className="mb-5"
          value={tab}
          onChange={(t) => {
            setTab(t);
            rememberTab(t);
            setState(initialState(t, quickAdd?.prefill));
          }}
          options={[
            { value: 'income', label: <span className="inline-flex items-center gap-1.5"><ArrowDownLeft className="size-4 text-positive" />Money in</span> },
            { value: 'expense', label: <span className="inline-flex items-center gap-1.5"><ArrowUpRight className="size-4 text-negative" />Money out</span> },
            { value: 'transfer', label: <span className="inline-flex items-center gap-1.5"><ArrowLeftRight className="size-4" />Move money</span> },
          ]}
        />
      )}
      {state ? <EntryForm key={tab + (loadedEntry?.id ?? '')} tab={tab} initial={state} entry={loadedEntry} onDone={closeQuickAdd} /> : <p className="py-10 text-center text-sm text-muted">Loading…</p>}
    </Dialog>
  );
}

function EntryForm({ tab, initial, entry, onDone }: { tab: QuickAddTab; initial: FormState; entry: Entry | null; onDone: () => void }) {
  const { member } = useAppData();
  const repo = useRepo();
  const { quickAdd } = useUi();
  const L = useLookups();
  const ledger = useLedger();
  const lock = usePeriodLock();
  const rules = useTable('categorisation_rules');
  const invoices = useTable('invoices');
  const invoicePayments = useTable('invoice_payments');
  const bills = useTable('bills');
  const post = usePostEntry();
  const qc = useQueryClient();
  const [s, setS] = useState<FormState>(initial);
  const [files, setFiles] = useState<File[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<FormState>) => setS((prev) => ({ ...prev, ...patch }));

  const writable = writableDepartments(member, L.departments);
  const writableIds = writable.map((d) => d.id);
  const account = s.accountId ? L.accountMap.get(s.accountId) : undefined;
  const toAccount = s.toAccountId ? L.accountMap.get(s.toAccountId) : undefined;
  const currency = account?.currency ?? 'LKR';
  const toCurrency = toAccount?.currency ?? 'LKR';

  // Default department: director's own, else the account's.
  useEffect(() => {
    if (s.departmentId && writableIds.includes(s.departmentId)) return;
    const preferred = member?.department_id && writableIds.includes(member.department_id) ? member.department_id : account?.department_id && writableIds.includes(account.department_id) ? account.department_id : writable.find((d) => tab !== 'income' || d.is_operating)?.id;
    if (preferred) set({ departmentId: preferred });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id, writableIds.join()]);

  // First time (nothing remembered): start with the department's own LKR bank account.
  useEffect(() => {
    if (s.accountId || !s.departmentId) return;
    const candidates = L.accounts.filter((a) => ['bank', 'platform', 'cash', 'card'].includes(a.type) && !a.archived && writableIds.includes(a.department_id ?? ''));
    const pick = candidates.find((a) => a.department_id === s.departmentId && a.type === 'bank' && a.currency === 'LKR') ?? candidates.find((a) => a.department_id === s.departmentId) ?? candidates[0];
    if (pick) set({ accountId: pick.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.departmentId, L.accounts.length]);

  // Exchange rates
  const spot = useRateToLkr(currency, s.date);
  const toSpot = useRateToLkr(toCurrency, s.date);
  useEffect(() => {
    if (!s.rateTouched) set({ rate: currency === 'LKR' ? '1' : spot.data?.rate ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot.data?.rate, currency]);
  useEffect(() => {
    if (!s.toRateTouched) set({ toRate: toCurrency === 'LKR' ? '1' : toSpot.data?.rate ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toSpot.data?.rate, toCurrency]);
  const carrying = useMemo(() => (tab === 'transfer' && account ? carryingRateFor((ledger.data ?? []).filter((r) => !entry || r.entry_id !== entry.id), account, s.date) : null), [tab, account, ledger.data, s.date, entry]);
  const fromRate = currency === 'LKR' ? '1' : carrying ?? s.rate;

  // Transfer: default the amount received
  useEffect(() => {
    if (tab !== 'transfer' || s.receivedTouched || !s.amountMinor || !account || !toAccount) return;
    const net = s.amountMinor - (s.feeOn ? s.feeMinor ?? 0 : 0);
    let received: number | null = net;
    if (currency !== toCurrency) {
      const lkrValue = currency === 'LKR' ? net : isValidRate(s.rate) ? toLkrMinor(net, currency, s.rate) : null;
      received = lkrValue === null ? null : toCurrency === 'LKR' ? lkrValue : isValidRate(s.toRate) ? fromLkrMinor(lkrValue, toCurrency, s.toRate) : null;
    }
    set({ receivedMinor: received });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, s.amountMinor, s.feeMinor, s.feeOn, s.rate, s.toRate, account?.id, toAccount?.id]);

  // Defaults that follow the account and contact
  useEffect(() => {
    if (!account) return;
    if (tab === 'income' && !s.channel) set({ channel: /upwork/i.test(account.name) ? 'Upwork' : account.type === 'platform' ? 'Direct Client' : 'Direct Client' });
    if (!s.feeAccountId) set({ feeAccountId: (account.type === 'platform' && tab === 'income' ? L.sys('platform_fees') : L.sys('bank_fees'))?.id ?? null });
    if (!s.paymentMethod) set({ paymentMethod: /upwork/i.test(account.name) ? 'Upwork Payout' : /payoneer/i.test(account.name) ? 'Payoneer' : account.type === 'cash' ? 'Cash' : account.type === 'card' ? 'Card' : 'Bank Transfer' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id]);
  const party = s.partyId ? L.partyMap.get(s.partyId) : undefined;
  useEffect(() => {
    if (!party?.default_account_id || s.categoryTouched) return;
    if (tab === 'income') set({ categoryId: party.default_account_id });
    if (tab === 'expense' && s.splits.length === 1) set({ splits: [{ ...s.splits[0], accountId: party.default_account_id }] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [party?.id]);

  // Categorisation rules from the description / contact
  useEffect(() => {
    if (tab === 'transfer' || s.categoryTouched) return;
    const text = `${s.description} ${party?.name ?? ''}`.trim();
    if (text.length < 3) return;
    const rule = applyRules(text, tab, rules.data ?? []);
    if (!rule?.account_id) return;
    if (tab === 'income') set({ categoryId: rule.account_id });
    else if (s.splits.length === 1 && s.splits[0].accountId !== rule.account_id) set({ splits: [{ ...s.splits[0], accountId: rule.account_id }] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.description, party?.id, rules.data]);

  // Open invoices / bills for the chosen contact
  const paidByInvoice = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of invoicePayments.data ?? []) if (p.entry_id !== entry?.id) m.set(p.invoice_id, (m.get(p.invoice_id) ?? 0) + p.amount_minor);
    return m;
  }, [invoicePayments.data, entry?.id]);
  const openInvoices = (invoices.data ?? []).filter((i) => i.kind === 'invoice' && i.client_id === s.partyId && i.status !== 'void' && (i.status !== 'paid' || i.id === s.invoiceId));
  const selectedInvoice = openInvoices.find((i) => i.id === s.invoiceId);
  const openBills = (bills.data ?? []).filter((b) => b.vendor_id === s.partyId && (b.status === 'open' || b.id === s.billId));

  // Build the posting draft
  const expenseTotal = sum(s.splits.map((x) => x.amountMinor ?? 0));
  const build = (): PostingDraft => {
    const dept = s.departmentId!;
    const description = s.description.trim() || autoDescription();
    const common = { id: entry?.id, date: s.date, status: s.status, description, reference: s.reference, departmentId: dept, projectId: s.projectId, partyId: s.partyId, paymentMethod: s.paymentMethod || null, channel: s.channel || null };
    if (!account) throw new PostingError([tab === 'transfer' ? 'Choose the account the money leaves.' : tab === 'income' ? 'Choose the account the money arrived in.' : 'Choose the account you paid from.']);
    if (tab === 'income') {
      const revenue = s.categoryId ? L.accountMap.get(s.categoryId) : undefined;
      if (!revenue) throw new PostingError(['Choose what the income is for (category).']);
      if (!s.amountMinor) throw new PostingError(['Enter the amount.']);
      return buildIncome({ ...common, moneyAccount: account, revenueAccount: revenue, grossMinor: s.amountMinor, feeMinor: s.feeOn ? s.feeMinor ?? 0 : 0, feeAccount: s.feeAccountId ? L.accountMap.get(s.feeAccountId) : null, fxRate: s.rate, invoiceId: s.invoiceId });
    }
    if (tab === 'expense') {
      const splits = s.splits.map((x) => {
        const a = x.accountId ? L.accountMap.get(x.accountId) : undefined;
        if (!a) throw new PostingError(['Choose a category for each amount.']);
        if (!x.amountMinor) throw new PostingError(['Enter the amount.']);
        return { account: a, amountMinor: x.amountMinor, projectId: x.projectId ?? s.projectId };
      });
      return buildExpense({ ...common, moneyAccount: account, splits, fxRate: s.rate, billId: s.billId });
    }
    if (!toAccount) throw new PostingError(['Choose the account the money goes to.']);
    if (!s.amountMinor || !s.receivedMinor) throw new PostingError(['Enter the amount sent and received.']);
    return buildTransfer({ ...common, fromAccount: account, toAccount, sentMinor: s.amountMinor, receivedMinor: s.receivedMinor, feeMinor: s.feeOn ? s.feeMinor ?? 0 : 0, feeAccount: s.feeAccountId ? L.accountMap.get(s.feeAccountId) : null, fromRate, toRate: s.toRate, fxAccount: L.sys('fx_difference')! });
  };
  const autoDescription = () => {
    if (tab === 'transfer') return `Transfer ${account?.name ?? ''} → ${toAccount?.name ?? ''}`;
    const cat = tab === 'income' ? L.accountMap.get(s.categoryId ?? '')?.name : L.accountMap.get(s.splits[0]?.accountId ?? '')?.name;
    return [cat, party?.name].filter(Boolean).join(' — ') || (tab === 'income' ? 'Money in' : 'Money out');
  };

  const { draft, issues } = useMemo(() => {
    try {
      if (!s.departmentId) return { draft: null, issues: ['Choose a department.'] };
      const d = build();
      const v = validatePosting(d, { accounts: L.accountMap, departments: L.deptMap, lockedThrough: lock.data ?? null, originalDate: entry?.date ?? null });
      return { draft: d, issues: v };
    } catch (e) {
      return { draft: null, issues: e instanceof PostingError ? e.issues : [errorMessage(e)] };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, L, lock.data, fromRate, entry]);

  const save = async (andNew: boolean) => {
    setSubmitted(true);
    if (!draft || issues.length) return;
    const links: EntryLinks = {};
    if (tab === 'income' && s.invoiceId) links.invoice_payments = [{ invoice_id: s.invoiceId, amount_minor: s.invoiceAmountMinor ?? (selectedInvoice && selectedInvoice.currency === currency ? s.amountMinor ?? 0 : 0) }];
    if (tab === 'expense' && s.billId) {
      const bill = openBills.find((b) => b.id === s.billId);
      links.bill_payments = [{ bill_id: s.billId, amount_minor: bill && bill.currency === currency ? expenseTotal : bill?.amount_minor ?? 0 }];
    }
    try {
      const saved = await post.mutateAsync({ draft, links });
      for (const f of files) await repo.uploadAttachment(f, { entry_id: saved.id }).catch((e) => toast.error(`${f.name}: ${errorMessage(e)}`));
      if (s.statementLineId) {
        const lines = await repo.entryLines(saved.id);
        const moneyLine = lines.find((l) => l.role === 'money' && l.account_id === s.accountId);
        if (moneyLine) await repo.reconcileLines([moneyLine.id], true, s.statementLineId);
      }
      if (tab === 'income' && s.invoiceId && selectedInvoice) {
        const paid = (paidByInvoice.get(selectedInvoice.id) ?? 0) + (links.invoice_payments?.[0].amount_minor ?? 0);
        if (paid >= selectedInvoice.total_minor && selectedInvoice.status !== 'paid') await repo.update('invoices', selectedInvoice.id, { status: 'paid' });
      }
      if (tab === 'expense' && s.billId) await repo.update('bills', s.billId, { status: 'paid' });
      remember(`quickadd.${tab}`, { accountId: s.accountId, toAccountId: s.toAccountId, departmentId: s.departmentId, categoryId: s.categoryId, channel: s.channel, paymentMethod: s.paymentMethod, feeOn: s.feeOn });
      quickAdd?.onSaved?.(saved.id);
      toast.success(`${entry ? 'Updated' : 'Saved'} ${saved.number}`, { description: draft.entry.description });
      if (andNew && !entry) {
        setS({ ...initialState(tab), accountId: s.accountId, toAccountId: s.toAccountId, departmentId: s.departmentId, date: s.date, categoryId: tab === 'income' ? s.categoryId : null, channel: s.channel, paymentMethod: s.paymentMethod, feeOn: s.feeOn, feeAccountId: s.feeAccountId });
        setFiles([]);
        setSubmitted(false);
      } else onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void save(!e.shiftKey);
    }
  };

  const moneyOpts = moneyAccountOptions(L.accounts, L.departments, { departmentIds: tab === 'income' ? undefined : writableIds });
  const deptOpts = L.departments.filter((d) => !d.archived && (tab !== 'income' || d.is_operating)).map((d) => ({ value: d.id, label: d.name, disabled: !canWriteDepartment(member, d.id, L.departments) }));
  const lkrPreview = (minor: number | null, ccy: string, rate: string) => (minor && ccy !== 'LKR' && isValidRate(rate) ? formatMoney(toLkrMinor(minor, ccy, rate)) : null);
  const accountDeptNote = tab !== 'transfer' && account && s.departmentId && account.department_id !== s.departmentId ? `${account.name} belongs to ${L.deptMap.get(account.department_id!)?.name}. The cash will sit with that department until it is moved.` : null;

  return (
    <div
      onKeyDown={onKeyDown}
      onPaste={(e) => {
        const pasted = [...e.clipboardData.files];
        if (pasted.length) setFiles((f) => [...f, ...pasted]);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        setFiles((f) => [...f, ...e.dataTransfer.files]);
      }}
    >
      <div className="grid grid-cols-2 gap-x-5 gap-y-4">
        {/* Row 1: amount + account */}
        {tab !== 'expense' || s.splits.length === 1 ? (
          <Field label={tab === 'income' ? 'Amount earned (gross)' : tab === 'transfer' ? 'Amount sent' : 'Amount paid'} hint={lkrPreview(s.amountMinor, currency, tab === 'transfer' ? fromRate : s.rate) ?? (tab === 'income' && s.feeOn ? 'Before the platform fee' : undefined)}>
            <MoneyInput
              autoFocus
              aria-label="Amount"
              currency={currency}
              value={tab === 'expense' ? s.splits[0].amountMinor : s.amountMinor}
              onChange={(v) => (tab === 'expense' ? set({ splits: [{ ...s.splits[0], amountMinor: v }] }) : set({ amountMinor: v, receivedTouched: s.receivedTouched && tab === 'transfer' }))}
            />
          </Field>
        ) : (
          <Field label="Total paid">
            <div className="flex h-9 items-center justify-end rounded-lg border border-line bg-surface-2 px-3 text-sm font-semibold tabular">{formatMoney(expenseTotal, currency)}</div>
          </Field>
        )}
        <Field label={tab === 'income' ? 'Received into' : tab === 'transfer' ? 'From account' : 'Paid from'}>
          <Combobox aria-label="Account" options={moneyOpts} value={s.accountId} onChange={(v) => set({ accountId: v, rateTouched: false })} placeholder="Choose account" />
        </Field>

        {tab === 'transfer' && (
          <>
            <Field label="Amount received" hint={currency !== toCurrency ? 'Type the amount the bank actually credited.' : undefined}>
              <MoneyInput aria-label="Amount received" currency={toCurrency} value={s.receivedMinor} onChange={(v) => set({ receivedMinor: v, receivedTouched: true })} />
            </Field>
            <Field label="To account">
              <Combobox aria-label="To account" options={moneyAccountOptions(L.accounts, L.departments).filter((o) => o.value !== s.accountId)} value={s.toAccountId} onChange={(v) => set({ toAccountId: v, toRateTouched: false, receivedTouched: false })} placeholder="Choose account" />
            </Field>
          </>
        )}

        <Field label="Date">
          <Input type="date" aria-label="Date" value={s.date} onChange={(e) => e.target.value && set({ date: e.target.value, rateTouched: currency === 'LKR' ? s.rateTouched : false })} />
        </Field>
        {tab !== 'transfer' ? (
          <Field label="Department">
            <Select aria-label="Department" value={s.departmentId ?? ''} onChange={(e) => set({ departmentId: e.target.value || null, projectId: null })} options={deptOpts} placeholder="Choose department" />
          </Field>
        ) : (
          <Field label="Reference">
            <Input aria-label="Reference" value={s.reference} onChange={(e) => set({ reference: e.target.value })} placeholder="Bank / Payoneer reference" />
          </Field>
        )}

        {tab !== 'transfer' && (
          <>
            <Field label={tab === 'income' ? 'Client' : 'Paid to (vendor)'}>
              <Combobox
                aria-label={tab === 'income' ? 'Client' : 'Vendor'}
                options={partyOptions(L.parties, tab === 'income' ? ['client'] : ['vendor', 'staff'])}
                value={s.partyId}
                onChange={(v) => set({ partyId: v, invoiceId: null, billId: null })}
                allowClear
                placeholder="Optional"
                onCreate={async (name) => {
                  try {
                    const p = await repo.insert('parties', { kind: tab === 'income' ? 'client' : 'vendor', name, default_department_id: s.departmentId });
                    await qc.invalidateQueries({ queryKey: ['parties'] });
                    set({ partyId: p.id });
                    toast.success(`Added ${name}`);
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
                createLabel="Add contact"
              />
            </Field>
            <Field label="Project">
              <Combobox aria-label="Project" options={projectOptions(L.projects, s.departmentId)} value={s.projectId} onChange={(v) => set({ projectId: v })} allowClear placeholder="Optional" emptyText="No open projects for this department." />
            </Field>
          </>
        )}

        {tab === 'income' && (
          <>
            <Field label="What is it for?">
              <Combobox aria-label="Category" options={categoryOptions(L.accounts, ['revenue', 'other_income'])} value={s.categoryId} onChange={(v) => set({ categoryId: v, categoryTouched: true })} placeholder="Choose category" />
            </Field>
            <Field label="Channel">
              <Select aria-label="Channel" value={s.channel} onChange={(e) => set({ channel: e.target.value })} options={(L.settings?.lists.channels ?? []).map((c) => ({ value: c, label: c }))} placeholder="—" />
            </Field>
          </>
        )}

        {tab === 'expense' && (
          <div className="col-span-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[13px] font-medium text-ink-2">{s.splits.length > 1 ? 'Split between categories' : 'Category'}</span>
              <Button size="sm" variant="ghost" onClick={() => set({ splits: [...s.splits, newSplit()] })}>
                <Plus /> Split
              </Button>
            </div>
            <div className="space-y-2">
              {s.splits.map((sp, i) => (
                <div key={sp.key} className="grid grid-cols-[1fr_180px_36px] items-center gap-2">
                  <Combobox aria-label={`Category ${i + 1}`} options={categoryOptions(L.accounts, ['direct_cost', 'operating', 'income_tax'])} value={sp.accountId} onChange={(v) => { set({ splits: s.splits.map((x) => (x.key === sp.key ? { ...x, accountId: v } : x)), categoryTouched: true }); }} placeholder="Choose category" />
                  {s.splits.length > 1 ? <MoneyInput aria-label={`Amount ${i + 1}`} currency={currency} value={sp.amountMinor} onChange={(v) => set({ splits: s.splits.map((x) => (x.key === sp.key ? { ...x, amountMinor: v } : x)) })} /> : <span className="text-xs text-muted">{L.accountMap.get(sp.accountId ?? '')?.category_group === 'direct_cost' ? 'Direct project cost' : ''}</span>}
                  {s.splits.length > 1 ? (
                    <Button size="icon-sm" variant="ghost" aria-label="Remove split" onClick={() => set({ splits: s.splits.filter((x) => x.key !== sp.key) })}>
                      <Trash2 />
                    </Button>
                  ) : <span />}
                </div>
              ))}
            </div>
          </div>
        )}

        {currency !== 'LKR' && (
          <Field label={tab === 'transfer' ? `Book rate (${currency} → LKR)` : `Exchange rate (${currency} → LKR)`} hint={tab === 'transfer' && carrying ? 'Average rate of the balance being moved. The difference to what arrives is the exchange gain/loss.' : spot.data ? `${spot.data.source} rate for ${spot.data.date}. Type the bank's rate if different.` : spot.isFetching ? 'Looking up today\'s rate…' : 'No rate found — enter the bank rate.'}>
            {tab === 'transfer' && carrying ? (
              <div className="flex h-9 items-center rounded-lg border border-line bg-surface-2 px-3 text-sm tabular">{formatRate(carrying)}</div>
            ) : (
              <Input aria-label="Exchange rate" inputMode="decimal" value={s.rate} onChange={(e) => set({ rate: e.target.value.replace(/[^\d.]/g, ''), rateTouched: true })} aria-invalid={submitted && !isValidRate(s.rate)} />
            )}
          </Field>
        )}
        {tab === 'transfer' && toCurrency !== 'LKR' && currency !== toCurrency && (
          <Field label={`Rate (${toCurrency} → LKR)`}>
            <Input aria-label="To rate" inputMode="decimal" value={s.toRate} onChange={(e) => set({ toRate: e.target.value.replace(/[^\d.]/g, ''), toRateTouched: true })} />
          </Field>
        )}

        {tab !== 'expense' && (
          <div className="col-span-2 rounded-lg border border-line bg-surface-2 px-4 py-3">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ink">
              <input type="checkbox" className="size-4 accent-[var(--info)]" checked={s.feeOn} onChange={(e) => set({ feeOn: e.target.checked })} />
              {tab === 'income' ? 'A fee was deducted before the money arrived (e.g. Upwork service fee)' : 'Part of the amount sent was a transfer fee'}
            </label>
            {s.feeOn && (
              <div className="mt-3 grid grid-cols-2 gap-4">
                <MoneyInput aria-label="Fee" currency={currency} value={s.feeMinor} onChange={(v) => set({ feeMinor: v })} />
                <Combobox aria-label="Fee category" options={categoryOptions(L.accounts, ['operating'])} value={s.feeAccountId} onChange={(v) => set({ feeAccountId: v })} />
                {tab === 'income' && s.amountMinor && s.feeMinor ? <p className="col-span-2 text-xs text-ink-2">Net received: <span className="font-semibold tabular">{formatMoney(s.amountMinor - s.feeMinor, currency)}</span></p> : null}
              </div>
            )}
          </div>
        )}

        {tab === 'income' && s.partyId && openInvoices.length > 0 && (
          <Field label="Settles invoice" className="col-span-2" hint={selectedInvoice && selectedInvoice.currency !== currency ? `Invoice is in ${selectedInvoice.currency} — enter how much of it this payment settles.` : undefined}>
            <div className="grid grid-cols-2 gap-4">
              <Select aria-label="Invoice" value={s.invoiceId ?? ''} onChange={(e) => {
                const inv = openInvoices.find((i) => i.id === e.target.value);
                set({ invoiceId: e.target.value || null, invoiceAmountMinor: inv ? inv.total_minor - (paidByInvoice.get(inv.id) ?? 0) : null, projectId: inv?.project_id ?? s.projectId });
              }} options={openInvoices.map((i) => ({ value: i.id, label: `${i.number} · ${formatMoney(i.total_minor - (paidByInvoice.get(i.id) ?? 0), i.currency)} due` }))} placeholder="Not linked to an invoice" />
              {selectedInvoice && <MoneyInput aria-label="Invoice amount settled" currency={selectedInvoice.currency} value={s.invoiceAmountMinor} onChange={(v) => set({ invoiceAmountMinor: v })} />}
            </div>
          </Field>
        )}
        {tab === 'expense' && s.partyId && openBills.length > 0 && (
          <Field label="Pays bill" className="col-span-2">
            <Select aria-label="Bill" value={s.billId ?? ''} onChange={(e) => set({ billId: e.target.value || null })} options={openBills.map((b) => ({ value: b.id, label: `${b.reference ?? b.description} · ${formatMoney(b.amount_minor, b.currency)}` }))} placeholder="Not linked to a bill" />
          </Field>
        )}

        <Field label="Description" className="col-span-2">
          <Input aria-label="Description" value={s.description} onChange={(e) => set({ description: e.target.value })} placeholder={autoDescription()} />
        </Field>
        {tab !== 'transfer' && (
          <Field label={tab === 'income' ? 'Invoice / contract ref' : 'Bill / receipt ref'}>
            <Input aria-label="Reference" value={s.reference} onChange={(e) => set({ reference: e.target.value })} placeholder="Optional" />
          </Field>
        )}
        <Field label="Status" hint={s.status === 'pending' ? 'Pending entries are excluded from profit and cash until cleared.' : undefined}>
          <SegmentedControl value={s.status} onChange={(v) => set({ status: v })} options={[{ value: 'cleared', label: 'Cleared' }, { value: 'pending', label: 'Pending' }]} />
        </Field>

        {/* Attachments */}
        <div className="col-span-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line-strong px-4 py-3 text-[13px] text-ink-2">
            <Upload className="size-4 text-muted" />
            <span>Drop receipts here, paste with <Kbd>Ctrl V</Kbd>, or</span>
            <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>
              browse
            </Button>
            <input ref={fileInput} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => setFiles((f) => [...f, ...(e.target.files ?? [])])} />
            {files.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-1 text-xs text-ink">
                {f.name}
                <button type="button" aria-label={`Remove ${f.name}`} className="cursor-pointer text-muted hover:text-ink" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>

      {accountDeptNote && <Callout className="mt-4" tone="info" icon={<Info />}>{accountDeptNote}</Callout>}
      {tab === 'transfer' && draft && <TransferSummary draft={draft} />}
      {submitted && issues.length > 0 && (
        <Callout className="mt-4" tone="negative" title="Please check">
          <ul className="list-disc pl-4">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="mt-6 -mx-6 -mb-5 flex items-center justify-between gap-2 border-t border-line bg-surface-2 px-6 py-3">
        <span className="text-xs text-muted">
          <Kbd>Ctrl Enter</Kbd> save &amp; new · <Kbd>Ctrl Shift Enter</Kbd> save &amp; close
        </span>
        <div className="flex gap-2">
          <Button onClick={onDone}>Cancel</Button>
          {!entry && (
            <Button onClick={() => void save(true)} loading={post.isPending}>
              Save &amp; new
            </Button>
          )}
          <Button variant="primary" onClick={() => void save(false)} loading={post.isPending}>
            {entry ? 'Save changes' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TransferSummary({ draft }: { draft: PostingDraft }): ReactNode {
  const L = useLookups();
  const fx = draft.lines.find((l) => l.role === 'fx');
  const cross = (draft.entry.meta as { cross_department?: boolean }).cross_department;
  if (!fx && !cross) return null;
  return (
    <div className="mt-4 space-y-2">
      {cross && (
        <Callout tone="info" icon={<ArrowLeftRight />}>
          Department transfer: {L.deptMap.get(draft.lines[0].department_id)?.name} → {L.deptMap.get(draft.lines.find((l) => l.role === 'money' && l.amount_minor > 0)!.department_id)?.name}. It changes each department&apos;s cash but not company profit.
        </Callout>
      )}
      {fx && (
        <Callout tone={fx.amount_lkr_minor > 0 ? 'caution' : 'positive'} icon={<Info />}>
          Realised exchange {fx.amount_lkr_minor > 0 ? 'loss' : 'gain'} of <span className="font-semibold tabular">{formatMoney(Math.abs(fx.amount_lkr_minor))}</span> will be recorded (Exchange Gain / Loss).
        </Callout>
      )}
    </div>
  );
}

