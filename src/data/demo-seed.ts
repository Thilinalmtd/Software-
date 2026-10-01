import { DEFAULT_CHART, DEFAULT_DEPARTMENTS, DEFAULT_SETTINGS } from '@/domain/defaults';
import { toLkrMinor } from '@/domain/money';
import { buildPayslipPosting, computePayslip } from '@/domain/payroll';
import { buildExpense, buildIncome, buildOpeningBalance, buildStatutoryPayment, buildTransfer } from '@/domain/posting';
import { addDays, addMonths, fiscalMonths, fiscalYear, isoDate, monthEnd, monthLabel, monthStart, today } from '@/domain/period';
import { carryingRateFor, liabilityBalances } from '@/domain/reports';
import type { Department, LedgerAccount, Party, Project, Uuid } from '@/domain/types';
import { DEMO_USER_ID, DemoRepository } from './demo-repository';

// Six months of realistic AptoCAD activity ending today, posted through the same validation
// as real entries, so every screen has something to show in demo mode.

function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lkr = (rupees: number) => Math.round(rupees * 100);
const usd = (dollars: number) => Math.round(dollars * 100);

/** Departments, chart of accounts and default settings — what a fresh Supabase database is seeded with. */
export function seedBase(repo: DemoRepository): Department[] {
  const s = repo.raw;
  s.settings = structuredClone(DEFAULT_SETTINGS);
  const departments: Department[] = DEFAULT_DEPARTMENTS.map((d) => ({ ...d, id: crypto.randomUUID(), archived: false }));
  s.departments = departments;
  s.ledger_accounts = DEFAULT_CHART.map((a) => ({ id: crypto.randomUUID(), code: a.code, name: a.name, type: a.type, currency: a.currency ?? null, department_id: null, category_group: a.category_group, system_key: a.system_key ?? null, account_number: null, last_reconciled_date: null, archived: false, notes: null }));
  return departments;
}

export async function seedDemo(repo: DemoRepository, asOf: string = today()): Promise<void> {
  const rand = prng(20261001);
  const between = (a: number, b: number) => a + (b - a) * rand();
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const s = repo.raw;

  // Departments & chart of accounts
  const departments = seedBase(repo);
  s.settings.allocation = { method: 'revenue_share', fixed_pct: {} };
  const [civ, mec, corp] = departments;
  const money = (code: string, name: string, type: LedgerAccount['type'], currency: string, dept: Department, number: string | null = null): LedgerAccount => {
    const a: LedgerAccount = { id: crypto.randomUUID(), code, name, type, currency, department_id: dept.id, category_group: null, system_key: null, account_number: number, last_reconciled_date: null, archived: false, notes: null };
    s.ledger_accounts.push(a);
    return a;
  };
  const civBank = money('1010', 'Civil — Commercial Bank', 'bank', 'LKR', civ, '8001 2345 6789');
  const mecBank = money('1020', 'Mechanical — Sampath Bank', 'bank', 'LKR', mec, '1029 5566 7788');
  const corpBank = money('1030', 'Corporate — HNB', 'bank', 'LKR', corp, '0450 1122 3344');
  const civUpwork = money('1110', 'Upwork — Civil', 'platform', 'USD', civ);
  const civPayoneer = money('1120', 'Payoneer — Civil', 'platform', 'USD', civ);
  const mecPayoneer = money('1130', 'Payoneer — Mechanical', 'platform', 'USD', mec);
  const pettyCash = money('1210', 'Petty cash', 'cash', 'LKR', corp);
  const acc = (name: string) => s.ledger_accounts.find((a) => a.name === name)!;
  const sys = (key: LedgerAccount['system_key']) => s.ledger_accounts.find((a) => a.system_key === key)!;

  // People
  const now = new Date().toISOString();
  s.members = [
    { user_id: DEMO_USER_ID, email: 'demo@aptocad.lk', full_name: 'Demo Admin', role: 'admin', department_id: null, active: true, created_at: now },
    { user_id: crypto.randomUUID(), email: 'thilina@aptocad.lk', full_name: 'Thilina', role: 'director', department_id: civ.id, active: true, created_at: now },
    { user_id: crypto.randomUUID(), email: 'ishara@aptocad.lk', full_name: 'Ishara Deshapriya', role: 'director', department_id: mec.id, active: true, created_at: now },
    { user_id: crypto.randomUUID(), email: 'accounts@partners.lk', full_name: 'External Accountant', role: 'viewer', department_id: null, active: true, created_at: now },
    { user_id: crypto.randomUUID(), email: 'new.staff@aptocad.lk', full_name: 'New Staff Member', role: null, department_id: null, active: true, created_at: now },
  ];
  const party = (p: Partial<Party> & Pick<Party, 'kind' | 'name'>): Party => {
    const full: Party = { id: crypto.randomUUID(), email: null, phone: null, country: null, tax_id: null, address: null, default_account_id: null, default_department_id: null, staff_type: null, epf_number: null, designation: null, basic_salary_minor: null, archived: false, notes: null, ...p };
    s.parties.push(full);
    return full;
  };
  const clients = {
    smith: party({ kind: 'client', name: 'Smith Residence LLC', country: 'United States', email: 'owner@smithres.com' }),
    pacific: party({ kind: 'client', name: 'Pacific Build Co.', country: 'Canada', email: 'ap@pacificbuild.ca' }),
    coastal: party({ kind: 'client', name: 'Coastal Permits Inc.', country: 'United States' }),
    northwind: party({ kind: 'client', name: 'Northwind HVAC Ltd', country: 'United Kingdom' }),
    lanka: party({ kind: 'client', name: 'Lanka Property Developers', country: 'Sri Lanka' }),
    summit: party({ kind: 'client', name: 'Summit Mechanical Group', country: 'United States' }),
  };
  const vendors = {
    autodesk: party({ kind: 'vendor', name: 'Autodesk', default_account_id: acc('Software & Subscriptions').id }),
    microsoft: party({ kind: 'vendor', name: 'Microsoft 365', default_account_id: acc('Software & Subscriptions').id }),
    slt: party({ kind: 'vendor', name: 'SLT-Mobitel', default_account_id: acc('Internet & Phone').id }),
    ceb: party({ kind: 'vendor', name: 'Ceylon Electricity Board', default_account_id: acc('Utilities').id }),
    hart: party({ kind: 'vendor', name: 'Hart Structural PE', country: 'United States', default_account_id: acc('PE / EOR Review & Stamp').id }),
    draftpro: party({ kind: 'vendor', name: 'DraftPro Subcontracting', default_account_id: acc('Subcontract Drafting').id }),
    calc: party({ kind: 'vendor', name: 'CalcWorks Engineering', default_account_id: acc('Engineering Calculation Support').id }),
    auditor: party({ kind: 'vendor', name: 'Perera & Co. Chartered Accountants', default_account_id: acc('Accounting / Legal / Corporate').id }),
    landlord: party({ kind: 'vendor', name: 'Office landlord', default_account_id: acc('Office & Administration').id }),
  };
  const staff = [
    party({ kind: 'staff', name: 'Kasun Jayasinghe', staff_type: 'employee', designation: 'Senior Civil Engineer', basic_salary_minor: lkr(185000), default_department_id: civ.id, epf_number: 'EPF-1001' }),
    party({ kind: 'staff', name: 'Nimali Fernando', staff_type: 'employee', designation: 'Structural Draughtsperson', basic_salary_minor: lkr(120000), default_department_id: civ.id, epf_number: 'EPF-1002' }),
    party({ kind: 'staff', name: 'Ruwan Silva', staff_type: 'employee', designation: 'Revit Technician', basic_salary_minor: lkr(95000), default_department_id: civ.id, epf_number: 'EPF-1003' }),
    party({ kind: 'staff', name: 'Dilshan Perera', staff_type: 'contractor', designation: 'Freelance Drafter', basic_salary_minor: lkr(60000), default_department_id: civ.id }),
    party({ kind: 'staff', name: 'Sachini Wickramasinghe', staff_type: 'employee', designation: 'Mechanical Engineer', basic_salary_minor: lkr(165000), default_department_id: mec.id, epf_number: 'EPF-2001' }),
    party({ kind: 'staff', name: 'Tharindu Bandara', staff_type: 'employee', designation: 'HVAC Designer', basic_salary_minor: lkr(110000), default_department_id: mec.id, epf_number: 'EPF-2002' }),
    party({ kind: 'staff', name: 'Anoma Gunawardena', staff_type: 'employee', designation: 'Office Administrator', basic_salary_minor: lkr(85000), default_department_id: corp.id, epf_number: 'EPF-3001' }),
  ];

  // Projects
  const firstMonth = addMonths(monthStart(asOf), -5);
  const project = (dept: Department, client: Party, name: string, currency: string, value: number, rate: string, status: Project['status'] = 'active'): Project => {
    const p = { department_id: dept.id, client_id: client.id, name, site: null, country: client.country, channel: client.country === 'Sri Lanka' ? 'Direct Client' : pick(['Upwork', 'Direct Client']), pricing_type: 'Fixed Price', contract_currency: currency, contract_value_minor: value, planning_fx_rate: rate, start_date: firstMonth, target_date: addMonths(asOf, 2), status, archived: false, notes: null } as Partial<Project>;
    return p as Project;
  };
  const projects = [
    project(civ, clients.smith, 'Smith Residence — permit set', 'USD', usd(16500), '300'),
    project(civ, clients.pacific, 'Pacific Build — 4-storey retaining walls', 'CAD', usd(26000), '220'),
    project(civ, clients.coastal, 'Coastal — plan check revisions', 'USD', usd(9800), '300'),
    project(civ, clients.lanka, 'Lanka PD — apartment structural design', 'LKR', lkr(3600000), '1'),
    project(mec, clients.northwind, 'Northwind — office HVAC design', 'GBP', usd(11500), '400'),
    project(mec, clients.summit, 'Summit — plumbing & fire protection', 'USD', usd(12500), '300'),
  ];
  const savedProjects: Project[] = [];
  for (const p of projects) savedProjects.push(await repo.insert('projects', p));
  const [pSmith, pPacific, pCoastal, pLanka, pNorthwind, pSummit] = savedProjects;
  const civProjects = [pSmith, pPacific, pCoastal];

  // FX rates (CBSL-like daily indicative rates)
  const rates = new Map<string, Record<string, string>>();
  let usdRate = 299.2;
  for (let d = addDays(firstMonth, -10); d <= asOf; d = addDays(d, 1)) {
    usdRate = Math.max(292, Math.min(308, usdRate + between(-0.45, 0.5)));
    const r = { USD: usdRate.toFixed(4), CAD: (usdRate * 0.728).toFixed(4), GBP: (usdRate * 1.334).toFixed(4), EUR: (usdRate * 1.161).toFixed(4), AUD: (usdRate * 0.662).toFixed(4) };
    rates.set(d, r);
    for (const [currency, rate] of Object.entries(r)) s.fx_rates.push({ date: d, currency, rate, source: 'CBSL (demo)' });
  }
  const rate = (ccy: string, d: string) => (ccy === 'LKR' ? '1' : rates.get(d)?.[ccy] ?? '300');

  const post = repo.postEntry.bind(repo);
  const day = (m: string, d: number) => {
    const date = addDays(m, d - 1);
    return date > asOf ? null : date;
  };

  // Opening balances at the start of the demo period
  const opening: [LedgerAccount, number][] = [[civBank, lkr(1250000)], [mecBank, lkr(820000)], [corpBank, lkr(310000)], [civPayoneer, usd(1450)], [mecPayoneer, usd(980)], [pettyCash, lkr(25000)]];
  for (const [a, amt] of opening) await post(buildOpeningBalance({ date: firstMonth, account: a, amountMinor: amt, fxRate: rate(a.currency!, firstMonth), equityAccount: sys('opening_equity') }));

  const payrollAccounts = { salaries: sys('salaries'), employerEpf: sys('employer_epf'), employerEtf: sys('employer_etf'), epfPayable: sys('epf_payable'), etfPayable: sys('etf_payable'), apitPayable: sys('apit_payable'), otherDeductionsPayable: sys('other_deductions_payable') };
  const bankOf = (d: Department) => (d.id === civ.id ? civBank : d.id === mec.id ? mecBank : corpBank);

  for (let i = 0; i < 6; i++) {
    const m = addMonths(firstMonth, i);
    const last = i === 5;

    // Civil — Upwork payouts (gross with ~10% fee)
    for (const [d, proj] of [[4, pSmith], [13, pCoastal], [22, pSmith]] as [number, Project][]) {
      const date = day(m, d);
      if (!date) continue;
      const gross = usd(Math.round(between(650, 2100)));
      await post(buildIncome({ date, description: `Upwork milestone — ${proj.name.split(' — ')[0]}`, departmentId: civ.id, projectId: proj.id, partyId: proj.client_id, moneyAccount: civUpwork, revenueAccount: acc(pick(['Permit / Construction Drawings', 'Civil / Structural Engineering Services', 'Plan Check Revisions'])), grossMinor: gross, feeMinor: Math.round(gross * 0.1), feeAccount: sys('platform_fees'), fxRate: rate('USD', date), channel: 'Upwork', paymentMethod: 'Upwork Payout', status: last && d === 22 ? 'pending' : 'cleared' }));
    }
    // Mechanical — Payoneer receipts from direct clients
    for (const [d, proj] of [[8, pNorthwind], [19, pSummit]] as [number, Project][]) {
      const date = day(m, d);
      if (!date) continue;
      await post(buildIncome({ date, description: `Design fee — ${proj.name.split(' — ')[0]}`, departmentId: mec.id, projectId: proj.id, partyId: proj.client_id, moneyAccount: mecPayoneer, revenueAccount: acc('Mechanical Engineering Services'), grossMinor: usd(Math.round(between(900, 2300))), feeMinor: usd(Math.round(between(8, 20))), feeAccount: sys('bank_fees'), fxRate: rate('USD', date), channel: 'Direct Client', paymentMethod: 'Payoneer' }));
    }
    // Civil — local client in LKR (every other month)
    if (i % 2 === 1) {
      const date = day(m, 16);
      if (date) await post(buildIncome({ date, description: 'Stage payment — Lanka PD apartments', departmentId: civ.id, projectId: pLanka.id, partyId: clients.lanka.id, moneyAccount: civBank, revenueAccount: acc('Civil / Structural Engineering Services'), grossMinor: lkr(Math.round(between(380000, 520000))), channel: 'Direct Client', paymentMethod: 'Bank Transfer' }));
    }

    // Withdrawals to local banks (USD → LKR at a slightly worse rate than CBSL: realised exchange loss)
    for (const [d, from, to] of [[26, civUpwork, civBank], [27, civPayoneer, civBank], [27, mecPayoneer, mecBank]] as [number, LedgerAccount, LedgerAccount][]) {
      const date = day(m, d);
      if (!date) continue;
      const rows = await repo.ledger();
      const bal = rows.filter((r) => r.account_id === from.id && r.status === 'cleared' && r.date <= date).reduce((a, r) => a + r.amount_minor, 0);
      const sent = Math.floor((bal * 0.85) / 100) * 100;
      if (sent < usd(200)) continue;
      const bankRate = Number(rate('USD', date)) * 0.985;
      await post(buildTransfer({ date, description: `Withdraw ${from.name} to ${to.name}`, fromAccount: from, toAccount: to, sentMinor: sent, receivedMinor: toLkrMinor(sent, 'USD', bankRate.toFixed(4)), fromRate: carryingRateFor(rows, from, date) ?? rate('USD', date), toRate: '1', fxAccount: sys('fx_difference'), paymentMethod: 'Bank Transfer' }));
    }

    // Department contributions to the shared corporate account
    for (const [d, from, amt] of [[3, civBank, 250000], [3, mecBank, 180000]] as [number, LedgerAccount, number][]) {
      const date = day(m, d);
      if (date) await post(buildTransfer({ date, description: 'Monthly contribution to shared costs', fromAccount: from, toAccount: corpBank, sentMinor: lkr(amt), receivedMinor: lkr(amt), fxAccount: sys('fx_difference') }));
    }

    // Expenses
    const expense = async (d: number, dept: Department, moneyAcc: LedgerAccount, vendor: Party, category: string, amount: number, description: string, projectId: Uuid | null = null) => {
      const date = day(m, d);
      if (!date) return;
      const ccy = moneyAcc.currency!;
      await post(buildExpense({ date, description, departmentId: dept.id, projectId, partyId: vendor.id, moneyAccount: moneyAcc, splits: [{ account: acc(category), amountMinor: amount }], fxRate: rate(ccy, date), paymentMethod: moneyAcc.type === 'platform' ? 'Payoneer' : 'Bank Transfer' }));
    };
    await expense(2, civ, civBank, vendors.autodesk, 'Software & Subscriptions', lkr(26500), 'Autodesk AutoCAD + Revit subscription');
    await expense(2, mec, mecBank, vendors.autodesk, 'Software & Subscriptions', lkr(19800), 'Autodesk AutoCAD MEP subscription');
    await expense(5, corp, corpBank, vendors.microsoft, 'Software & Subscriptions', lkr(8900), 'Microsoft 365 Business');
    await expense(6, corp, corpBank, vendors.slt, 'Internet & Phone', lkr(Math.round(between(11800, 13200))), 'SLT fibre + mobile');
    await expense(9, corp, corpBank, vendors.ceb, 'Utilities', lkr(Math.round(between(15500, 21000))), 'Electricity bill');
    await expense(1, corp, corpBank, vendors.landlord, 'Office & Administration', lkr(85000), 'Office rent');
    await expense(12, civ, civPayoneer, vendors.hart, 'PE / EOR Review & Stamp', usd(Math.round(between(280, 620))), 'PE stamp and review', pick(civProjects).id);
    if (i % 2 === 0) await expense(15, civ, civBank, vendors.draftpro, 'Subcontract Drafting', lkr(Math.round(between(45000, 90000))), 'Subcontract drafting — sheet set', pick([pSmith.id, pPacific.id]));
    await expense(18, mec, mecBank, vendors.calc, 'Engineering Calculation Support', lkr(Math.round(between(30000, 55000))), 'Load calculations', pick([pNorthwind.id, pSummit.id]));
    if (i % 3 === 2) await expense(20, corp, corpBank, vendors.auditor, 'Accounting / Legal / Corporate', lkr(45000), 'Quarterly accounting fee');
    if (i === 2) await expense(11, civ, civBank, vendors.autodesk, 'Equipment / Computers', lkr(385000), 'Workstation for Revit');
    if (i === 3) {
      const date = day(m, 10);
      if (date) {
        const dup = await post(buildExpense({ date, description: 'Electricity bill (entered twice)', departmentId: corp.id, partyId: vendors.ceb.id, moneyAccount: corpBank, splits: [{ account: acc('Utilities'), amountMinor: lkr(17450) }] }));
        await repo.voidEntry(dup.id, 'Duplicate of the bill already recorded');
      }
    }

    // Payroll on the 25th
    const payDate = day(m, 25);
    if (payDate) {
      const run = await repo.insert('payroll_runs', { period_end: monthEnd(m), pay_date: payDate, status: 'posted', notes: null });
      for (const person of staff) {
        const dept = departments.find((d) => d.id === person.default_department_id)!;
        const isEmployee = person.staff_type === 'employee';
        const figures = computePayslip({ basicMinor: person.basic_salary_minor!, epfAllowancesMinor: 0, otherAllowancesMinor: isEmployee ? lkr(10000) : 0, otherDeductionsMinor: 0, epfApplicable: isEmployee, apitApplicable: isEmployee }, s.settings.payroll);
        const projectId = dept.id === civ.id ? pick(civProjects).id : dept.id === mec.id ? pick([pNorthwind.id, pSummit.id]) : null;
        const entry = await post(buildPayslipPosting({ runId: run.id, payDate, periodLabel: monthLabel(m), employeeId: person.id, employeeName: person.name, departmentId: dept.id, projectId, moneyAccount: bankOf(dept), figures, accounts: payrollAccounts }));
        await repo.insert('payslips', { run_id: run.id, employee_id: person.id, department_id: dept.id, project_id: projectId, money_account_id: bankOf(dept).id, epf_applicable: isEmployee, basic_minor: person.basic_salary_minor!, epf_allowances_minor: 0, other_allowances_minor: isEmployee ? lkr(10000) : 0, ...figures, entry_id: entry.id });
      }
    }

    // Statutory payments for the previous month (APIT by the 15th, EPF/ETF by month end)
    if (i > 0) {
      const rows = await repo.ledger();
      const owed = liabilityBalances(rows.filter((r) => r.date < m), s.ledger_accounts);
      const amount = (key: string) => owed.find((o) => o.account.system_key === key)?.owedMinor ?? 0;
      const apitDate = day(m, 14);
      if (apitDate && amount('apit_payable') > 0) await post(buildStatutoryPayment({ date: apitDate, description: `APIT for ${monthLabel(addMonths(m, -1))}`, departmentId: corp.id, moneyAccount: corpBank, payments: [{ account: sys('apit_payable'), amountMinor: amount('apit_payable') }], reference: 'IRD' }));
      const epfDate = day(m, 20);
      if (epfDate && !last) await post(buildStatutoryPayment({ date: epfDate, description: `EPF & ETF for ${monthLabel(addMonths(m, -1))}`, departmentId: corp.id, moneyAccount: corpBank, payments: [{ account: sys('epf_payable'), amountMinor: amount('epf_payable') }, { account: sys('etf_payable'), amountMinor: amount('etf_payable') }], reference: 'EPF C-form' }));
    }
  }

  // Invoices (direct clients) with payments, one overdue
  const makeInvoice = async (dept: Department, proj: Project, client: Party, currency: string, issue: string, dueDays: number, items: [string, number][], status: 'sent' | 'paid' | 'draft') => {
    const total = items.reduce((a, [, v]) => a + v, 0);
    const inv = await repo.insert('invoices', { kind: 'invoice', department_id: dept.id, project_id: proj.id, client_id: client.id, issue_date: issue, due_date: addDays(issue, dueDays), currency, status, notes: null, terms: 'Payment within 30 days by bank transfer or Payoneer.', subtotal_minor: total, discount_minor: 0, tax_minor: 0, total_minor: total });
    await repo.insertMany('invoice_items', items.map(([description, amount], idx) => ({ invoice_id: inv.id, sort_order: idx, description, quantity: '1', unit_price_minor: amount, amount_minor: amount })));
    return inv;
  };
  const inv1 = await makeInvoice(civ, pPacific, clients.pacific, 'CAD', addDays(firstMonth, 40), 30, [['Retaining wall design — phase 1', usd(4200)], ['Calculation package', usd(1300)]], 'paid');
  const inv2 = await makeInvoice(civ, pPacific, clients.pacific, 'CAD', addDays(asOf, -50), 30, [['Retaining wall design — phase 2', usd(5200)]], 'sent');
  await makeInvoice(mec, pSummit, clients.summit, 'USD', addDays(asOf, -12), 30, [['Plumbing & fire protection drawings', usd(3400)]], 'sent');
  await makeInvoice(civ, pLanka, clients.lanka, 'LKR', addDays(asOf, -3), 14, [['Structural design — stage 3', lkr(650000)]], 'draft');
  await repo.insert('invoices', { kind: 'quote', department_id: mec.id, project_id: null, client_id: clients.northwind.id, issue_date: addDays(asOf, -6), due_date: addDays(asOf, 24), currency: 'GBP', status: 'sent', notes: 'Quote for phase 2 ventilation design', terms: 'Valid for 30 days.', subtotal_minor: usd(3900), discount_minor: 0, tax_minor: 0, total_minor: usd(3900) });
  // Payments: invoice 1 fully (to Payoneer in USD equivalent), invoice 2 partly
  const cadToUsd = (cad: number) => Math.round(cad * 0.728);
  const pay1Date = addDays(inv1.issue_date, 21);
  await post(buildIncome({ date: pay1Date, description: `Payment ${inv1.number}`, departmentId: civ.id, projectId: pPacific.id, partyId: clients.pacific.id, moneyAccount: civPayoneer, revenueAccount: acc('Civil / Structural Engineering Services'), grossMinor: cadToUsd(inv1.total_minor), fxRate: rate('USD', pay1Date), channel: 'Direct Client', paymentMethod: 'Payoneer', invoiceId: inv1.id }), { invoice_payments: [{ invoice_id: inv1.id, amount_minor: inv1.total_minor }] });
  const pay2Date = addDays(inv2.issue_date, 25);
  if (pay2Date <= asOf) await post(buildIncome({ date: pay2Date, description: `Part payment ${inv2.number}`, departmentId: civ.id, projectId: pPacific.id, partyId: clients.pacific.id, moneyAccount: civPayoneer, revenueAccount: acc('Civil / Structural Engineering Services'), grossMinor: cadToUsd(usd(2000)), fxRate: rate('USD', pay2Date), channel: 'Direct Client', paymentMethod: 'Payoneer', invoiceId: inv2.id }), { invoice_payments: [{ invoice_id: inv2.id, amount_minor: usd(2000) }] });

  // Bills to pay
  await repo.insert('bills', { vendor_id: vendors.auditor.id, department_id: corp.id, project_id: null, account_id: acc('Accounting / Legal / Corporate').id, reference: 'PC-2291', description: 'Annual audit — first instalment', bill_date: addDays(asOf, -20), due_date: addDays(asOf, 4), currency: 'LKR', amount_minor: lkr(120000), status: 'open' });
  await repo.insert('bills', { vendor_id: vendors.hart.id, department_id: civ.id, project_id: pPacific.id, account_id: acc('PE / EOR Review & Stamp').id, reference: 'HS-0417', description: 'PE stamp — retaining walls', bill_date: addDays(asOf, -40), due_date: addDays(asOf, -10), currency: 'USD', amount_minor: usd(750), status: 'open' });

  // Budgets for this financial year
  const fy = fiscalYear(asOf, s.settings.fy_start_month);
  const budgetRows = [] as { department_id: Uuid; account_id: Uuid; month: string; amount_lkr_minor: number }[];
  for (const month of fiscalMonths(fy.startYear, s.settings.fy_start_month)) {
    budgetRows.push({ department_id: civ.id, account_id: acc('Permit / Construction Drawings').id, month, amount_lkr_minor: lkr(650000) });
    budgetRows.push({ department_id: civ.id, account_id: acc('Software & Subscriptions').id, month, amount_lkr_minor: lkr(25000) });
    budgetRows.push({ department_id: civ.id, account_id: acc('PE / EOR Review & Stamp').id, month, amount_lkr_minor: lkr(120000) });
    budgetRows.push({ department_id: mec.id, account_id: acc('Mechanical Engineering Services').id, month, amount_lkr_minor: lkr(900000) });
    budgetRows.push({ department_id: mec.id, account_id: acc('Engineering Calculation Support').id, month, amount_lkr_minor: lkr(40000) });
    budgetRows.push({ department_id: corp.id, account_id: acc('Office & Administration').id, month, amount_lkr_minor: lkr(85000) });
    budgetRows.push({ department_id: corp.id, account_id: acc('Utilities').id, month, amount_lkr_minor: lkr(18000) });
  }
  await repo.upsertBudgets(budgetRows);

  // Recurring items and rules
  const nextMonth = addMonths(monthStart(asOf), 1);
  await repo.insert('recurring_templates', { name: 'Autodesk — Civil', kind: 'expense', frequency: 'monthly', next_date: addDays(nextMonth, 1), end_date: null, department_id: civ.id, project_id: null, party_id: vendors.autodesk.id, money_account_id: civBank.id, category_account_id: acc('Software & Subscriptions').id, amount_minor: lkr(26500), description: 'Autodesk AutoCAD + Revit subscription', active: true });
  await repo.insert('recurring_templates', { name: 'Office rent', kind: 'expense', frequency: 'monthly', next_date: nextMonth, end_date: null, department_id: corp.id, project_id: null, party_id: vendors.landlord.id, money_account_id: corpBank.id, category_account_id: acc('Office & Administration').id, amount_minor: lkr(85000), description: 'Office rent', active: true });
  await repo.insert('recurring_templates', { name: 'SLT fibre', kind: 'expense', frequency: 'monthly', next_date: addDays(asOf, 2), end_date: null, department_id: corp.id, project_id: null, party_id: vendors.slt.id, money_account_id: corpBank.id, category_account_id: acc('Internet & Phone').id, amount_minor: lkr(12500), description: 'SLT fibre + mobile', active: true });
  for (const [name, text, category, applies] of [['Autodesk', 'autodesk', 'Software & Subscriptions', 'expense'], ['SLT', 'slt', 'Internet & Phone', 'expense'], ['CEB', 'ceb', 'Utilities', 'expense'], ['Bank charges', 'charges', 'Bank / FX / Transfer Fees', 'expense']] as const) {
    await repo.insert('categorisation_rules', { name, match_text: text, applies_to: applies, account_id: acc(category).id, party_id: null, department_id: null, project_id: null, priority: 100, active: true });
  }

  // A bank statement for the Civil account (last month) to reconcile
  const stmtFrom = addMonths(monthStart(asOf), -1);
  const stmtTo = monthEnd(stmtFrom);
  const ledger = await repo.ledger({ from: stmtFrom, to: stmtTo });
  const moneyLines = ledger.filter((r) => r.account_id === civBank.id && r.status === 'cleared');
  const imp = await repo.insert('statement_imports', { account_id: civBank.id, file_name: `commercial-bank-${stmtFrom.slice(0, 7)}.csv`, row_count: moneyLines.length + 1, imported_by: DEMO_USER_ID, imported_at: new Date().toISOString() });
  for (const [idx, r] of moneyLines.entries()) {
    await repo.insert('statement_lines', { import_id: imp.id, account_id: civBank.id, date: addDays(r.date, idx % 3 === 0 ? 1 : 0), description: r.entry_description.toUpperCase().slice(0, 40), reference: null, amount_minor: r.amount_minor, balance_minor: null, hash: `demo-${r.id}`, status: 'unmatched', matched_entry_id: null });
  }
  await repo.insert('statement_lines', { import_id: imp.id, account_id: civBank.id, date: addDays(stmtTo, -1), description: 'SERVICE CHARGES', reference: null, amount_minor: -lkr(450), balance_minor: null, hash: 'demo-charges', status: 'unmatched', matched_entry_id: null });
  // Reconcile the older months so the demo shows a mix
  const older = (await repo.ledger({ to: addDays(stmtFrom, -1) })).filter((r) => r.role === 'money' && r.status === 'cleared');
  await repo.reconcileLines(older.map((r) => r.id), true, null, isoDate(new Date()));
  for (const a of [civBank, mecBank, corpBank]) await repo.completeReconciliation(a.id, addDays(stmtFrom, -1));

  s.audit_events = s.audit_events.slice(-400);
  repo.persist();
}
