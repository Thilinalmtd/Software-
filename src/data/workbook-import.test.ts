import { describe, expect, it } from 'vitest';
import { countableRows, figuresFor } from '@/domain/reports';
import { DemoRepository, emptyStore } from './demo-repository';
import { seedBase } from './demo-seed';
import { executeImport, planImport, type WorkbookSheets } from './workbook-import';

// Rows laid out exactly like the AptoCAD workbook: header on row 4, data from row 5.
const pad = (rows: unknown[][]) => [[], [], [], ['header'], ...rows];
const sheets: WorkbookSheets = {
  Accounts: pad([
    ['ACC-1', 'Civil Commercial Bank', 'Civil', 'LKR', 500000],
    ['ACC-2', 'Payoneer Civil', 'Civil', 'USD', 300000],
    ['ACC-3', 'Mechanical Sampath', 'Mechanical', 'LKR', 200000],
  ]),
  Projects: pad([['CIV-001', 'Civil', 'Smith house', 'Smith LLC', 'US', 'Upwork', 'Fixed Price', 'USD', 5000, 300, null, '2026-04-01', '2026-06-30', 'Active']]),
  Income: pad([
    ['INC-1', '2026-04-10', null, 'Civil', 'CIV-001', 'Smith LLC', 'Permit / Construction Drawings', 'Upwork', 'Milestone 1', 'Payoneer Civil', 'Payoneer', 'USD', 1000, 300, null, null, 'INV-1', 'Cleared', 'Yes'],
    ['INC-2', '2026-04-11', null, 'Civil', null, 'Local client', 'CAD / Revit Drafting', 'Direct Client', 'LKR job', 'Civil Commercial Bank', 'Bank Transfer', 'USD', 100, 300],
    ['INC-3', '2026-04-12', null, 'Mechanical', null, 'X', 'Mechanical Engineering Services', null, 'Missing rate', 'Mechanical Sampath', null, 'USD', 50, null],
    ['INC-4', '2026-04-13', null, 'Mechanical', null, 'Y', 'Mechanical Engineering Services', null, 'Voided', 'Mechanical Sampath', null, 'LKR', 50, 1, null, null, null, 'Void'],
  ]),
  Expenses: pad([['EXP-1', '2026-04-15', null, 'Civil', 'CIV-001', 'Hart PE', 'PE / EOR Review & Stamp', null, null, 'Stamp', 'Payoneer Civil', 'Payoneer', 'USD', 200, 301]]),
  Payroll: pad([['PAY-1', '2026-04-25', null, 'Mechanical', null, 'Sachini', 'Engineer', 'Apr 2026', 100000, 15000, 92000, 'Mechanical Sampath']]),
  Transfers: pad([['TRF-1', '2026-04-26', null, 'Civil', 'Mechanical', 'Funding', 'Civil Commercial Bank', 'Mechanical Sampath', 'LKR', 20000, 1]]),
};

describe('workbook import', () => {
  it('plans the import and reports rows the workbook silently dropped', () => {
    const plan = planImport(sheets);
    expect(plan.accounts.map((a) => a.type)).toEqual(['bank', 'platform', 'bank']);
    expect(plan.projects[0]).toMatchObject({ code: 'CIV-001', currency: 'USD', valueMinor: 500000, status: 'active' });
    expect(plan.money).toHaveLength(5);
    expect(plan.skippedVoid).toBe(1);
    expect(plan.issues).toEqual([{ sheet: 'Income', row: 7, message: expect.stringMatching(/Missing exchange rate/) }]);
    expect(plan.clients).toEqual(expect.arrayContaining(['Smith LLC', 'Local client']));
  });

  it('creates accounts, contacts, projects and balanced entries matching the workbook totals', async () => {
    const repo = new DemoRepository(emptyStore(), { persist: false });
    const departments = seedBase(repo);
    const plan = planImport(sheets);
    const accounts = await repo.list('ledger_accounts');
    const res = await executeImport(plan, repo, { departments, accounts, parties: [], projects: [] }, { openingDate: '2026-03-31', foreignOpening: { 'Payoneer Civil': 100000 }, payrollParity: true });
    expect(res.issues).toEqual([]);
    expect(res.created).toMatchObject({ accounts: 3, projects: 1, entries: 5 });
    const rows = await repo.ledger();
    const all = await repo.list('ledger_accounts');
    const fig = figuresFor(countableRows(rows), { accounts: new Map(all.map((a) => [a.id, a])), departments });
    const civ = departments.find((d) => d.code === 'CIV')!;
    const mec = departments.find((d) => d.code === 'MEC')!;
    expect(fig.byDept[civ.id].revenue).toBe(30000000 + 3000000); // USD 1,000 @300 + USD 100 @300 into an LKR account
    expect(fig.byDept[civ.id].directCosts).toBe(6020000); // USD 200 @301
    expect(fig.byDept[mec.id].payroll).toBe(11500000); // gross + extras, as the workbook
    expect(fig.byDept[civ.id].transferNet).toBe(-2000000);
    // Reconciled flag carried over
    expect(rows.filter((r) => r.reconciled).length).toBe(1);
    // Opening balance of the USD account uses the workbook's LKR value
    const payoneer = all.find((a) => a.name === 'Payoneer Civil')!;
    const ob = rows.find((r) => r.account_id === payoneer.id && r.kind === 'opening_balance')!;
    expect(ob).toMatchObject({ amount_minor: 100000, amount_lkr_minor: 30000000 });
    // Importing the same workbook again creates nothing new
    const again = await executeImport(plan, repo, { departments, accounts: await repo.list('ledger_accounts'), parties: await repo.list('parties'), projects: await repo.list('projects') }, { openingDate: '2026-03-31', foreignOpening: {}, payrollParity: true });
    expect(again.created).toMatchObject({ accounts: 0, contacts: 0, projects: 0, entries: 0 });
    expect(again.alreadyImported).toBe(5);
  });
});
