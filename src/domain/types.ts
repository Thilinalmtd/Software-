// Core domain types. They mirror the database tables in supabase/migrations.

export type Uuid = string;
/** ISO date, yyyy-mm-dd. */
export type IsoDate = string;

export const BASE_CURRENCY = 'LKR' as const;

export type Role = 'admin' | 'director' | 'bookkeeper' | 'viewer';

export type AccountType =
  | 'bank'
  | 'platform'
  | 'cash'
  | 'card'
  | 'receivable'
  | 'payable'
  | 'liability'
  | 'equity'
  | 'income'
  | 'expense';

/** Accounts that hold money and appear in "Accounts" with a balance. */
export const MONEY_ACCOUNT_TYPES: readonly AccountType[] = ['bank', 'platform', 'cash', 'card'];
export const PL_ACCOUNT_TYPES: readonly AccountType[] = ['income', 'expense'];

/**
 * Reporting group of an income/expense account (the "category").
 * - revenue: client revenue (Monthly Summary "Revenue")
 * - other_income: interest, sundry income (added to operating profit, shown separately)
 * - direct_cost: direct project costs (PE stamp, subcontract drafting, permits...)
 * - operating: all other operating expenses, incl. platform/bank fees and exchange differences
 * - payroll: salaries and employer contributions (only posted by payroll)
 * - income_tax: tax on profits (below operating profit)
 */
export type CategoryGroup = 'revenue' | 'other_income' | 'direct_cost' | 'operating' | 'payroll' | 'income_tax';

export type EntryKind =
  | 'income'
  | 'expense'
  | 'transfer'
  | 'payroll'
  | 'statutory_payment'
  | 'opening_balance'
  | 'adjustment';

export type EntryStatus = 'cleared' | 'pending' | 'void';

export type LineRole =
  | 'money'
  | 'revenue'
  | 'expense'
  | 'fee'
  | 'fx'
  | 'salary'
  | 'employer_epf'
  | 'employer_etf'
  | 'epf_payable'
  | 'etf_payable'
  | 'apit_payable'
  | 'deduction'
  | 'liability'
  | 'equity'
  | 'adjustment';

export interface Department {
  id: Uuid;
  code: string; // CIV, MEC, CORP
  name: string;
  is_operating: boolean;
  director_name: string | null;
  color: string;
  sort_order: number;
  archived: boolean;
}

export interface Member {
  user_id: Uuid;
  email: string;
  full_name: string | null;
  role: Role | null; // null = waiting for approval
  department_id: Uuid | null;
  active: boolean;
  created_at: string;
}

export interface LedgerAccount {
  id: Uuid;
  code: string;
  name: string;
  type: AccountType;
  /** Required for money/receivable/payable accounts. Null for categories (any currency). */
  currency: string | null;
  /** Owning department for money accounts. Null for shared categories and liabilities. */
  department_id: Uuid | null;
  category_group: CategoryGroup | null;
  /** Stable key for accounts the app posts to automatically. */
  system_key: SystemAccountKey | null;
  account_number: string | null;
  last_reconciled_date: IsoDate | null;
  archived: boolean;
  notes: string | null;
}

export type SystemAccountKey =
  | 'opening_equity'
  | 'fx_difference'
  | 'platform_fees'
  | 'bank_fees'
  | 'salaries'
  | 'employer_epf'
  | 'employer_etf'
  | 'epf_payable'
  | 'etf_payable'
  | 'apit_payable'
  | 'other_deductions_payable'
  | 'income_tax_expense';

export type PartyKind = 'client' | 'vendor' | 'staff';

export interface Party {
  id: Uuid;
  kind: PartyKind;
  name: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  tax_id: string | null;
  address: string | null;
  default_account_id: Uuid | null;
  default_department_id: Uuid | null;
  /** Staff only */
  staff_type: 'employee' | 'contractor' | null;
  epf_number: string | null;
  designation: string | null;
  basic_salary_minor: number | null;
  archived: boolean;
  notes: string | null;
}

export type ProjectStatus = 'lead' | 'active' | 'on_hold' | 'completed' | 'cancelled';

export interface Project {
  id: Uuid;
  code: string;
  department_id: Uuid;
  client_id: Uuid | null;
  name: string;
  site: string | null;
  country: string | null;
  channel: string | null;
  pricing_type: string | null;
  contract_currency: string;
  contract_value_minor: number | null;
  planning_fx_rate: string | null;
  start_date: IsoDate | null;
  target_date: IsoDate | null;
  status: ProjectStatus;
  archived: boolean;
  notes: string | null;
}

export interface Entry {
  id: Uuid;
  number: string;
  kind: EntryKind;
  date: IsoDate;
  status: EntryStatus;
  department_id: Uuid;
  project_id: Uuid | null;
  party_id: Uuid | null;
  description: string;
  reference: string | null;
  channel: string | null;
  payment_method: string | null;
  invoice_id: Uuid | null;
  bill_id: Uuid | null;
  payroll_run_id: Uuid | null;
  recurring_id: Uuid | null;
  void_reason: string | null;
  voided_at: string | null;
  voided_by: Uuid | null;
  created_by: Uuid | null;
  created_at: string;
  updated_by: Uuid | null;
  updated_at: string;
  meta: Record<string, unknown>;
}

export interface EntryLine {
  id: Uuid;
  entry_id: Uuid;
  line_no: number;
  account_id: Uuid;
  department_id: Uuid;
  project_id: Uuid | null;
  currency: string;
  /** Signed amount in the line currency's minor units (+ debit, − credit). */
  amount_minor: number;
  /** Rate used to convert to LKR, as a decimal string. */
  fx_rate: string;
  /** Signed LKR amount in cents. The LKR amounts of an entry sum to zero. */
  amount_lkr_minor: number;
  memo: string | null;
  role: LineRole;
  reconciled: boolean;
  reconciled_at: IsoDate | null;
  statement_line_id: Uuid | null;
}

/** Entry fields supplied by a form; the server assigns id/number/audit fields. */
export type EntryDraft = Pick<
  Entry,
  | 'kind'
  | 'date'
  | 'status'
  | 'department_id'
  | 'project_id'
  | 'party_id'
  | 'description'
  | 'reference'
  | 'channel'
  | 'payment_method'
  | 'invoice_id'
  | 'bill_id'
  | 'payroll_run_id'
  | 'recurring_id'
  | 'meta'
> & { id?: Uuid };

export type LineDraft = Pick<
  EntryLine,
  'account_id' | 'department_id' | 'project_id' | 'currency' | 'amount_minor' | 'fx_rate' | 'amount_lkr_minor' | 'memo' | 'role'
>;

export interface PostingDraft {
  entry: EntryDraft;
  lines: LineDraft[];
}

/** A line joined with its entry header — the unit every report aggregates. */
export interface LedgerRow extends EntryLine {
  date: IsoDate;
  status: EntryStatus;
  kind: EntryKind;
  entry_number: string;
  entry_department_id: Uuid;
  entry_description: string;
  party_id: Uuid | null;
  channel: string | null;
}

export interface Attachment {
  id: Uuid;
  entry_id: Uuid | null;
  invoice_id: Uuid | null;
  bill_id: Uuid | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  sha256: string;
  created_by: Uuid | null;
  created_at: string;
}

export interface FxRate {
  date: IsoDate;
  currency: string;
  rate: string;
  source: string;
}

export type InvoiceKind = 'quote' | 'invoice';
export type InvoiceStatus = 'draft' | 'sent' | 'accepted' | 'paid' | 'void';

export interface Invoice {
  id: Uuid;
  number: string;
  kind: InvoiceKind;
  department_id: Uuid;
  project_id: Uuid | null;
  client_id: Uuid;
  issue_date: IsoDate;
  due_date: IsoDate | null;
  currency: string;
  status: InvoiceStatus;
  notes: string | null;
  terms: string | null;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  created_by: Uuid | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceItem {
  id: Uuid;
  invoice_id: Uuid;
  sort_order: number;
  description: string;
  quantity: string;
  unit_price_minor: number;
  amount_minor: number;
}

export interface InvoicePayment {
  id: Uuid;
  invoice_id: Uuid;
  entry_id: Uuid;
  /** Amount settled, in the invoice currency. */
  amount_minor: number;
}

export type BillStatus = 'open' | 'paid' | 'void';

export interface Bill {
  id: Uuid;
  vendor_id: Uuid | null;
  department_id: Uuid;
  project_id: Uuid | null;
  account_id: Uuid; // expense category
  reference: string | null;
  description: string;
  bill_date: IsoDate;
  due_date: IsoDate | null;
  currency: string;
  amount_minor: number;
  status: BillStatus;
  created_by: Uuid | null;
  created_at: string;
}

export interface BillPayment {
  id: Uuid;
  bill_id: Uuid;
  entry_id: Uuid;
  amount_minor: number;
}

export interface Budget {
  id: Uuid;
  department_id: Uuid;
  account_id: Uuid;
  /** First day of the month, yyyy-mm-01 */
  month: IsoDate;
  amount_lkr_minor: number;
}

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurringTemplate {
  id: Uuid;
  name: string;
  kind: 'income' | 'expense';
  frequency: Frequency;
  next_date: IsoDate;
  end_date: IsoDate | null;
  department_id: Uuid;
  project_id: Uuid | null;
  party_id: Uuid | null;
  money_account_id: Uuid;
  category_account_id: Uuid;
  amount_minor: number;
  description: string;
  active: boolean;
}

export interface CategorisationRule {
  id: Uuid;
  name: string;
  match_text: string;
  applies_to: 'income' | 'expense' | 'any';
  account_id: Uuid | null;
  party_id: Uuid | null;
  department_id: Uuid | null;
  project_id: Uuid | null;
  priority: number;
  active: boolean;
}

export interface StatementImport {
  id: Uuid;
  account_id: Uuid;
  file_name: string;
  row_count: number;
  imported_by: Uuid | null;
  imported_at: string;
}

export type StatementLineStatus = 'unmatched' | 'matched' | 'ignored';

export interface StatementLine {
  id: Uuid;
  import_id: Uuid;
  account_id: Uuid;
  date: IsoDate;
  description: string;
  reference: string | null;
  amount_minor: number;
  balance_minor: number | null;
  hash: string;
  status: StatementLineStatus;
  matched_entry_id: Uuid | null;
}

export type PayrollRunStatus = 'draft' | 'posted';

export interface PayrollRun {
  id: Uuid;
  period_end: IsoDate;
  pay_date: IsoDate;
  status: PayrollRunStatus;
  notes: string | null;
  created_by: Uuid | null;
  created_at: string;
}

export interface Payslip {
  id: Uuid;
  run_id: Uuid;
  employee_id: Uuid;
  department_id: Uuid;
  project_id: Uuid | null;
  money_account_id: Uuid;
  epf_applicable: boolean;
  basic_minor: number;
  epf_allowances_minor: number;
  other_allowances_minor: number;
  gross_minor: number;
  employee_epf_minor: number;
  employer_epf_minor: number;
  etf_minor: number;
  apit_minor: number;
  other_deductions_minor: number;
  net_minor: number;
  entry_id: Uuid | null;
}

export interface AuditEvent {
  id: number;
  at: string;
  user_id: Uuid | null;
  user_email: string | null;
  table_name: string;
  record_id: string;
  action: 'insert' | 'update' | 'delete' | 'void' | 'post';
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface TaxBand {
  /** Upper limit of this band's slice, per month, in LKR cents; null = no limit. */
  width_minor: number | null;
  rate_pct: number;
}

export interface ThresholdPeriod {
  effective_from: IsoDate;
  quarterly_minor: number;
  annual_minor: number;
}

export interface CompanySettings {
  company_name: string;
  base_currency: typeof BASE_CURRENCY;
  fy_start_month: number; // 1-12, April = 4
  address: string | null;
  tax_id: string | null;
  invoice_footer: string | null;
  currencies: string[];
  payroll: {
    employee_epf_pct: number;
    employer_epf_pct: number;
    employer_etf_pct: number;
    apit_monthly_relief_minor: number;
    apit_bands: TaxBand[];
  };
  tax: {
    income_tax_pct: number;
    sscl_pct: number;
    sscl_thresholds: ThresholdPeriod[];
    vat_pct: number;
    vat_thresholds: ThresholdPeriod[];
  };
  allocation: {
    method: 'none' | 'revenue_share' | 'fixed';
    /** department id → percentage, used when method = fixed */
    fixed_pct: Record<Uuid, number>;
  };
  attention: {
    receipt_required_above_minor: number;
    reconcile_after_days: number;
  };
  lists: {
    channels: string[];
    payment_methods: string[];
    pricing_types: string[];
  };
}

export interface PeriodLock {
  locked_through: IsoDate | null;
}
