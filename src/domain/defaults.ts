import type { AccountType, CategoryGroup, CompanySettings, SystemAccountKey } from './types';

// Default setup, taken from the "Lists" sheet of the AptoCAD Department Finance Tracker.
// The same data is seeded by supabase/migrations/0003_seed.sql.

export const DEFAULT_DEPARTMENTS = [
  { code: 'CIV', name: 'Civil', is_operating: true, director_name: 'Thilina', color: '#2563EB', sort_order: 1 },
  { code: 'MEC', name: 'Mechanical', is_operating: true, director_name: 'Ishara Deshapriya', color: '#D97706', sort_order: 2 },
  { code: 'CORP', name: 'Corporate / Shared', is_operating: false, director_name: null, color: '#64748B', sort_order: 3 },
] as const;

export interface DefaultAccount {
  code: string;
  name: string;
  type: AccountType;
  category_group: CategoryGroup | null;
  system_key?: SystemAccountKey;
  currency?: string;
}

export const DEFAULT_CHART: DefaultAccount[] = [
  // Revenue
  { code: '4010', name: 'Permit / Construction Drawings', type: 'income', category_group: 'revenue' },
  { code: '4020', name: 'Civil / Structural Engineering Services', type: 'income', category_group: 'revenue' },
  { code: '4030', name: 'Mechanical Engineering Services', type: 'income', category_group: 'revenue' },
  { code: '4040', name: 'Plan Check Revisions', type: 'income', category_group: 'revenue' },
  { code: '4050', name: 'CAD / Revit Drafting', type: 'income', category_group: 'revenue' },
  { code: '4060', name: 'Consulting / Other Services', type: 'income', category_group: 'revenue' },
  { code: '4070', name: 'Performance Bonus', type: 'income', category_group: 'revenue' },
  { code: '4910', name: 'Interest Income', type: 'income', category_group: 'other_income' },
  { code: '4990', name: 'Other Income', type: 'income', category_group: 'other_income' },
  // Direct project costs
  { code: '5010', name: 'PE / EOR Review & Stamp', type: 'expense', category_group: 'direct_cost' },
  { code: '5020', name: 'Subcontract Drafting', type: 'expense', category_group: 'direct_cost' },
  { code: '5030', name: 'Engineering Calculation Support', type: 'expense', category_group: 'direct_cost' },
  { code: '5040', name: 'Survey / Civil / Other Consultant', type: 'expense', category_group: 'direct_cost' },
  { code: '5050', name: 'Project Permit / Submission Cost', type: 'expense', category_group: 'direct_cost' },
  // Operating expenses
  { code: '6010', name: 'Software & Subscriptions', type: 'expense', category_group: 'operating' },
  { code: '6020', name: 'Internet & Phone', type: 'expense', category_group: 'operating' },
  { code: '6030', name: 'Upwork / Platform Fees', type: 'expense', category_group: 'operating', system_key: 'platform_fees' },
  { code: '6040', name: 'Bank / FX / Transfer Fees', type: 'expense', category_group: 'operating', system_key: 'bank_fees' },
  { code: '6045', name: 'Exchange Gain / Loss', type: 'expense', category_group: 'operating', system_key: 'fx_difference' },
  { code: '6050', name: 'Advertising & Marketing', type: 'expense', category_group: 'operating' },
  { code: '6060', name: 'Recruitment', type: 'expense', category_group: 'operating' },
  { code: '6070', name: 'Professional Memberships', type: 'expense', category_group: 'operating' },
  { code: '6080', name: 'Accounting / Legal / Corporate', type: 'expense', category_group: 'operating' },
  { code: '6090', name: 'Office & Administration', type: 'expense', category_group: 'operating' },
  { code: '6100', name: 'Equipment / Computers', type: 'expense', category_group: 'operating' },
  { code: '6110', name: 'Training / Education', type: 'expense', category_group: 'operating' },
  { code: '6120', name: 'Travel / Transport', type: 'expense', category_group: 'operating' },
  { code: '6130', name: 'Taxes & Government Fees', type: 'expense', category_group: 'operating' },
  { code: '6140', name: 'Utilities', type: 'expense', category_group: 'operating' },
  { code: '6990', name: 'Other Operating Expense', type: 'expense', category_group: 'operating' },
  // Payroll (posted only by payroll runs)
  { code: '7010', name: 'Salaries & Wages', type: 'expense', category_group: 'payroll', system_key: 'salaries' },
  { code: '7020', name: 'Employer EPF (12%)', type: 'expense', category_group: 'payroll', system_key: 'employer_epf' },
  { code: '7030', name: 'Employer ETF (3%)', type: 'expense', category_group: 'payroll', system_key: 'employer_etf' },
  // Tax on profits
  { code: '8010', name: 'Income Tax Expense', type: 'expense', category_group: 'income_tax', system_key: 'income_tax_expense' },
  // Liabilities & equity
  { code: '2110', name: 'EPF Payable', type: 'liability', category_group: null, system_key: 'epf_payable', currency: 'LKR' },
  { code: '2120', name: 'ETF Payable', type: 'liability', category_group: null, system_key: 'etf_payable', currency: 'LKR' },
  { code: '2130', name: 'APIT Payable', type: 'liability', category_group: null, system_key: 'apit_payable', currency: 'LKR' },
  { code: '2140', name: 'Other Payroll Deductions Payable', type: 'liability', category_group: null, system_key: 'other_deductions_payable', currency: 'LKR' },
  { code: '3010', name: 'Opening Balance Equity', type: 'equity', category_group: null, system_key: 'opening_equity', currency: 'LKR' },
];

const lkr = (rupees: number) => Math.round(rupees * 100);

export const DEFAULT_SETTINGS: CompanySettings = {
  company_name: 'AptoCAD Engineering',
  base_currency: 'LKR',
  fy_start_month: 4,
  address: null,
  tax_id: null,
  invoice_footer: 'Thank you for your business.',
  currencies: ['LKR', 'USD', 'CAD', 'GBP', 'EUR', 'AUD'],
  payroll: {
    employee_epf_pct: 8,
    employer_epf_pct: 12,
    employer_etf_pct: 3,
    // Monthly equivalents of the annual APIT schedule effective 1 April 2025 (confirm with your accountant).
    apit_monthly_relief_minor: lkr(150_000),
    apit_bands: [
      { width_minor: lkr(83_333.33), rate_pct: 6 },
      { width_minor: lkr(41_666.67), rate_pct: 18 },
      { width_minor: lkr(41_666.67), rate_pct: 24 },
      { width_minor: lkr(41_666.67), rate_pct: 30 },
      { width_minor: null, rate_pct: 36 },
    ],
  },
  tax: {
    income_tax_pct: 15,
    sscl_pct: 2.5,
    sscl_thresholds: [
      { effective_from: '2000-01-01', quarterly_minor: lkr(15_000_000), annual_minor: lkr(60_000_000) },
      { effective_from: '2026-07-01', quarterly_minor: lkr(9_000_000), annual_minor: lkr(36_000_000) },
    ],
    vat_pct: 18,
    vat_thresholds: [{ effective_from: '2000-01-01', quarterly_minor: lkr(15_000_000), annual_minor: lkr(60_000_000) }],
  },
  allocation: { method: 'none', fixed_pct: {} },
  attention: { receipt_required_above_minor: lkr(5_000), reconcile_after_days: 31 },
  lists: {
    channels: ['Upwork', 'Direct Client', 'Referral / Partner', 'Other'],
    payment_methods: ['Bank Transfer', 'Upwork Payout', 'Payoneer', 'Card', 'Cash', 'Other'],
    pricing_types: ['Fixed Price', 'Hourly', 'Milestone', 'Retainer'],
  },
};

export const CURRENCY_NAMES: Record<string, string> = {
  LKR: 'Sri Lankan Rupee',
  USD: 'US Dollar',
  CAD: 'Canadian Dollar',
  GBP: 'British Pound',
  EUR: 'Euro',
  AUD: 'Australian Dollar',
  INR: 'Indian Rupee',
  SGD: 'Singapore Dollar',
  AED: 'UAE Dirham',
};

/** Merge stored settings over the defaults so new settings keys always have a value. */
export function withDefaults(stored: Partial<CompanySettings> | null | undefined): CompanySettings {
  const s = stored ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    payroll: { ...DEFAULT_SETTINGS.payroll, ...(s.payroll ?? {}) },
    tax: { ...DEFAULT_SETTINGS.tax, ...(s.tax ?? {}) },
    allocation: { ...DEFAULT_SETTINGS.allocation, ...(s.allocation ?? {}) },
    attention: { ...DEFAULT_SETTINGS.attention, ...(s.attention ?? {}) },
    lists: { ...DEFAULT_SETTINGS.lists, ...(s.lists ?? {}) },
  } as CompanySettings;
}
