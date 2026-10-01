import { describe, expect, it } from 'vitest';
import { buildPayslipPosting, computePayslip } from './payroll';
import { buildExpense, buildIncome, buildOpeningBalance, buildTransfer } from './posting';
import { accountBalances, ageing, allocateSharedCost, budgetVsActual, cashFlow, figuresFor, liabilityBalances, monthlySummary, profitAndLoss, projectFigures, spendByCategory, taxMonitor, countableRows } from './reports';
import { makeWorld, toRows } from './testkit';
import type { LedgerRow, Project } from './types';
import { fiscalMonths } from './period';

// One month of AptoCAD activity, checked against the workbook's Monthly Summary definitions.
function scenario() {
  const w = makeWorld();
  const rows: LedgerRow[] = [];
  const add = (...r: LedgerRow[]) => rows.push(...r);
  const fx = w.sys('fx_difference');

  add(...toRows(buildOpeningBalance({ date: '2026-04-01', account: w.civBank, amountMinor: 50000000, equityAccount: w.sys('opening_equity') })));
  // Civil: Upwork payout 1,000 USD gross, 100 fee, at 300 → revenue 300,000; fee 30,000 (Upwork account is Corporate's)
  add(...toRows(buildIncome({ date: '2026-10-02', description: 'Upwork – Smith residence', departmentId: w.civ.id, projectId: 'P1', moneyAccount: w.upwork, revenueAccount: w.byName('Permit / Construction Drawings'), grossMinor: 100000, feeMinor: 10000, feeAccount: w.sys('platform_fees'), fxRate: '300', channel: 'Upwork' })));
  // Mechanical: direct client LKR 200,000
  add(...toRows(buildIncome({ date: '2026-10-04', description: 'HVAC design', departmentId: w.mec.id, moneyAccount: w.mecBank, revenueAccount: w.byName('Mechanical Engineering Services'), grossMinor: 20000000, channel: 'Direct Client' })));
  // Civil expenses: software 50,000; PE stamp 60,000 on P1
  add(...toRows(buildExpense({ date: '2026-10-05', description: 'Autodesk', departmentId: w.civ.id, moneyAccount: w.civBank, splits: [{ account: w.byName('Software & Subscriptions'), amountMinor: 5000000 }] })));
  add(...toRows(buildExpense({ date: '2026-10-06', description: 'PE stamp', departmentId: w.civ.id, projectId: 'P1', moneyAccount: w.civBank, splits: [{ account: w.byName('PE / EOR Review & Stamp'), amountMinor: 6000000 }] })));
  // Corporate: accounting fee 30,000 from Civil's bank? No — from the corporate bank (overdraws it; fine for the test)
  add(...toRows(buildExpense({ date: '2026-10-07', description: 'Auditor', departmentId: w.corp.id, moneyAccount: w.corpBank, splits: [{ account: w.byName('Accounting / Legal / Corporate'), amountMinor: 3000000 }] })));
  // Civil payroll: gross 100,000 → cost 115,000, net 92,000
  const f = computePayslip({ basicMinor: 10000000, epfAllowancesMinor: 0, otherAllowancesMinor: 0, otherDeductionsMinor: 0, epfApplicable: true, apitApplicable: true }, w.settings.payroll);
  add(...toRows(buildPayslipPosting({ runId: 'r', payDate: '2026-10-25', periodLabel: 'Oct', employeeId: 'e', employeeName: 'E', departmentId: w.civ.id, projectId: 'P1', moneyAccount: w.civBank, figures: f, accounts: { salaries: w.sys('salaries'), employerEpf: w.sys('employer_epf'), employerEtf: w.sys('employer_etf'), epfPayable: w.sys('epf_payable'), etfPayable: w.sys('etf_payable'), apitPayable: w.sys('apit_payable'), otherDeductionsPayable: w.sys('other_deductions_payable') } })));
  // Department transfer Civil → Mechanical 20,000
  add(...toRows(buildTransfer({ date: '2026-10-26', description: 'Funding', fromAccount: w.civBank, toAccount: w.mecBank, sentMinor: 2000000, receivedMinor: 2000000, fxAccount: fx })));
  // Voided and pending entries never count
  add(...toRows(buildExpense({ date: '2026-10-08', description: 'Duplicate', departmentId: w.civ.id, moneyAccount: w.civBank, splits: [{ account: w.byName('Utilities'), amountMinor: 999900 }] }), 'void'));
  add(...toRows(buildIncome({ date: '2026-10-09', description: 'Not yet arrived', departmentId: w.mec.id, moneyAccount: w.mecBank, revenueAccount: w.byName('Mechanical Engineering Services'), grossMinor: 777700 }), 'pending'));
  return { w, rows, f };
}

describe('monthly summary (mirrors the Excel Monthly Summary sheet)', () => {
  const { w, rows } = scenario();
  const ctx = { accounts: w.accountMap, departments: w.departments };
  const { months, total } = monthlySummary(rows, ctx, fiscalMonths(2026, 4));
  const oct = months.find((m) => m.month === '2026-10-01')!.figures;

  it('computes department revenue, expenses, payroll and operating profit', () => {
    const civ = oct.byDept[w.civ.id];
    expect(civ.revenue).toBe(30000000);
    expect(civ.expenses).toBe(3000000 + 5000000 + 6000000); // Upwork fee + software + PE stamp
    expect(civ.directCosts).toBe(6000000);
    expect(civ.payroll).toBe(11500000); // gross + 12% + 3%
    expect(civ.operatingProfit).toBe(30000000 - 14000000 - 11500000);
    expect(civ.margin).toBeCloseTo(4500000 / 30000000);
    const mec = oct.byDept[w.mec.id];
    expect(mec.revenue).toBe(20000000);
    expect(mec.operatingProfit).toBe(20000000);
  });

  it('keeps transfers out of profit but in department cash', () => {
    expect(oct.byDept[w.civ.id].transferNet).toBe(-2000000);
    expect(oct.byDept[w.mec.id].transferNet).toBe(2000000);
    // Civil cash: −50,000 −60,000 −92,000 net pay −20,000 transfer (Upwork cash sits with Corporate)
    expect(oct.byDept[w.civ.id].netCash).toBe(-5000000 - 6000000 - 9200000 - 2000000);
    expect(oct.byDept[w.mec.id].netCash).toBe(20000000 + 2000000);
  });

  it('consolidates the company without double counting', () => {
    expect(oct.corporateCost).toBe(3000000);
    expect(oct.revenue).toBe(50000000);
    expect(oct.totalCost).toBe(14000000 + 11500000 + 3000000);
    expect(oct.operatingProfit).toBe(50000000 - 28500000);
    expect(total.operatingProfit).toBe(oct.operatingProfit);
  });

  it('excludes void and pending entries (workbook issue H5)', () => {
    expect(oct.byDept[w.mec.id].revenue).toBe(20000000);
    const withPending = figuresFor(countableRows(rows, { includePending: true }), ctx);
    expect(withPending.byDept[w.mec.id].revenue).toBe(20777700);
  });
});

describe('other reports', () => {
  const { w, rows, f } = scenario();
  const ctx = { accounts: w.accountMap, departments: w.departments };

  it('P&L by department with revenue-share allocation of corporate cost', () => {
    const pl = profitAndLoss(rows, ctx, {}, { method: 'revenue_share', fixed_pct: {} });
    expect(pl.allocation[w.civ.id]).toBe(1800000); // 30,000 × 300/500
    expect(pl.allocation[w.mec.id]).toBe(1200000);
    expect(pl.fullyLoaded[w.civ.id]).toBe(4500000 - 1800000);
    const revenue = pl.sections.find((s) => s.group === 'revenue')!;
    expect(revenue.total).toBe(50000000);
    const fixed = allocateSharedCost(pl.figures, ctx, { method: 'fixed', fixed_pct: { [w.civ.id]: 70, [w.mec.id]: 30 } });
    expect(fixed[w.civ.id] + fixed[w.mec.id]).toBe(3000000);
    expect(fixed[w.civ.id]).toBe(2100000);
  });

  it('account balances in own currency with unrealised exchange difference (workbook issue H3)', () => {
    const bal = accountBalances(rows, w.accounts, { USD: '310' });
    const upwork = bal.find((b) => b.account.id === w.upwork.id)!;
    expect(upwork.balanceMinor).toBe(90000);
    expect(upwork.bookLkrMinor).toBe(27000000);
    expect(upwork.currentLkrMinor).toBe(27900000);
    expect(upwork.unrealisedLkrMinor).toBe(900000);
    const mec = bal.find((b) => b.account.id === w.mecBank.id)!;
    expect(mec.balanceMinor).toBe(22000000);
    expect(mec.pendingMinor).toBe(777700);
  });

  it('shows statutory liabilities until paid', () => {
    const liab = liabilityBalances(rows, w.accounts);
    expect(liab.find((l) => l.account.system_key === 'epf_payable')!.owedMinor).toBe(f.employee_epf_minor + f.employer_epf_minor);
  });

  it('project contribution = revenue − direct costs − payroll', () => {
    const project: Project = { id: 'P1', code: 'CIV-P-0001', department_id: w.civ.id, client_id: null, name: 'Smith', site: null, country: 'US', channel: 'Upwork', pricing_type: null, contract_currency: 'USD', contract_value_minor: 200000, planning_fx_rate: '300', start_date: null, target_date: null, status: 'active', archived: false, notes: null };
    const [pf] = projectFigures(rows, [project], ctx);
    expect(pf.revenue).toBe(30000000);
    expect(pf.directCosts).toBe(6000000);
    expect(pf.payroll).toBe(11500000);
    expect(pf.contribution).toBe(30000000 - 6000000 - 11500000);
    expect(pf.contractValueLkr).toBe(60000000);
    expect(pf.receivedPct).toBeCloseTo(0.5);
  });

  it('spend by category and cash flow', () => {
    const spend = spendByCategory(rows, ctx, {});
    expect(spend[0].account.name).toBe('Salaries & Wages');
    const cf = cashFlow(rows, ctx, fiscalMonths(2026, 4));
    const oct = cf.find((m) => m.month === '2026-10-01')!;
    expect(oct.receipts).toBe(27000000 + 20000000);
    expect(oct.transfersNet).toBe(0);
    expect(oct.net).toBe(oct.receipts + oct.payments + oct.payroll + oct.statutory + oct.transfersNet + oct.other);
  });

  it('budget vs actual', () => {
    const sw = w.byName('Software & Subscriptions');
    const lines = budgetVsActual(rows, [{ id: 'b', department_id: w.civ.id, account_id: sw.id, month: '2026-10-01', amount_lkr_minor: 4000000 }], ctx, fiscalMonths(2026, 4), w.civ.id);
    expect(lines[0]).toMatchObject({ budget: 4000000, actual: 5000000, variance: -1000000 });
  });

  it('tax monitor uses the SSCL threshold in force on the date', () => {
    const before = taxMonitor(rows, ctx, w.settings, '2026-06-30');
    expect(before.sscl.threshold?.annual_minor).toBe(6000000000);
    const after = taxMonitor(rows, ctx, w.settings, '2026-10-31');
    expect(after.sscl.threshold?.annual_minor).toBe(3600000000);
    expect(after.fyRevenue).toBe(50000000);
    expect(after.incomeTaxProvision).toBe(Math.round(21500000 * 0.15));
  });

  it('ages receivables', () => {
    const a = ageing([
      { id: 'i1', dueDate: '2026-10-20', currency: 'USD', outstandingMinor: 10000 },
      { id: 'i2', dueDate: '2026-12-01', currency: 'LKR', outstandingMinor: 500000 },
      { id: 'i3', dueDate: '2026-06-01', currency: 'LKR', outstandingMinor: 100 },
    ], '2026-10-31', { USD: '300' });
    expect(a.buckets.d1_30).toBe(3000000);
    expect(a.buckets.not_due).toBe(500000);
    expect(a.buckets.d90_plus).toBe(100);
  });
});

describe('trial balance', () => {
  it('always balances, carrying earlier profit forward', async () => {
    const { trialBalance } = await import('./reports');
    const { w, rows } = scenario();
    const tb = trialBalance(rows, w.accountMap, { from: '2026-10-05', to: '2026-10-31' });
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(tb.lines.some((l) => l.account === null)).toBe(true);
    const full = trialBalance(rows, w.accountMap, { from: '2026-04-01', to: '2027-03-31' });
    expect(full.totalDebit).toBe(full.totalCredit);
  });
});
