import { pctOf } from './money';
import { PostingError } from './posting';
import { BASE_CURRENCY, type CompanySettings, type LedgerAccount, type LineDraft, type PostingDraft, type Uuid } from './types';

// Sri Lankan payroll: EPF (employee 8%, employer 12%), ETF (employer 3%) on EPF-liable earnings,
// and APIT withheld on monthly employment income. All rates come from Settings.

export interface PayslipInput {
  basicMinor: number;
  epfAllowancesMinor: number;
  otherAllowancesMinor: number;
  otherDeductionsMinor: number;
  epfApplicable: boolean;
  /** Employees (not contractors) have APIT withheld. */
  apitApplicable: boolean;
  /** Override the calculated APIT (e.g. from the official IRD table). */
  apitOverrideMinor?: number | null;
}

export interface PayslipFigures {
  gross_minor: number;
  epf_base_minor: number;
  employee_epf_minor: number;
  employer_epf_minor: number;
  etf_minor: number;
  apit_minor: number;
  other_deductions_minor: number;
  net_minor: number;
  /** Cost to the company = gross + employer EPF + ETF */
  cost_minor: number;
}

/** Monthly APIT using the progressive bands in settings (relief first, then each band's slice). */
export function computeApit(monthlyGrossMinor: number, settings: CompanySettings['payroll']): number {
  let remaining = monthlyGrossMinor - settings.apit_monthly_relief_minor;
  if (remaining <= 0) return 0;
  let tax = 0;
  for (const band of settings.apit_bands) {
    const slice = band.width_minor === null ? remaining : Math.min(remaining, band.width_minor);
    tax += pctOf(slice, band.rate_pct);
    remaining -= slice;
    if (remaining <= 0) break;
  }
  return tax;
}

export function computePayslip(input: PayslipInput, settings: CompanySettings['payroll']): PayslipFigures {
  const values = [input.basicMinor, input.epfAllowancesMinor, input.otherAllowancesMinor, input.otherDeductionsMinor];
  if (values.some((v) => !Number.isInteger(v) || v < 0)) throw new PostingError(['Payroll amounts cannot be negative.']);
  const gross = input.basicMinor + input.epfAllowancesMinor + input.otherAllowancesMinor;
  const epfBase = input.epfApplicable ? input.basicMinor + input.epfAllowancesMinor : 0;
  const employeeEpf = pctOf(epfBase, settings.employee_epf_pct);
  const employerEpf = pctOf(epfBase, settings.employer_epf_pct);
  const etf = pctOf(epfBase, settings.employer_etf_pct);
  const apit = input.apitOverrideMinor ?? (input.apitApplicable ? computeApit(gross, settings) : 0);
  const net = gross - employeeEpf - apit - input.otherDeductionsMinor;
  if (net < 0) throw new PostingError(['Deductions are larger than gross pay.']);
  return {
    gross_minor: gross,
    epf_base_minor: epfBase,
    employee_epf_minor: employeeEpf,
    employer_epf_minor: employerEpf,
    etf_minor: etf,
    apit_minor: apit,
    other_deductions_minor: input.otherDeductionsMinor,
    net_minor: net,
    cost_minor: gross + employerEpf + etf,
  };
}

export interface PayrollAccounts {
  salaries: LedgerAccount;
  employerEpf: LedgerAccount;
  employerEtf: LedgerAccount;
  epfPayable: LedgerAccount;
  etfPayable: LedgerAccount;
  apitPayable: LedgerAccount;
  otherDeductionsPayable: LedgerAccount;
}

export interface PayslipPostingInput {
  id?: Uuid;
  runId: Uuid;
  payDate: string;
  periodLabel: string;
  employeeId: Uuid;
  employeeName: string;
  departmentId: Uuid;
  projectId?: Uuid | null;
  moneyAccount: LedgerAccount;
  figures: PayslipFigures;
  accounts: PayrollAccounts;
  status?: 'cleared' | 'pending';
}

/**
 * Salary cost is recognised on the pay date; net pay leaves the bank; EPF/ETF/APIT become
 * liabilities until paid with a statutory payment.
 */
export function buildPayslipPosting(i: PayslipPostingInput): PostingDraft {
  if (i.moneyAccount.currency !== BASE_CURRENCY) throw new PostingError(['Salaries must be paid from an LKR account.']);
  if (!i.moneyAccount.department_id) throw new PostingError(['The paying account is not assigned to a department.']);
  const f = i.figures;
  const d = i.departmentId;
  const p = i.projectId ?? null;
  const mk = (account: LedgerAccount, amount: number, role: LineDraft['role'], dept: Uuid = d, project: Uuid | null = p): LineDraft => ({
    account_id: account.id,
    department_id: dept,
    project_id: project,
    currency: BASE_CURRENCY,
    amount_minor: amount,
    fx_rate: '1',
    amount_lkr_minor: amount,
    memo: null,
    role,
  });
  const lines: LineDraft[] = [mk(i.accounts.salaries, f.gross_minor, 'salary')];
  if (f.employer_epf_minor) lines.push(mk(i.accounts.employerEpf, f.employer_epf_minor, 'employer_epf'));
  if (f.etf_minor) lines.push(mk(i.accounts.employerEtf, f.etf_minor, 'employer_etf'));
  const epfTotal = f.employee_epf_minor + f.employer_epf_minor;
  if (epfTotal) lines.push(mk(i.accounts.epfPayable, -epfTotal, 'epf_payable', d, null));
  if (f.etf_minor) lines.push(mk(i.accounts.etfPayable, -f.etf_minor, 'etf_payable', d, null));
  if (f.apit_minor) lines.push(mk(i.accounts.apitPayable, -f.apit_minor, 'apit_payable', d, null));
  if (f.other_deductions_minor) lines.push(mk(i.accounts.otherDeductionsPayable, -f.other_deductions_minor, 'deduction', d, null));
  if (f.net_minor) lines.push(mk(i.moneyAccount, -f.net_minor, 'money', i.moneyAccount.department_id, null));
  return {
    entry: {
      id: i.id,
      kind: 'payroll',
      date: i.payDate,
      status: i.status ?? 'cleared',
      department_id: d,
      project_id: p,
      party_id: i.employeeId,
      description: `Salary ${i.periodLabel} — ${i.employeeName}`,
      reference: null,
      channel: null,
      payment_method: 'Bank Transfer',
      invoice_id: null,
      bill_id: null,
      payroll_run_id: i.runId,
      recurring_id: null,
      meta: { gross_minor: f.gross_minor, net_minor: f.net_minor },
    },
    lines,
  };
}
