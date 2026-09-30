import { isBase, isValidRate, normaliseRate, sum, toLkrMinor } from './money';
import { isIsoDate } from './period';
import {
  BASE_CURRENCY,
  MONEY_ACCOUNT_TYPES,
  type Department,
  type EntryDraft,
  type EntryKind,
  type EntryStatus,
  type LedgerAccount,
  type LineDraft,
  type LineRole,
  type PostingDraft,
  type Uuid,
} from './types';

// Posting builders turn a simple form ("Money in", "Move money", …) into a balanced entry.
// Every entry's LKR amounts sum to exactly zero (+ = debit, − = credit). Users never see this.

export class PostingError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join('\n'));
    this.name = 'PostingError';
  }
}

export function isMoneyAccount(account: Pick<LedgerAccount, 'type'>): boolean {
  return MONEY_ACCOUNT_TYPES.includes(account.type);
}

interface CommonInput {
  id?: Uuid;
  date: string;
  status?: Exclude<EntryStatus, 'void'>;
  description: string;
  reference?: string | null;
  departmentId: Uuid;
  projectId?: Uuid | null;
  partyId?: Uuid | null;
  paymentMethod?: string | null;
  channel?: string | null;
  meta?: Record<string, unknown>;
}

function header(kind: EntryKind, i: CommonInput, extra: Partial<EntryDraft> = {}): EntryDraft {
  return {
    id: i.id,
    kind,
    date: i.date,
    status: i.status ?? 'cleared',
    department_id: i.departmentId,
    project_id: i.projectId ?? null,
    party_id: i.partyId ?? null,
    description: i.description.trim(),
    reference: i.reference?.trim() || null,
    channel: i.channel ?? null,
    payment_method: i.paymentMethod ?? null,
    invoice_id: null,
    bill_id: null,
    payroll_run_id: null,
    recurring_id: null,
    meta: i.meta ?? {},
    ...extra,
  };
}

function line(
  account: LedgerAccount,
  departmentId: Uuid,
  currency: string,
  amountMinor: number,
  rate: string,
  amountLkrMinor: number,
  role: LineRole,
  projectId: Uuid | null = null,
  memo: string | null = null,
): LineDraft {
  return {
    account_id: account.id,
    department_id: departmentId,
    project_id: projectId,
    currency,
    amount_minor: amountMinor,
    fx_rate: isBase(currency) ? '1' : normaliseRate(rate),
    amount_lkr_minor: amountLkrMinor,
    memo,
    role,
  };
}

function requireRate(currency: string, rate: string | null | undefined): string {
  if (isBase(currency)) return '1';
  if (!isValidRate(rate)) throw new PostingError([`An exchange rate to ${BASE_CURRENCY} is required for ${currency}.`]);
  return normaliseRate(rate!);
}

function requireMoneyAccount(account: LedgerAccount, label: string): string {
  if (!isMoneyAccount(account)) throw new PostingError([`${label} must be a bank, platform, cash or card account.`]);
  if (!account.currency) throw new PostingError([`${label} has no currency set.`]);
  if (!account.department_id) throw new PostingError([`${label} is not assigned to a department.`]);
  return account.currency;
}

// ---------------------------------------------------------------------------
// Money in (optionally with a platform fee deducted, e.g. Upwork)
// ---------------------------------------------------------------------------

export interface IncomeInput extends CommonInput {
  moneyAccount: LedgerAccount;
  revenueAccount: LedgerAccount;
  /** Gross amount earned, in the money account's currency. */
  grossMinor: number;
  /** Fee deducted before the money arrived (platform fee). */
  feeMinor?: number;
  feeAccount?: LedgerAccount | null;
  fxRate?: string | null;
  invoiceId?: Uuid | null;
}

export function buildIncome(i: IncomeInput): PostingDraft {
  const currency = requireMoneyAccount(i.moneyAccount, 'The receiving account');
  const rate = requireRate(currency, i.fxRate);
  const fee = i.feeMinor ?? 0;
  const issues: string[] = [];
  if (!Number.isInteger(i.grossMinor) || i.grossMinor <= 0) issues.push('Amount must be greater than zero.');
  if (!Number.isInteger(fee) || fee < 0) issues.push('Fee cannot be negative.');
  if (fee >= i.grossMinor && i.grossMinor > 0) issues.push('Fee must be less than the gross amount.');
  if (fee > 0 && !i.feeAccount) issues.push('Choose the category for the fee.');
  if (issues.length) throw new PostingError(issues);

  const net = i.grossMinor - fee;
  const moneyLkr = toLkrMinor(net, currency, rate);
  const feeLkr = fee > 0 ? toLkrMinor(fee, currency, rate) : 0;
  const project = i.projectId ?? null;
  const lines: LineDraft[] = [
    line(i.moneyAccount, i.moneyAccount.department_id!, currency, net, rate, moneyLkr, 'money', project),
  ];
  if (fee > 0) lines.push(line(i.feeAccount!, i.departmentId, currency, fee, rate, feeLkr, 'fee', project, 'Platform fee'));
  // The revenue line absorbs rounding so the entry balances exactly.
  lines.push(line(i.revenueAccount, i.departmentId, currency, -i.grossMinor, rate, -(moneyLkr + feeLkr), 'revenue', project));
  return { entry: header('income', i, { invoice_id: i.invoiceId ?? null }), lines };
}

// ---------------------------------------------------------------------------
// Money out (one or more expense categories)
// ---------------------------------------------------------------------------

export interface ExpenseSplit {
  account: LedgerAccount;
  amountMinor: number;
  projectId?: Uuid | null;
  memo?: string | null;
}

export interface ExpenseInput extends CommonInput {
  moneyAccount: LedgerAccount;
  splits: ExpenseSplit[];
  fxRate?: string | null;
  billId?: Uuid | null;
}

export function buildExpense(i: ExpenseInput): PostingDraft {
  const currency = requireMoneyAccount(i.moneyAccount, 'The paying account');
  const rate = requireRate(currency, i.fxRate);
  const issues: string[] = [];
  if (i.splits.length === 0) issues.push('Add at least one category.');
  for (const s of i.splits) {
    if (!Number.isInteger(s.amountMinor) || s.amountMinor === 0) issues.push('Each category amount must be non-zero.');
  }
  const total = sum(i.splits.map((s) => s.amountMinor));
  if (total <= 0) issues.push('The total paid must be greater than zero.');
  if (issues.length) throw new PostingError([...new Set(issues)]);

  const lines: LineDraft[] = i.splits.map((s) =>
    line(s.account, i.departmentId, currency, s.amountMinor, rate, toLkrMinor(s.amountMinor, currency, rate), 'expense', s.projectId ?? i.projectId ?? null, s.memo ?? null),
  );
  const lkrTotal = sum(lines.map((l) => l.amount_lkr_minor));
  lines.push(line(i.moneyAccount, i.moneyAccount.department_id!, currency, -total, rate, -lkrTotal, 'money', i.projectId ?? null));
  return { entry: header('expense', i, { bill_id: i.billId ?? null }), lines };
}

// ---------------------------------------------------------------------------
// Move money between any two accounts (same/different department and currency)
// ---------------------------------------------------------------------------

export interface TransferInput extends Omit<CommonInput, 'departmentId'> {
  fromAccount: LedgerAccount;
  toAccount: LedgerAccount;
  /** Total leaving the from-account, in its currency (including any fee). */
  sentMinor: number;
  /** Amount arriving in the to-account, in its currency. */
  receivedMinor: number;
  /** Part of `sentMinor` that is a transfer fee (from-account currency). */
  feeMinor?: number;
  feeAccount?: LedgerAccount | null;
  /**
   * LKR value per unit of the from-currency. For a foreign account use the average carrying
   * rate of its balance, so the difference to the LKR received is the realised exchange gain/loss.
   */
  fromRate?: string | null;
  /** LKR per unit of the to-currency (spot rate). Ignored when both currencies are equal. */
  toRate?: string | null;
  fxAccount: LedgerAccount;
}

export function buildTransfer(i: TransferInput): PostingDraft {
  const fromCcy = requireMoneyAccount(i.fromAccount, 'The from-account');
  const toCcy = requireMoneyAccount(i.toAccount, 'The to-account');
  const issues: string[] = [];
  if (i.fromAccount.id === i.toAccount.id) issues.push('Choose two different accounts.');
  if (!Number.isInteger(i.sentMinor) || i.sentMinor <= 0) issues.push('Amount sent must be greater than zero.');
  if (!Number.isInteger(i.receivedMinor) || i.receivedMinor <= 0) issues.push('Amount received must be greater than zero.');
  const fee = i.feeMinor ?? 0;
  if (fee < 0 || fee >= i.sentMinor) issues.push('Fee must be zero or less than the amount sent.');
  if (fee > 0 && !i.feeAccount) issues.push('Choose the category for the fee.');
  if (issues.length) throw new PostingError(issues);

  const fromRate = requireRate(fromCcy, i.fromRate);
  // Moving the same currency between accounts is not a conversion: keep the carrying rate.
  const toRate = fromCcy === toCcy ? fromRate : requireRate(toCcy, i.toRate);
  const fromDept = i.fromAccount.department_id!;
  const toDept = i.toAccount.department_id!;

  const lines: LineDraft[] = [line(i.fromAccount, fromDept, fromCcy, -i.sentMinor, fromRate, -toLkrMinor(i.sentMinor, fromCcy, fromRate), 'money')];
  if (fee > 0) lines.push(line(i.feeAccount!, fromDept, fromCcy, fee, fromRate, toLkrMinor(fee, fromCcy, fromRate), 'fee', null, 'Transfer fee'));
  lines.push(line(i.toAccount, toDept, toCcy, i.receivedMinor, toRate, toLkrMinor(i.receivedMinor, toCcy, toRate), 'money'));
  const difference = -sum(lines.map((l) => l.amount_lkr_minor));
  if (difference !== 0) {
    // Positive = loss (debit to the exchange-difference expense), negative = gain.
    lines.push(line(i.fxAccount, fromDept, BASE_CURRENCY, difference, '1', difference, 'fx', null, 'Exchange difference'));
  }
  const crossDepartment = fromDept !== toDept;
  return {
    entry: header('transfer', { ...i, departmentId: fromDept }, { meta: { ...(i.meta ?? {}), cross_department: crossDepartment } }),
    lines,
  };
}

// ---------------------------------------------------------------------------
// Opening balance of a money account
// ---------------------------------------------------------------------------

export interface OpeningBalanceInput {
  id?: Uuid;
  date: string;
  account: LedgerAccount;
  /** Balance in the account's currency; may be negative (e.g. a card). */
  amountMinor: number;
  fxRate?: string | null;
  equityAccount: LedgerAccount;
}

export function buildOpeningBalance(i: OpeningBalanceInput): PostingDraft {
  const currency = requireMoneyAccount(i.account, 'The account');
  const rate = requireRate(currency, i.fxRate);
  if (!Number.isInteger(i.amountMinor) || i.amountMinor === 0) throw new PostingError(['Opening balance must be non-zero.']);
  const dept = i.account.department_id!;
  const lkr = toLkrMinor(i.amountMinor, currency, rate);
  return {
    entry: header('opening_balance', {
      id: i.id,
      date: i.date,
      description: `Opening balance — ${i.account.name}`,
      departmentId: dept,
    }),
    lines: [
      line(i.account, dept, currency, i.amountMinor, rate, lkr, 'money'),
      line(i.equityAccount, dept, BASE_CURRENCY, -lkr, '1', -lkr, 'equity'),
    ],
  };
}

// ---------------------------------------------------------------------------
// Statutory payment (EPF / ETF / APIT remittance) — settles payroll liabilities
// ---------------------------------------------------------------------------

export interface StatutoryPaymentInput extends CommonInput {
  moneyAccount: LedgerAccount;
  payments: { account: LedgerAccount; amountMinor: number }[];
}

export function buildStatutoryPayment(i: StatutoryPaymentInput): PostingDraft {
  const currency = requireMoneyAccount(i.moneyAccount, 'The paying account');
  if (currency !== BASE_CURRENCY) throw new PostingError(['Statutory payments must be made from an LKR account.']);
  const payments = i.payments.filter((p) => p.amountMinor !== 0);
  if (payments.length === 0) throw new PostingError(['Enter at least one amount to pay.']);
  for (const p of payments) {
    if (p.account.type !== 'liability') throw new PostingError([`${p.account.name} is not a liability account.`]);
    if (p.amountMinor < 0) throw new PostingError(['Amounts must be positive.']);
  }
  const lines = payments.map((p) => line(p.account, i.departmentId, BASE_CURRENCY, p.amountMinor, '1', p.amountMinor, 'liability'));
  const total = sum(payments.map((p) => p.amountMinor));
  lines.push(line(i.moneyAccount, i.moneyAccount.department_id!, BASE_CURRENCY, -total, '1', -total, 'money'));
  return { entry: header('statutory_payment', i), lines };
}

// ---------------------------------------------------------------------------
// Manual adjustment (accountant journal) — LKR only
// ---------------------------------------------------------------------------

export interface AdjustmentInput extends CommonInput {
  lines: { account: LedgerAccount; departmentId: Uuid; projectId?: Uuid | null; amountMinor: number; memo?: string | null }[];
}

export function buildAdjustment(i: AdjustmentInput): PostingDraft {
  const lines = i.lines
    .filter((l) => l.amountMinor !== 0)
    .map((l) => {
      if (l.account.currency && l.account.currency !== BASE_CURRENCY) {
        throw new PostingError([`Adjustments can only use LKR accounts (${l.account.name} is ${l.account.currency}).`]);
      }
      return line(l.account, l.departmentId, BASE_CURRENCY, l.amountMinor, '1', l.amountMinor, 'adjustment', l.projectId ?? null, l.memo ?? null);
    });
  if (lines.length < 2) throw new PostingError(['An adjustment needs at least two lines.']);
  const total = sum(lines.map((l) => l.amount_lkr_minor));
  if (total !== 0) throw new PostingError([`Debits and credits differ by ${total / 100} LKR.`]);
  return { entry: header('adjustment', i), lines };
}

// ---------------------------------------------------------------------------
// Validation — the same rules are enforced again by the database (post_entry).
// ---------------------------------------------------------------------------

export interface ValidationContext {
  accounts: Map<Uuid, LedgerAccount>;
  departments: Map<Uuid, Department>;
  lockedThrough: string | null;
  /** When editing, the original date must also be outside the locked period. */
  originalDate?: string | null;
}

const PL_ROLES_ALLOWED_IN_TRANSFER: LineRole[] = ['fee', 'fx'];

export function validatePosting(draft: PostingDraft, ctx: ValidationContext): string[] {
  const issues: string[] = [];
  const { entry, lines } = draft;
  if (!isIsoDate(entry.date)) issues.push('Enter a valid date.');
  if (!entry.description?.trim()) issues.push('Add a short description.');
  const entryDept = ctx.departments.get(entry.department_id);
  if (!entryDept) issues.push('Choose a department.');
  if (ctx.lockedThrough && entry.date <= ctx.lockedThrough) issues.push(`The books are locked up to ${ctx.lockedThrough}. Choose a later date or ask an admin to unlock.`);
  if (ctx.lockedThrough && ctx.originalDate && ctx.originalDate <= ctx.lockedThrough) issues.push('This entry is in a locked period and cannot be changed.');
  if (lines.length < 2) issues.push('An entry needs at least two lines.');

  let lkrTotal = 0;
  let moneyLines = 0;
  for (const l of lines) {
    lkrTotal += l.amount_lkr_minor;
    const account = ctx.accounts.get(l.account_id);
    if (!account) {
      issues.push('A line refers to an unknown account.');
      continue;
    }
    const dept = ctx.departments.get(l.department_id);
    if (!dept) issues.push(`Line for ${account.name} has no valid department.`);
    if (!Number.isInteger(l.amount_minor) || !Number.isInteger(l.amount_lkr_minor)) issues.push('Amounts must be whole cents.');
    if (l.amount_minor === 0 && l.amount_lkr_minor === 0) issues.push(`Line for ${account.name} is zero.`);
    if (account.currency && account.currency !== l.currency) issues.push(`${account.name} is a ${account.currency} account but the line is in ${l.currency}.`);
    if (isBase(l.currency)) {
      if (l.fx_rate !== '1' || l.amount_lkr_minor !== l.amount_minor) issues.push('LKR lines must use a rate of 1.');
    } else {
      if (!isValidRate(l.fx_rate)) issues.push(`Missing exchange rate for ${l.currency}.`);
      else if (Math.abs(toLkrMinor(l.amount_minor, l.currency, l.fx_rate) - l.amount_lkr_minor) > 1) issues.push(`LKR amount for ${account.name} does not match its exchange rate.`);
    }
    if (isMoneyAccount(account)) {
      moneyLines++;
      if (account.department_id !== l.department_id) issues.push(`${account.name} belongs to another department.`);
    }
    if (account.category_group === 'revenue' && dept && !dept.is_operating) issues.push(`Revenue can only be recorded for an operating department (not ${dept.name}).`);
    if (account.category_group === 'payroll' && entry.kind !== 'payroll' && entry.kind !== 'adjustment') issues.push('Salaries and employer contributions are recorded through Payroll only.');
    if (entry.kind === 'transfer' && (account.type === 'income' || account.type === 'expense') && !PL_ROLES_ALLOWED_IN_TRANSFER.includes(l.role)) {
      issues.push('A transfer cannot include income or expense lines (other than fees and exchange differences).');
    }
    if (entry.kind === 'opening_balance' && !(isMoneyAccount(account) || account.type === 'equity')) issues.push('Opening balances only use money and equity accounts.');
    if (account.archived && !entry.id) issues.push(`${account.name} is archived.`);
  }
  if (lkrTotal !== 0) issues.push(`The entry does not balance (difference ${lkrTotal / 100} LKR).`);
  if (['income', 'expense', 'transfer', 'statutory_payment', 'opening_balance'].includes(entry.kind) && moneyLines === 0) {
    issues.push('Choose the bank, platform or cash account.');
  }
  if (entry.kind === 'transfer' && moneyLines !== 2) issues.push('A transfer moves money between exactly two accounts.');
  return [...new Set(issues)];
}

/** Money line of an entry (the account money moved in/out of). */
export function primaryMoneyLine<T extends Pick<LineDraft, 'role' | 'amount_minor'>>(lines: T[]): T | undefined {
  return lines.find((l) => l.role === 'money');
}
