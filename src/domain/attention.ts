import { formatMoney } from './money';
import { addDays, daysBetween, formatDate, monthEnd, addMonths, makeIso, parseIso } from './period';
import type { AccountBalance } from './reports';
import type { CompanySettings, IsoDate, LedgerAccount, LedgerRow, RecurringTemplate, Uuid } from './types';

// "Needs attention" nudges shown on the dashboard.

export type AttentionSeverity = 'danger' | 'warning' | 'info';

export interface AttentionItem {
  id: string;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  link: string;
}

export interface AttentionInput {
  asOf: IsoDate;
  settings: CompanySettings;
  rows: LedgerRow[];
  accounts: Map<Uuid, LedgerAccount>;
  balances: AccountBalance[];
  liabilities: { account: LedgerAccount; owedMinor: number }[];
  entriesWithAttachments: Set<Uuid>;
  overdueInvoices: { count: number; totalLkrMinor: number };
  billsDueSoon: { count: number; overdue: number };
  dueRecurring: RecurringTemplate[];
}

/** EPF/ETF are due by the end of the following month, APIT by the 15th of the following month. */
export function statutoryDueDate(systemKey: string | null, asOf: IsoDate): IsoDate {
  const next = addMonths(makeIso(parseIso(asOf).y, parseIso(asOf).m, 1), 1);
  return systemKey === 'apit_payable' ? makeIso(parseIso(next).y, parseIso(next).m, 15) : monthEnd(next);
}

export function attentionItems(i: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  // Negative cash
  for (const b of i.balances) {
    if (b.balanceMinor < 0 && b.account.type !== 'card' && !b.account.archived) {
      items.push({ id: `neg-${b.account.id}`, severity: 'danger', title: `${b.account.name} is overdrawn`, detail: `Balance ${formatMoney(b.balanceMinor, b.account.currency ?? 'LKR')}. A transfer may be missing.`, link: `/accounts/${b.account.id}` });
    }
  }

  // Reconciliation
  for (const b of i.balances) {
    if (b.account.archived || b.unreconciledCount === 0) continue;
    const last = b.account.last_reconciled_date;
    const days = last ? daysBetween(last, i.asOf) : null;
    if (days === null || days > i.settings.attention.reconcile_after_days) {
      items.push({
        id: `rec-${b.account.id}`,
        severity: 'warning',
        title: `Reconcile ${b.account.name}`,
        detail: last ? `Last reconciled ${days} days ago (${formatDate(last)}). ${b.unreconciledCount} unticked item(s).` : `Never reconciled. ${b.unreconciledCount} unticked item(s).`,
        link: `/reconcile/${b.account.id}`,
      });
    }
  }

  // Statutory liabilities
  for (const l of i.liabilities) {
    if (l.owedMinor <= 0 || !l.account.system_key) continue;
    const due = statutoryDueDate(l.account.system_key, i.asOf);
    items.push({ id: `stat-${l.account.id}`, severity: daysBetween(i.asOf, due) <= 7 ? 'danger' : 'warning', title: `${l.account.name.replace(' Payable', '')} to pay: ${formatMoney(l.owedMinor)}`, detail: `Pay by ${formatDate(due)}.`, link: '/payroll?tab=statutory' });
  }

  // Missing receipts on larger expenses (last 90 days)
  const since = addDays(i.asOf, -90);
  const missing = new Map<Uuid, LedgerRow>();
  for (const r of i.rows) {
    if (r.kind !== 'expense' || r.status === 'void' || r.role !== 'money' || r.date < since) continue;
    if (-r.amount_lkr_minor >= i.settings.attention.receipt_required_above_minor && !i.entriesWithAttachments.has(r.entry_id)) missing.set(r.entry_id, r);
  }
  if (missing.size) items.push({ id: 'receipts', severity: 'info', title: `${missing.size} expense(s) without a receipt`, detail: `Over ${formatMoney(i.settings.attention.receipt_required_above_minor, 'LKR', { whole: true })} in the last 90 days.`, link: '/entries?filter=missing-receipt' });

  // Direct costs with no project
  const noProject = new Set<Uuid>();
  for (const r of i.rows) {
    if (r.status === 'void' || r.project_id) continue;
    if (i.accounts.get(r.account_id)?.category_group === 'direct_cost') noProject.add(r.entry_id);
  }
  if (noProject.size) items.push({ id: 'noproject', severity: 'info', title: `${noProject.size} direct project cost(s) without a project`, detail: 'Project profitability will be understated.', link: '/entries?filter=direct-no-project' });

  // Pending entries older than 7 days
  const stale = new Set<Uuid>();
  for (const r of i.rows) if (r.status === 'pending' && daysBetween(r.date, i.asOf) > 7) stale.add(r.entry_id);
  if (stale.size) items.push({ id: 'pending', severity: 'info', title: `${stale.size} pending entr${stale.size === 1 ? 'y' : 'ies'} older than a week`, detail: 'Mark them cleared once the money has arrived or left.', link: '/entries?status=pending' });

  if (i.overdueInvoices.count) items.push({ id: 'overdue-inv', severity: 'warning', title: `${i.overdueInvoices.count} overdue invoice(s)`, detail: `${formatMoney(i.overdueInvoices.totalLkrMinor, 'LKR', { whole: true })} to collect.`, link: '/invoices?filter=overdue' });
  if (i.billsDueSoon.overdue) items.push({ id: 'overdue-bills', severity: 'danger', title: `${i.billsDueSoon.overdue} overdue bill(s)`, detail: 'Pay or update their due dates.', link: '/bills' });
  else if (i.billsDueSoon.count) items.push({ id: 'bills-soon', severity: 'warning', title: `${i.billsDueSoon.count} bill(s) due within 7 days`, detail: 'See Bills to pay.', link: '/bills' });
  if (i.dueRecurring.length) items.push({ id: 'recurring', severity: 'info', title: `${i.dueRecurring.length} recurring item(s) ready to post`, detail: i.dueRecurring.slice(0, 3).map((t) => t.name).join(', '), link: '/recurring' });

  const order: Record<AttentionSeverity, number> = { danger: 0, warning: 1, info: 2 };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}
