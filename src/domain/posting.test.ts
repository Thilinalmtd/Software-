import { describe, expect, it } from 'vitest';
import { buildAdjustment, buildExpense, buildIncome, buildOpeningBalance, buildStatutoryPayment, buildTransfer, PostingError, validatePosting } from './posting';
import { makeWorld } from './testkit';
import type { PostingDraft } from './types';

const sumLkr = (d: PostingDraft) => d.lines.reduce((s, l) => s + l.amount_lkr_minor, 0);

describe('posting builders', () => {
  const w = makeWorld();
  const ctx = { accounts: w.accountMap, departments: w.deptMap, lockedThrough: null };

  it('records an Upwork payout gross, with the fee as an expense (worked example in the roadmap)', () => {
    const d = buildIncome({
      date: '2026-10-02',
      description: 'Structural calcs – phase 2',
      departmentId: w.civ.id,
      moneyAccount: w.upwork,
      revenueAccount: w.byName('Civil / Structural Engineering Services'),
      grossMinor: 100000,
      feeMinor: 10000,
      feeAccount: w.sys('platform_fees'),
      fxRate: '300',
      channel: 'Upwork',
    });
    expect(sumLkr(d)).toBe(0);
    const byRole = Object.fromEntries(d.lines.map((l) => [l.role, l]));
    expect(byRole.money).toMatchObject({ amount_minor: 90000, amount_lkr_minor: 27000000, currency: 'USD', department_id: w.corp.id });
    expect(byRole.fee).toMatchObject({ amount_minor: 10000, amount_lkr_minor: 3000000, department_id: w.civ.id });
    expect(byRole.revenue).toMatchObject({ amount_minor: -100000, amount_lkr_minor: -30000000, department_id: w.civ.id });
    expect(validatePosting(d, ctx)).toEqual([]);
  });

  it('absorbs rounding in the revenue line so entries always balance', () => {
    const d = buildIncome({ date: '2026-10-02', description: 'x', departmentId: w.civ.id, moneyAccount: w.payoneer, revenueAccount: w.byName('CAD / Revit Drafting'), grossMinor: 3333, feeMinor: 333, feeAccount: w.sys('platform_fees'), fxRate: '302.3333' });
    expect(sumLkr(d)).toBe(0);
    expect(validatePosting(d, ctx)).toEqual([]);
  });

  it('refuses foreign-currency income without an exchange rate (workbook issue H2)', () => {
    expect(() => buildIncome({ date: '2026-10-02', description: 'x', departmentId: w.civ.id, moneyAccount: w.payoneer, revenueAccount: w.byName('CAD / Revit Drafting'), grossMinor: 1000, fxRate: '' })).toThrow(PostingError);
  });

  it('splits an expense over several categories', () => {
    const d = buildExpense({
      date: '2026-10-03',
      description: 'Autodesk + stamp',
      departmentId: w.civ.id,
      moneyAccount: w.civBank,
      splits: [
        { account: w.byName('Software & Subscriptions'), amountMinor: 4500000 },
        { account: w.byName('PE / EOR Review & Stamp'), amountMinor: 6000000, projectId: 'p1' },
      ],
    });
    expect(sumLkr(d)).toBe(0);
    expect(d.lines.find((l) => l.role === 'money')!.amount_minor).toBe(-10500000);
    expect(d.lines[1].project_id).toBe('p1');
    expect(validatePosting(d, ctx)).toEqual([]);
  });

  it('converts USD to LKR at the carrying rate and books the realised exchange difference (workbook issue H1)', () => {
    const d = buildTransfer({
      date: '2026-10-05',
      description: 'Payoneer withdrawal',
      fromAccount: w.payoneer,
      toAccount: w.civBank,
      sentMinor: 90000,
      receivedMinor: 26730000,
      fromRate: '300',
      toRate: '1',
      fxAccount: w.sys('fx_difference'),
    });
    expect(sumLkr(d)).toBe(0);
    const fx = d.lines.find((l) => l.role === 'fx')!;
    expect(fx.amount_lkr_minor).toBe(270000); // LKR 2,700 loss
    expect(d.entry.meta).toMatchObject({ cross_department: false });
    expect(validatePosting(d, ctx)).toEqual([]);
  });

  it('records a department transfer that changes department cash but not profit', () => {
    const d = buildTransfer({ date: '2026-10-06', description: 'Funding', fromAccount: w.civBank, toAccount: w.mecBank, sentMinor: 2000000, receivedMinor: 2000000, fxAccount: w.sys('fx_difference') });
    expect(d.lines).toHaveLength(2);
    expect(d.entry.department_id).toBe(w.civ.id);
    expect(d.entry.meta).toMatchObject({ cross_department: true });
    expect(validatePosting(d, ctx)).toEqual([]);
  });

  it('keeps the carrying rate when moving the same currency between accounts', () => {
    const usd2 = { ...w.payoneer, id: 'acc-usd2', name: 'Wise USD' };
    const accounts = new Map(w.accountMap);
    accounts.set(usd2.id, usd2);
    const d = buildTransfer({ date: '2026-10-06', description: 'x', fromAccount: w.payoneer, toAccount: usd2, sentMinor: 5000, receivedMinor: 5000, fromRate: '301.5', toRate: '999', fxAccount: w.sys('fx_difference') });
    expect(d.lines.find((l) => l.role === 'fx')).toBeUndefined();
    expect(validatePosting(d, { ...ctx, accounts })).toEqual([]);
  });

  it('books a transfer fee separately from the exchange difference', () => {
    const d = buildTransfer({ date: '2026-10-06', description: 'x', fromAccount: w.payoneer, toAccount: w.civBank, sentMinor: 100000, feeMinor: 300, feeAccount: w.sys('bank_fees'), receivedMinor: 29800000, fromRate: '300', fxAccount: w.sys('fx_difference') });
    expect(sumLkr(d)).toBe(0);
    expect(d.lines.find((l) => l.role === 'fee')!.amount_lkr_minor).toBe(90000);
    expect(d.lines.find((l) => l.role === 'fx')!.amount_lkr_minor).toBe(30000000 - 90000 - 29800000);
  });

  it('opening balance and statutory payment balance', () => {
    const ob = buildOpeningBalance({ date: '2026-04-01', account: w.payoneer, amountMinor: 250000, fxRate: '299', equityAccount: w.sys('opening_equity') });
    expect(sumLkr(ob)).toBe(0);
    expect(validatePosting(ob, ctx)).toEqual([]);
    const sp = buildStatutoryPayment({ date: '2026-10-31', description: 'EPF Oct', departmentId: w.civ.id, moneyAccount: w.civBank, payments: [{ account: w.sys('epf_payable'), amountMinor: 2000000 }] });
    expect(sumLkr(sp)).toBe(0);
    expect(validatePosting(sp, ctx)).toEqual([]);
  });

  it('manual adjustments must balance', () => {
    expect(() => buildAdjustment({ date: '2026-10-01', description: 'x', departmentId: w.civ.id, lines: [{ account: w.civBank, departmentId: w.civ.id, amountMinor: 100 }, { account: w.byName('Other Income'), departmentId: w.civ.id, amountMinor: -99 }] })).toThrow(PostingError);
  });
});

describe('validation enforces the START HERE rules', () => {
  const w = makeWorld();
  const ctx = { accounts: w.accountMap, departments: w.deptMap, lockedThrough: null };

  it('rejects revenue for Corporate / Shared', () => {
    const d = buildIncome({ date: '2026-10-02', description: 'x', departmentId: w.corp.id, moneyAccount: w.corpBank, revenueAccount: w.byName('CAD / Revit Drafting'), grossMinor: 1000 });
    expect(validatePosting(d, ctx).join()).toMatch(/operating department/);
  });

  it('rejects payroll categories outside payroll', () => {
    const d = buildExpense({ date: '2026-10-02', description: 'x', departmentId: w.civ.id, moneyAccount: w.civBank, splits: [{ account: w.sys('salaries'), amountMinor: 1000 }] });
    expect(validatePosting(d, ctx).join()).toMatch(/Payroll only/);
  });

  it('rejects income/expense lines inside a transfer', () => {
    const d = buildTransfer({ date: '2026-10-06', description: 'x', fromAccount: w.civBank, toAccount: w.mecBank, sentMinor: 1000, receivedMinor: 1000, fxAccount: w.sys('fx_difference') });
    d.lines.push({ ...d.lines[0], account_id: w.byName('Other Income').id, amount_minor: 0, amount_lkr_minor: 0, role: 'revenue' });
    expect(validatePosting(d, ctx).join()).toMatch(/cannot include income or expense/);
  });

  it('rejects unbalanced entries, wrong currency and locked periods', () => {
    const d = buildExpense({ date: '2026-09-30', description: 'x', departmentId: w.civ.id, moneyAccount: w.civBank, splits: [{ account: w.byName('Utilities'), amountMinor: 1000 }] });
    d.lines[0].amount_minor = 1001;
    d.lines[0].amount_lkr_minor = 1001;
    d.lines[1].currency = 'USD';
    const issues = validatePosting(d, { ...ctx, lockedThrough: '2026-09-30' }).join('\n');
    expect(issues).toMatch(/does not balance/);
    expect(issues).toMatch(/LKR account but the line is in USD/);
    expect(issues).toMatch(/locked/);
  });

  it('rejects a money account used for another department', () => {
    const d = buildExpense({ date: '2026-10-02', description: 'x', departmentId: w.civ.id, moneyAccount: w.civBank, splits: [{ account: w.byName('Utilities'), amountMinor: 1000 }] });
    d.lines[1].department_id = w.mec.id;
    expect(validatePosting(d, ctx).join()).toMatch(/belongs to another department/);
  });
});
