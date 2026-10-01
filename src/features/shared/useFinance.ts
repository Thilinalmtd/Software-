import { useMemo } from 'react';
import { attentionItems } from '@/domain/attention';
import { toLkrMinor } from '@/domain/money';
import { addDays, today } from '@/domain/period';
import { accountBalances, ageing, countableRows, figuresFor, liabilityBalances, type ReportContext } from '@/domain/reports';
import { dueTemplates } from '@/domain/recurring';
import type { Invoice, Uuid } from '@/domain/types';
import { useCurrentRates, useLedger, useLookups, useTable } from '@/data/hooks';

/** Report context + ledger rows, ready for the domain report functions. */
export function useReportData() {
  const L = useLookups();
  const ledger = useLedger();
  const rates = useCurrentRates();
  const ctx: ReportContext = useMemo(() => ({ accounts: L.accountMap, departments: L.departments }), [L.accountMap, L.departments]);
  return { L, rows: ledger.data ?? [], loading: L.loading || ledger.isLoading, ctx, rates };
}

export function invoiceOutstanding(invoices: Invoice[], payments: { invoice_id: Uuid; amount_minor: number; entry_id: Uuid }[], voidEntryIds: Set<Uuid>) {
  const paid = new Map<Uuid, number>();
  for (const p of payments) if (!voidEntryIds.has(p.entry_id)) paid.set(p.invoice_id, (paid.get(p.invoice_id) ?? 0) + p.amount_minor);
  return invoices
    .filter((i) => i.kind === 'invoice' && i.status !== 'void' && i.status !== 'draft')
    .map((i) => ({ invoice: i, paid: paid.get(i.id) ?? 0, outstanding: Math.max(0, i.total_minor - (paid.get(i.id) ?? 0)) }));
}

export function useReceivables() {
  const invoices = useTable('invoices');
  const payments = useTable('invoice_payments');
  const entries = useTable('entries');
  const rates = useCurrentRates();
  return useMemo(() => {
    const voidIds = new Set((entries.data ?? []).filter((e) => e.status === 'void').map((e) => e.id));
    const list = invoiceOutstanding(invoices.data ?? [], payments.data ?? [], voidIds);
    const asOf = today();
    const aged = ageing(list.map((x) => ({ id: x.invoice.id, dueDate: x.invoice.due_date, currency: x.invoice.currency, outstandingMinor: x.outstanding })), asOf, rates);
    return { list, aged, loading: invoices.isLoading || payments.isLoading };
  }, [invoices.data, payments.data, entries.data, rates, invoices.isLoading, payments.isLoading]);
}

export function useBillsDue() {
  const bills = useTable('bills');
  const payments = useTable('bill_payments');
  const rates = useCurrentRates();
  return useMemo(() => {
    const paid = new Map<Uuid, number>();
    for (const p of payments.data ?? []) paid.set(p.bill_id, (paid.get(p.bill_id) ?? 0) + p.amount_minor);
    const open = (bills.data ?? []).filter((b) => b.status === 'open');
    const asOf = today();
    const aged = ageing(open.map((b) => ({ id: b.id, dueDate: b.due_date, currency: b.currency, outstandingMinor: b.amount_minor - (paid.get(b.id) ?? 0) })), asOf, rates);
    return {
      open,
      aged,
      dueSoon: open.filter((b) => b.due_date && b.due_date >= asOf && b.due_date <= addDays(asOf, 7)).length,
      overdue: open.filter((b) => b.due_date && b.due_date < asOf).length,
    };
  }, [bills.data, payments.data, rates]);
}

export function useAttention() {
  const { L, rows, rates } = useReportData();
  const attachments = useTable('attachments');
  const recurring = useTable('recurring_templates');
  const receivables = useReceivables();
  const bills = useBillsDue();
  return useMemo(() => {
    if (!L.settings) return [];
    const asOf = today();
    const overdue = receivables.list.filter((x) => x.outstanding > 0 && x.invoice.due_date && x.invoice.due_date < asOf);
    return attentionItems({
      asOf,
      settings: L.settings,
      rows,
      accounts: L.accountMap,
      balances: accountBalances(rows, L.accounts, rates),
      liabilities: liabilityBalances(rows, L.accounts).filter((l) => l.account.type === 'liability'),
      entriesWithAttachments: new Set((attachments.data ?? []).map((a) => a.entry_id).filter((x): x is string => !!x)),
      overdueInvoices: { count: overdue.length, totalLkrMinor: overdue.reduce((s, x) => s + (x.invoice.currency === 'LKR' ? x.outstanding : rates[x.invoice.currency] ? toLkrMinor(x.outstanding, x.invoice.currency, rates[x.invoice.currency]) : 0), 0) },
      billsDueSoon: { count: bills.dueSoon, overdue: bills.overdue },
      dueRecurring: dueTemplates(recurring.data ?? [], asOf, 3),
    });
  }, [L, rows, rates, attachments.data, recurring.data, receivables, bills]);
}

/** Figures for a period, for the whole company or one department. */
export function usePeriodFigures(range: { from: string; to: string }) {
  const { rows, ctx } = useReportData();
  return useMemo(() => figuresFor(countableRows(rows, { range }), ctx), [rows, ctx, range]);
}
