import { describe, expect, it } from 'vitest';
import { buildPayslipPosting, computeApit, computePayslip } from './payroll';
import { validatePosting } from './posting';
import { makeWorld } from './testkit';

describe('payroll', () => {
  const w = makeWorld();
  const p = w.settings.payroll;

  it('applies APIT bands above the LKR 150,000 monthly relief', () => {
    expect(computeApit(15000000, p)).toBe(0);
    expect(computeApit(20000000, p)).toBe(300000); // 50,000 × 6% = 3,000
    // 150,000 taxable: 83,333.33 × 6% + 41,666.67 × 18% + 25,000 × 24% = 5,000 + 7,500 + 6,000
    expect(computeApit(30000000, p)).toBe(1850000);
  });

  it('computes EPF, ETF, APIT and net pay for an employee', () => {
    const f = computePayslip({ basicMinor: 20000000, epfAllowancesMinor: 0, otherAllowancesMinor: 1000000, otherDeductionsMinor: 50000, epfApplicable: true, apitApplicable: true }, p);
    expect(f.gross_minor).toBe(21000000);
    expect(f.employee_epf_minor).toBe(1600000); // 8% of basic
    expect(f.employer_epf_minor).toBe(2400000); // 12%
    expect(f.etf_minor).toBe(600000); // 3%
    expect(f.apit_minor).toBe(360000); // (210,000 − 150,000) × 6%
    expect(f.net_minor).toBe(21000000 - 1600000 - 360000 - 50000);
    expect(f.cost_minor).toBe(21000000 + 2400000 + 600000);
  });

  it('contractors have no statutory deductions', () => {
    const f = computePayslip({ basicMinor: 10000000, epfAllowancesMinor: 0, otherAllowancesMinor: 0, otherDeductionsMinor: 0, epfApplicable: false, apitApplicable: false }, p);
    expect(f).toMatchObject({ employee_epf_minor: 0, employer_epf_minor: 0, etf_minor: 0, apit_minor: 0, net_minor: 10000000, cost_minor: 10000000 });
  });

  it('posts a balanced payslip: cost on pay date, net from bank, statutory as liabilities (workbook issue H4)', () => {
    const f = computePayslip({ basicMinor: 20000000, epfAllowancesMinor: 0, otherAllowancesMinor: 0, otherDeductionsMinor: 0, epfApplicable: true, apitApplicable: true }, p);
    const d = buildPayslipPosting({
      runId: 'run1',
      payDate: '2026-10-25',
      periodLabel: 'Oct 2026',
      employeeId: 'emp1',
      employeeName: 'A. Perera',
      departmentId: w.civ.id,
      moneyAccount: w.civBank,
      figures: f,
      accounts: {
        salaries: w.sys('salaries'),
        employerEpf: w.sys('employer_epf'),
        employerEtf: w.sys('employer_etf'),
        epfPayable: w.sys('epf_payable'),
        etfPayable: w.sys('etf_payable'),
        apitPayable: w.sys('apit_payable'),
        otherDeductionsPayable: w.sys('other_deductions_payable'),
      },
    });
    expect(d.lines.reduce((s, l) => s + l.amount_lkr_minor, 0)).toBe(0);
    expect(d.lines.find((l) => l.role === 'money')!.amount_minor).toBe(-f.net_minor);
    expect(d.lines.find((l) => l.role === 'epf_payable')!.amount_minor).toBe(-(f.employee_epf_minor + f.employer_epf_minor));
    expect(validatePosting(d, { accounts: w.accountMap, departments: w.deptMap, lockedThrough: null })).toEqual([]);
  });
});
