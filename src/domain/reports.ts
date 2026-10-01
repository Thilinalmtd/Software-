import { carryingRate, isBase, pctOf, toLkrMinor } from './money';
import { calendarQuarter, fiscalYear, inRange, monthKey, addDays, addMonths, type DateRange } from './period';
import {
  MONEY_ACCOUNT_TYPES,
  type Budget,
  type CategoryGroup,
  type CompanySettings,
  type Department,
  type IsoDate,
  type LedgerAccount,
  type LedgerRow,
  type Project,
  type ThresholdPeriod,
  type Uuid,
} from './types';

// Management reports (cash basis, LKR). Only cleared entries count unless a report asks for
// pending ones; voided entries never count. These mirror the Excel workbook's formulas.

export interface ReportContext {
  accounts: Map<Uuid, LedgerAccount>;
  departments: Department[];
}

export interface RowFilter {
  range?: DateRange;
  includePending?: boolean;
  departmentId?: Uuid | null;
}

export function countableRows(rows: LedgerRow[], f: RowFilter = {}): LedgerRow[] {
  return rows.filter(
    (r) =>
      r.status !== 'void' &&
      (f.includePending || r.status === 'cleared') &&
      (!f.range || inRange(r.date, f.range)) &&
      (!f.departmentId || r.department_id === f.departmentId),
  );
}

export function isMoneyType(account: LedgerAccount | undefined): boolean {
  return !!account && MONEY_ACCOUNT_TYPES.includes(account.type);
}

function groupOf(account: LedgerAccount | undefined): CategoryGroup | null {
  if (!account || (account.type !== 'income' && account.type !== 'expense')) return null;
  return account.category_group ?? (account.type === 'income' ? 'revenue' : 'operating');
}

// ---------------------------------------------------------------------------
// Department figures (the building block of the dashboard and Monthly Summary)
// ---------------------------------------------------------------------------

export interface DeptFigures {
  revenue: number;
  otherIncome: number;
  directCosts: number;
  operatingExpenses: number;
  /** direct + operating (the Excel "Expenses" column) */
  expenses: number;
  payroll: number;
  operatingProfit: number;
  margin: number | null;
  incomeTax: number;
  /** Net inflow from other departments via transfers. */
  transferNet: number;
  /** Actual change in the department's money accounts (excludes opening balances). */
  netCash: number;
}

export function emptyFigures(): DeptFigures {
  return { revenue: 0, otherIncome: 0, directCosts: 0, operatingExpenses: 0, expenses: 0, payroll: 0, operatingProfit: 0, margin: null, incomeTax: 0, transferNet: 0, netCash: 0 };
}

function accumulate(fig: DeptFigures, row: LedgerRow, account: LedgerAccount | undefined): void {
  const amt = row.amount_lkr_minor;
  switch (groupOf(account)) {
    case 'revenue':
      fig.revenue -= amt;
      break;
    case 'other_income':
      fig.otherIncome -= amt;
      break;
    case 'direct_cost':
      fig.directCosts += amt;
      break;
    case 'operating':
      fig.operatingExpenses += amt;
      break;
    case 'payroll':
      fig.payroll += amt;
      break;
    case 'income_tax':
      fig.incomeTax += amt;
      break;
  }
  if (row.kind === 'transfer') fig.transferNet += amt;
  if (isMoneyType(account) && row.kind !== 'opening_balance') fig.netCash += amt;
}

function finalise(fig: DeptFigures): DeptFigures {
  fig.expenses = fig.directCosts + fig.operatingExpenses;
  fig.operatingProfit = fig.revenue + fig.otherIncome - fig.expenses - fig.payroll;
  fig.margin = fig.revenue !== 0 ? fig.operatingProfit / fig.revenue : null;
  return fig;
}

export interface CompanyFigures {
  byDept: Record<Uuid, DeptFigures>;
  /** Costs of non-operating departments (Corporate / Shared), net of their other income. */
  corporateCost: number;
  revenue: number;
  otherIncome: number;
  totalCost: number;
  operatingProfit: number;
  margin: number | null;
  netCash: number;
}

export function figuresFor(rows: LedgerRow[], ctx: ReportContext): CompanyFigures {
  const byDept: Record<Uuid, DeptFigures> = {};
  for (const d of ctx.departments) byDept[d.id] = emptyFigures();
  for (const r of rows) {
    const fig = (byDept[r.department_id] ??= emptyFigures());
    accumulate(fig, r, ctx.accounts.get(r.account_id));
  }
  let revenue = 0, otherIncome = 0, totalCost = 0, corporateCost = 0, netCash = 0;
  for (const d of ctx.departments) {
    const f = finalise(byDept[d.id]);
    revenue += f.revenue;
    otherIncome += f.otherIncome;
    totalCost += f.expenses + f.payroll;
    netCash += f.netCash;
    if (!d.is_operating) corporateCost += f.expenses + f.payroll - f.otherIncome;
  }
  const operatingProfit = revenue + otherIncome - totalCost;
  return { byDept, corporateCost, revenue, otherIncome, totalCost, operatingProfit, margin: revenue ? operatingProfit / revenue : null, netCash };
}

export interface MonthlySummaryRow {
  month: IsoDate;
  figures: CompanyFigures;
}

/** Excel "Monthly Summary": one row per month, plus a total row. */
export function monthlySummary(rows: LedgerRow[], ctx: ReportContext, months: IsoDate[], f: RowFilter = {}): { months: MonthlySummaryRow[]; total: CompanyFigures } {
  const valid = countableRows(rows, { includePending: f.includePending });
  const byMonth = new Map<string, LedgerRow[]>();
  for (const r of valid) {
    const k = monthKey(r.date);
    let list = byMonth.get(k);
    if (!list) byMonth.set(k, (list = []));
    list.push(r);
  }
  const keys = new Set(months.map(monthKey));
  const result = months.map((m) => ({ month: m, figures: figuresFor(byMonth.get(monthKey(m)) ?? [], ctx) }));
  const total = figuresFor(valid.filter((r) => keys.has(monthKey(r.date))), ctx);
  return { months: result, total };
}

// ---------------------------------------------------------------------------
// Profit & loss by department, with optional shared-cost allocation
// ---------------------------------------------------------------------------

export interface PLAccountLine {
  account: LedgerAccount;
  byDept: Record<Uuid, number>;
  total: number;
}

export interface PLSection {
  group: CategoryGroup;
  label: string;
  lines: PLAccountLine[];
  byDept: Record<Uuid, number>;
  total: number;
}

export const GROUP_LABELS: Record<CategoryGroup, string> = {
  revenue: 'Revenue',
  other_income: 'Other income',
  direct_cost: 'Direct project costs',
  operating: 'Operating expenses',
  payroll: 'Payroll',
  income_tax: 'Tax on profits',
};

const GROUP_ORDER: CategoryGroup[] = ['revenue', 'other_income', 'direct_cost', 'payroll', 'operating', 'income_tax'];

export interface ProfitAndLoss {
  sections: PLSection[];
  figures: CompanyFigures;
  allocation: Record<Uuid, number>;
  fullyLoaded: Record<Uuid, number>;
  netProfit: Record<Uuid, number> & { total?: number };
  netProfitTotal: number;
}

export function allocateSharedCost(figures: CompanyFigures, ctx: ReportContext, settings: CompanySettings['allocation']): Record<Uuid, number> {
  const operating = ctx.departments.filter((d) => d.is_operating);
  const result: Record<Uuid, number> = {};
  for (const d of operating) result[d.id] = 0;
  if (settings.method === 'none' || operating.length === 0 || figures.corporateCost === 0) return result;
  let weights: number[];
  if (settings.method === 'fixed') weights = operating.map((d) => settings.fixed_pct[d.id] ?? 0);
  else weights = operating.map((d) => Math.max(0, figures.byDept[d.id]?.revenue ?? 0));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) weights = operating.map(() => 1);
  const tw = weights.reduce((a, b) => a + b, 0);
  let allocated = 0;
  operating.forEach((d, i) => {
    const share = i === operating.length - 1 ? figures.corporateCost - allocated : Math.round((figures.corporateCost * weights[i]) / tw);
    result[d.id] = share;
    allocated += share;
  });
  return result;
}

export function profitAndLoss(rows: LedgerRow[], ctx: ReportContext, f: RowFilter, allocationSettings: CompanySettings['allocation']): ProfitAndLoss {
  const valid = countableRows(rows, f);
  const sections = new Map<CategoryGroup, PLSection>();
  for (const g of GROUP_ORDER) sections.set(g, { group: g, label: GROUP_LABELS[g], lines: [], byDept: {}, total: 0 });
  const lineMap = new Map<Uuid, PLAccountLine>();
  for (const r of valid) {
    const account = ctx.accounts.get(r.account_id);
    const g = groupOf(account);
    if (!g || !account) continue;
    const sign = account.type === 'income' ? -1 : 1;
    const value = sign * r.amount_lkr_minor;
    const section = sections.get(g)!;
    let pl = lineMap.get(account.id);
    if (!pl) {
      pl = { account, byDept: {}, total: 0 };
      lineMap.set(account.id, pl);
      section.lines.push(pl);
    }
    pl.byDept[r.department_id] = (pl.byDept[r.department_id] ?? 0) + value;
    pl.total += value;
    section.byDept[r.department_id] = (section.byDept[r.department_id] ?? 0) + value;
    section.total += value;
  }
  for (const s of sections.values()) s.lines.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  const figures = figuresFor(valid, ctx);
  const allocation = allocateSharedCost(figures, ctx, allocationSettings);
  const fullyLoaded: Record<Uuid, number> = {};
  const netProfit: Record<Uuid, number> = {};
  let netProfitTotal = 0;
  for (const d of ctx.departments) {
    const fig = figures.byDept[d.id];
    if (d.is_operating) fullyLoaded[d.id] = fig.operatingProfit - (allocation[d.id] ?? 0);
    netProfit[d.id] = fig.operatingProfit - fig.incomeTax;
    netProfitTotal += netProfit[d.id];
  }
  return { sections: GROUP_ORDER.map((g) => sections.get(g)!).filter((s) => s.lines.length > 0 || s.group === 'revenue'), figures, allocation, fullyLoaded, netProfit, netProfitTotal };
}

// ---------------------------------------------------------------------------
// Account balances (own currency + LKR value + unrealised exchange difference)
// ---------------------------------------------------------------------------

export interface AccountBalance {
  account: LedgerAccount;
  /** Cleared balance in the account's currency. */
  balanceMinor: number;
  /** LKR book value (sum of posted LKR amounts). */
  bookLkrMinor: number;
  /** LKR value at the current rate (= book value for LKR accounts or when no rate is known). */
  currentLkrMinor: number;
  unrealisedLkrMinor: number;
  pendingMinor: number;
  lastActivity: IsoDate | null;
  unreconciledCount: number;
}

export function accountBalances(rows: LedgerRow[], accounts: LedgerAccount[], rates: Record<string, string>, asOf?: IsoDate): AccountBalance[] {
  const map = new Map<Uuid, AccountBalance>();
  for (const a of accounts) {
    if (!MONEY_ACCOUNT_TYPES.includes(a.type)) continue;
    map.set(a.id, { account: a, balanceMinor: 0, bookLkrMinor: 0, currentLkrMinor: 0, unrealisedLkrMinor: 0, pendingMinor: 0, lastActivity: null, unreconciledCount: 0 });
  }
  for (const r of rows) {
    const b = map.get(r.account_id);
    if (!b || r.status === 'void' || (asOf && r.date > asOf)) continue;
    if (r.status === 'pending') {
      b.pendingMinor += r.amount_minor;
      continue;
    }
    b.balanceMinor += r.amount_minor;
    b.bookLkrMinor += r.amount_lkr_minor;
    if (!b.lastActivity || r.date > b.lastActivity) b.lastActivity = r.date;
    if (!r.reconciled) b.unreconciledCount++;
  }
  for (const b of map.values()) {
    const ccy = b.account.currency ?? 'LKR';
    const rate = rates[ccy];
    b.currentLkrMinor = isBase(ccy) ? b.balanceMinor : rate ? toLkrMinor(b.balanceMinor, ccy, rate) : b.bookLkrMinor;
    b.unrealisedLkrMinor = b.currentLkrMinor - b.bookLkrMinor;
  }
  return [...map.values()];
}

/** Outstanding balances of liability accounts (EPF/ETF/APIT payable…), positive = owed. */
export function liabilityBalances(rows: LedgerRow[], accounts: LedgerAccount[]): { account: LedgerAccount; owedMinor: number }[] {
  const liab = accounts.filter((a) => a.type === 'liability' || a.type === 'payable');
  return liab.map((account) => ({
    account,
    owedMinor: -rows.filter((r) => r.account_id === account.id && r.status === 'cleared').reduce((s, r) => s + r.amount_lkr_minor, 0),
  }));
}

// ---------------------------------------------------------------------------
// Spending, channels, cash flow
// ---------------------------------------------------------------------------

export function spendByCategory(rows: LedgerRow[], ctx: ReportContext, f: RowFilter): { account: LedgerAccount; totalMinor: number }[] {
  const totals = new Map<Uuid, number>();
  for (const r of countableRows(rows, f)) {
    const a = ctx.accounts.get(r.account_id);
    const g = groupOf(a);
    if (g === 'direct_cost' || g === 'operating' || g === 'payroll') totals.set(r.account_id, (totals.get(r.account_id) ?? 0) + r.amount_lkr_minor);
  }
  return [...totals.entries()]
    .map(([id, totalMinor]) => ({ account: ctx.accounts.get(id)!, totalMinor }))
    .filter((x) => x.totalMinor > 0)
    .sort((a, b) => b.totalMinor - a.totalMinor);
}

export function revenueByChannel(rows: LedgerRow[], ctx: ReportContext, f: RowFilter): { channel: string; totalMinor: number }[] {
  const totals = new Map<string, number>();
  for (const r of countableRows(rows, f)) {
    if (groupOf(ctx.accounts.get(r.account_id)) !== 'revenue') continue;
    const key = r.channel || 'Unspecified';
    totals.set(key, (totals.get(key) ?? 0) - r.amount_lkr_minor);
  }
  return [...totals.entries()].map(([channel, totalMinor]) => ({ channel, totalMinor })).sort((a, b) => b.totalMinor - a.totalMinor);
}

export interface CashFlowMonth {
  month: IsoDate;
  receipts: number;
  payments: number;
  payroll: number;
  statutory: number;
  transfersNet: number;
  other: number;
  net: number;
}

/** Direct-method cash flow from money-account movements, per month. */
export function cashFlow(rows: LedgerRow[], ctx: ReportContext, months: IsoDate[], f: RowFilter = {}): CashFlowMonth[] {
  const keys = new Map(months.map((m) => [monthKey(m), { month: m, receipts: 0, payments: 0, payroll: 0, statutory: 0, transfersNet: 0, other: 0, net: 0 } as CashFlowMonth]));
  for (const r of countableRows(rows, { includePending: f.includePending, departmentId: f.departmentId })) {
    if (!isMoneyType(ctx.accounts.get(r.account_id)) || r.kind === 'opening_balance') continue;
    const m = keys.get(monthKey(r.date));
    if (!m) continue;
    const amt = r.amount_lkr_minor;
    if (r.kind === 'income') m.receipts += amt;
    else if (r.kind === 'expense') m.payments += amt;
    else if (r.kind === 'payroll') m.payroll += amt;
    else if (r.kind === 'statutory_payment') m.statutory += amt;
    else if (r.kind === 'transfer') m.transfersNet += amt;
    else m.other += amt;
    m.net += amt;
  }
  return [...keys.values()];
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ProjectFigures {
  project: Project;
  revenue: number;
  directCosts: number;
  payroll: number;
  otherCosts: number;
  /** Excel definition: revenue − direct costs − allocated payroll */
  contribution: number;
  margin: number | null;
  contractValueLkr: number | null;
  receivedPct: number | null;
}

export function projectFigures(rows: LedgerRow[], projects: Project[], ctx: ReportContext, f: RowFilter = {}, rates: Record<string, string> = {}): ProjectFigures[] {
  const byProject = new Map<Uuid, ProjectFigures>();
  for (const p of projects) {
    let contractValueLkr: number | null = null;
    if (p.contract_value_minor !== null) {
      const rate = isBase(p.contract_currency) ? '1' : p.planning_fx_rate || rates[p.contract_currency];
      contractValueLkr = rate ? toLkrMinor(p.contract_value_minor, p.contract_currency, rate) : null;
    }
    byProject.set(p.id, { project: p, revenue: 0, directCosts: 0, payroll: 0, otherCosts: 0, contribution: 0, margin: null, contractValueLkr, receivedPct: null });
  }
  for (const r of countableRows(rows, f)) {
    if (!r.project_id) continue;
    const pf = byProject.get(r.project_id);
    if (!pf) continue;
    const g = groupOf(ctx.accounts.get(r.account_id));
    if (g === 'revenue') pf.revenue -= r.amount_lkr_minor;
    else if (g === 'direct_cost') pf.directCosts += r.amount_lkr_minor;
    else if (g === 'payroll') pf.payroll += r.amount_lkr_minor;
    else if (g === 'operating') pf.otherCosts += r.amount_lkr_minor;
  }
  for (const pf of byProject.values()) {
    pf.contribution = pf.revenue - pf.directCosts - pf.payroll;
    pf.margin = pf.revenue ? pf.contribution / pf.revenue : null;
    pf.receivedPct = pf.contractValueLkr ? pf.revenue / pf.contractValueLkr : null;
  }
  return [...byProject.values()];
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export interface BudgetLine {
  account: LedgerAccount;
  budget: number;
  actual: number;
  variance: number; // favourable positive
  byMonth: { month: IsoDate; budget: number; actual: number }[];
}

export function budgetVsActual(rows: LedgerRow[], budgets: Budget[], ctx: ReportContext, months: IsoDate[], departmentId?: Uuid | null): BudgetLine[] {
  const monthKeys = months.map(monthKey);
  const lines = new Map<Uuid, BudgetLine>();
  const ensure = (accountId: Uuid): BudgetLine | undefined => {
    const account = ctx.accounts.get(accountId);
    if (!account || (account.type !== 'income' && account.type !== 'expense')) return undefined;
    let l = lines.get(accountId);
    if (!l) {
      l = { account, budget: 0, actual: 0, variance: 0, byMonth: months.map((m) => ({ month: m, budget: 0, actual: 0 })) };
      lines.set(accountId, l);
    }
    return l;
  };
  for (const b of budgets) {
    if (departmentId && b.department_id !== departmentId) continue;
    const idx = monthKeys.indexOf(monthKey(b.month));
    if (idx < 0) continue;
    const l = ensure(b.account_id);
    if (!l) continue;
    l.byMonth[idx].budget += b.amount_lkr_minor;
    l.budget += b.amount_lkr_minor;
  }
  for (const r of countableRows(rows, { departmentId })) {
    const idx = monthKeys.indexOf(monthKey(r.date));
    if (idx < 0 || !lines.has(r.account_id)) continue;
    const l = lines.get(r.account_id)!;
    const v = l.account.type === 'income' ? -r.amount_lkr_minor : r.amount_lkr_minor;
    l.byMonth[idx].actual += v;
    l.actual += v;
  }
  for (const l of lines.values()) l.variance = l.account.type === 'income' ? l.actual - l.budget : l.budget - l.actual;
  return [...lines.values()].sort((a, b) => a.account.type.localeCompare(b.account.type) || a.account.name.localeCompare(b.account.name));
}

// ---------------------------------------------------------------------------
// Tax monitor (estimates only — rates and thresholds come from Settings)
// ---------------------------------------------------------------------------

export function thresholdAt(periods: ThresholdPeriod[], date: IsoDate): ThresholdPeriod | null {
  const applicable = periods.filter((p) => p.effective_from <= date).sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return applicable[0] ?? null;
}

export interface TaxMonitor {
  fyLabel: string;
  fyRange: DateRange;
  fyRevenue: number;
  fyOperatingProfit: number;
  incomeTaxProvision: number;
  quarter: DateRange;
  quarterTurnover: number;
  rolling12Turnover: number;
  sscl: { threshold: ThresholdPeriod | null; quarterExceeded: boolean; annualExceeded: boolean; estimateOnQuarter: number };
  vat: { threshold: ThresholdPeriod | null; quarterExceeded: boolean; annualExceeded: boolean };
}

export function taxMonitor(rows: LedgerRow[], ctx: ReportContext, settings: CompanySettings, asOf: IsoDate): TaxMonitor {
  const fy = fiscalYear(asOf, settings.fy_start_month);
  const fyRange = { from: fy.range.from, to: asOf };
  const fyFig = figuresFor(countableRows(rows, { range: fyRange }), ctx);
  const quarter = calendarQuarter(asOf);
  const quarterFig = figuresFor(countableRows(rows, { range: { from: quarter.from, to: asOf } }), ctx);
  const rolling = figuresFor(countableRows(rows, { range: { from: addDays(addMonths(asOf, -12), 1), to: asOf } }), ctx);
  const ssclT = thresholdAt(settings.tax.sscl_thresholds, asOf);
  const vatT = thresholdAt(settings.tax.vat_thresholds, asOf);
  return {
    fyLabel: fy.label,
    fyRange,
    fyRevenue: fyFig.revenue,
    fyOperatingProfit: fyFig.operatingProfit,
    incomeTaxProvision: Math.max(0, pctOf(fyFig.operatingProfit, settings.tax.income_tax_pct)),
    quarter,
    quarterTurnover: quarterFig.revenue,
    rolling12Turnover: rolling.revenue,
    sscl: {
      threshold: ssclT,
      quarterExceeded: !!ssclT && quarterFig.revenue > ssclT.quarterly_minor,
      annualExceeded: !!ssclT && rolling.revenue > ssclT.annual_minor,
      estimateOnQuarter: pctOf(quarterFig.revenue, settings.tax.sscl_pct),
    },
    vat: {
      threshold: vatT,
      quarterExceeded: !!vatT && quarterFig.revenue > vatT.quarterly_minor,
      annualExceeded: !!vatT && rolling.revenue > vatT.annual_minor,
    },
  };
}

// ---------------------------------------------------------------------------
// Receivables / payables ageing
// ---------------------------------------------------------------------------

export type AgeBucket = 'not_due' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';
export const AGE_BUCKET_LABELS: Record<AgeBucket, string> = {
  not_due: 'Not yet due',
  d1_30: '1–30 days',
  d31_60: '31–60 days',
  d61_90: '61–90 days',
  d90_plus: 'Over 90 days',
};

export function ageBucket(dueDate: IsoDate | null, asOf: IsoDate): AgeBucket {
  if (!dueDate || dueDate >= asOf) return 'not_due';
  const days = Math.round((Date.parse(asOf) - Date.parse(dueDate)) / 86_400_000);
  if (days <= 30) return 'd1_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd90_plus';
}

export interface AgeingItem {
  id: Uuid;
  dueDate: IsoDate | null;
  currency: string;
  outstandingMinor: number;
}

export function ageing(items: AgeingItem[], asOf: IsoDate, rates: Record<string, string>): { buckets: Record<AgeBucket, number>; totalLkr: number; itemBuckets: Map<Uuid, AgeBucket> } {
  const buckets: Record<AgeBucket, number> = { not_due: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  const itemBuckets = new Map<Uuid, AgeBucket>();
  let totalLkr = 0;
  for (const it of items) {
    if (it.outstandingMinor <= 0) continue;
    const b = ageBucket(it.dueDate, asOf);
    const rate = isBase(it.currency) ? '1' : rates[it.currency];
    const lkr = rate ? toLkrMinor(it.outstandingMinor, it.currency, rate) : 0;
    buckets[b] += lkr;
    totalLkr += lkr;
    itemBuckets.set(it.id, b);
  }
  return { buckets, totalLkr, itemBuckets };
}

/** Average LKR carrying rate of a foreign-currency account's cleared balance (null when empty). */
export function carryingRateFor(rows: LedgerRow[], account: LedgerAccount, asOf?: IsoDate): string | null {
  if (!account.currency || isBase(account.currency)) return '1';
  let balance = 0;
  let book = 0;
  for (const r of rows) {
    if (r.account_id !== account.id || r.status !== 'cleared' || (asOf && r.date > asOf)) continue;
    balance += r.amount_minor;
    book += r.amount_lkr_minor;
  }
  return carryingRate(balance, book, account.currency);
}

// ---------------------------------------------------------------------------
// Trial balance (for the accountant): balance-sheet accounts cumulative to the end date,
// income/expense accounts for the period, and earlier profit carried in "Retained profit".
// ---------------------------------------------------------------------------

export interface TrialBalanceLine {
  account: LedgerAccount | null; // null = retained profit brought forward
  label: string;
  debit: number;
  credit: number;
}

export function trialBalance(rows: LedgerRow[], accounts: Map<Uuid, LedgerAccount>, range: DateRange): { lines: TrialBalanceLine[]; totalDebit: number; totalCredit: number } {
  const sums = new Map<Uuid, number>();
  let retained = 0;
  for (const r of rows) {
    if (r.status !== 'cleared' || r.date > range.to) continue;
    const a = accounts.get(r.account_id);
    if (!a) continue;
    const isPL = a.type === 'income' || a.type === 'expense';
    if (isPL && r.date < range.from) {
      retained += r.amount_lkr_minor;
      continue;
    }
    sums.set(a.id, (sums.get(a.id) ?? 0) + r.amount_lkr_minor);
  }
  const lines: TrialBalanceLine[] = [...sums.entries()]
    .filter(([, v]) => v !== 0)
    .map(([id, v]) => {
      const a = accounts.get(id)!;
      return { account: a, label: `${a.code} ${a.name}`, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0 };
    })
    .sort((x, y) => (x.account?.code ?? '').localeCompare(y.account?.code ?? ''));
  if (retained !== 0) lines.push({ account: null, label: 'Retained profit brought forward', debit: retained > 0 ? retained : 0, credit: retained < 0 ? -retained : 0 });
  return { lines, totalDebit: lines.reduce((s, l) => s + l.debit, 0), totalCredit: lines.reduce((s, l) => s + l.credit, 0) };
}
