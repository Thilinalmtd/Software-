import { toMinor } from '@/domain/money';
import { isIsoDate } from '@/domain/period';
import { buildExpense, buildIncome, buildOpeningBalance, buildTransfer, PostingError } from '@/domain/posting';
import type { Department, LedgerAccount, Party, PostingDraft, Project, ProjectStatus } from '@/domain/types';
import type { Repository } from './repository';

// Import of the "AptoCAD Department Finance Tracker" workbook (the Excel file this app replaces).
// Step 1 (pure, testable): planImport() reads the sheets into a plan with row-level problems.
// Step 2: executeImport() creates accounts, contacts, projects and entries through the repository.

export type SheetRows = unknown[][]; // index 0 = Excel row 1; each row index 0 = column A
export type WorkbookSheets = Record<string, SheetRows>;

export interface ImportIssue {
  sheet: string;
  row: number;
  message: string;
}

export interface PlannedAccount {
  name: string;
  type: LedgerAccount['type'];
  currency: string;
  department: string;
  openingLkrMinor: number;
  lastReconciled: string | null;
  notes: string | null;
}

export interface PlannedProject {
  code: string;
  department: string;
  name: string;
  client: string | null;
  country: string | null;
  channel: string | null;
  pricingType: string | null;
  currency: string;
  valueMinor: number | null;
  planningRate: string | null;
  start: string | null;
  target: string | null;
  status: ProjectStatus;
  notes: string | null;
}

export interface PlannedMoney {
  sheet: 'Income' | 'Expenses' | 'Payroll' | 'Transfers';
  row: number;
  sourceId: string | null;
  date: string;
  status: 'cleared' | 'pending';
  reconciled: boolean;
  department: string;
  toDepartment?: string;
  project: string | null;
  party: string | null;
  category: string | null;
  description: string;
  account: string;
  toAccount?: string;
  method: string | null;
  channel: string | null;
  currency: string;
  amountMinor: number;
  rate: string;
  lkrMinor: number;
  reference: string | null;
  /** Payroll only */
  extrasMinor?: number;
  netMinor?: number | null;
}

export interface ImportPlan {
  accounts: PlannedAccount[];
  projects: PlannedProject[];
  clients: string[];
  vendors: string[];
  staff: string[];
  money: PlannedMoney[];
  skippedVoid: number;
  issues: ImportIssue[];
}

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && v && 'text' in v) return String((v as { text: unknown }).text ?? '');
  if (typeof v === 'object' && v && 'result' in v) return cellText((v as { result: unknown }).result);
  return String(v).trim();
};

const cellNumber = (v: unknown): number | null => {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'result' in v) return cellNumber((v as { result: unknown }).result);
  const t = cellText(v).replace(/[,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const cellDate = (v: unknown): string | null => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Excel serial date
    const ms = Math.round((v - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const t = cellText(v).slice(0, 10);
  return isIsoDate(t) ? t : null;
};

const col = (letter: string) => letter.toUpperCase().charCodeAt(0) - 65;

function dataRows(rows: SheetRows | undefined, firstRow = 5): { row: number; get: (c: string) => unknown }[] {
  if (!rows) return [];
  const out = [];
  for (let i = firstRow - 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    out.push({ row: i + 1, get: (c: string) => r[col(c)] });
  }
  return out;
}

export function guessAccountType(name: string): LedgerAccount['type'] {
  if (/upwork|payoneer|wise|paypal|fiverr|platform/i.test(name)) return 'platform';
  if (/cash|petty/i.test(name)) return 'cash';
  if (/card|visa|master|amex/i.test(name)) return 'card';
  return 'bank';
}

const STATUS_MAP: Record<string, ProjectStatus> = { lead: 'lead', active: 'active', 'on hold': 'on_hold', completed: 'completed', cancelled: 'cancelled' };

export function planImport(sheets: WorkbookSheets): ImportPlan {
  const issues: ImportIssue[] = [];
  const clients = new Set<string>();
  const vendors = new Set<string>();
  const staff = new Set<string>();
  let skippedVoid = 0;

  const accounts: PlannedAccount[] = [];
  for (const r of dataRows(sheets['Accounts'])) {
    const name = cellText(r.get('B'));
    if (!name) continue;
    const department = cellText(r.get('C'));
    const currency = (cellText(r.get('D')) || 'LKR').toUpperCase();
    if (!department) issues.push({ sheet: 'Accounts', row: r.row, message: `${name}: no department owner` });
    accounts.push({ name, type: guessAccountType(name), currency, department, openingLkrMinor: toMinor(cellNumber(r.get('E')) ?? 0) ?? 0, lastReconciled: cellDate(r.get('L')), notes: cellText(r.get('M')) || null });
  }

  const projects: PlannedProject[] = [];
  for (const r of dataRows(sheets['Projects'])) {
    const code = cellText(r.get('A'));
    if (!code) continue;
    const client = cellText(r.get('D')) || null;
    if (client) clients.add(client);
    const currency = (cellText(r.get('H')) || 'USD').toUpperCase();
    const value = cellNumber(r.get('I'));
    const rate = cellNumber(r.get('J'));
    projects.push({
      code,
      department: cellText(r.get('B')),
      name: cellText(r.get('C')) || code,
      client,
      country: cellText(r.get('E')) || null,
      channel: cellText(r.get('F')) || null,
      pricingType: cellText(r.get('G')) || null,
      currency,
      valueMinor: value === null ? null : toMinor(value, currency),
      planningRate: rate ? String(rate) : null,
      start: cellDate(r.get('L')),
      target: cellDate(r.get('M')),
      status: STATUS_MAP[cellText(r.get('N')).toLowerCase()] ?? 'active',
      notes: cellText(r.get('T')) || null,
    });
  }

  const money: PlannedMoney[] = [];
  const common = (sheet: PlannedMoney['sheet'], row: number, date: unknown, status: unknown, reconciled: unknown) => {
    const d = cellDate(date);
    const st = cellText(status).toLowerCase();
    if (st === 'void') {
      skippedVoid++;
      return null;
    }
    if (!d) {
      issues.push({ sheet, row, message: 'Missing or invalid date' });
      return null;
    }
    return { date: d, status: (st === 'pending' ? 'pending' : 'cleared') as 'cleared' | 'pending', reconciled: cellText(reconciled).toLowerCase() === 'yes' };
  };
  const amounts = (sheet: string, row: number, ccyCell: unknown, amountCell: unknown, rateCell: unknown) => {
    const currency = (cellText(ccyCell) || 'LKR').toUpperCase();
    const amount = cellNumber(amountCell);
    let rate = cellNumber(rateCell);
    if (currency === 'LKR' && !rate) rate = 1;
    if (amount === null || amount === 0) {
      issues.push({ sheet, row, message: 'Missing amount' });
      return null;
    }
    if (!rate || rate <= 0) {
      issues.push({ sheet, row, message: `Missing exchange rate for ${currency} (the workbook left this out of its totals)` });
      return null;
    }
    const amountMinor = toMinor(amount, currency)!;
    const lkrMinor = toMinor(amount * rate)!;
    return { currency, amountMinor, rate: String(rate), lkrMinor };
  };

  for (const r of dataRows(sheets['Income'])) {
    if (!cellText(r.get('B')) && !cellText(r.get('M'))) continue;
    const c = common('Income', r.row, r.get('B'), r.get('R'), r.get('S'));
    if (!c) continue;
    const a = amounts('Income', r.row, r.get('L'), r.get('M'), r.get('N'));
    if (!a) continue;
    const party = cellText(r.get('F')) || null;
    if (party) clients.add(party);
    money.push({ sheet: 'Income', row: r.row, sourceId: cellText(r.get('A')) || null, ...c, ...a, department: cellText(r.get('D')), project: cellText(r.get('E')) || null, party, category: cellText(r.get('G')) || null, description: cellText(r.get('I')) || cellText(r.get('G')) || 'Income', account: cellText(r.get('J')), method: cellText(r.get('K')) || null, channel: cellText(r.get('H')) || null, reference: cellText(r.get('Q')) || cellText(r.get('A')) || null });
  }
  for (const r of dataRows(sheets['Expenses'])) {
    if (!cellText(r.get('B')) && !cellText(r.get('N'))) continue;
    const c = common('Expenses', r.row, r.get('B'), r.get('S'), r.get('T'));
    if (!c) continue;
    const a = amounts('Expenses', r.row, r.get('M'), r.get('N'), r.get('O'));
    if (!a) continue;
    const party = cellText(r.get('F')) || null;
    if (party) vendors.add(party);
    money.push({ sheet: 'Expenses', row: r.row, sourceId: cellText(r.get('A')) || null, ...c, ...a, department: cellText(r.get('D')), project: cellText(r.get('E')) || null, party, category: cellText(r.get('G')) || null, description: cellText(r.get('J')) || cellText(r.get('G')) || 'Expense', account: cellText(r.get('K')), method: cellText(r.get('L')) || null, channel: null, reference: cellText(r.get('R')) || cellText(r.get('A')) || null });
  }
  for (const r of dataRows(sheets['Payroll'])) {
    if (!cellText(r.get('B')) && !cellText(r.get('I'))) continue;
    const c = common('Payroll', r.row, r.get('B'), r.get('P'), r.get('Q'));
    if (!c) continue;
    const gross = cellNumber(r.get('I'));
    if (!gross) {
      issues.push({ sheet: 'Payroll', row: r.row, message: 'Missing gross pay' });
      continue;
    }
    const person = cellText(r.get('F')) || null;
    if (person) staff.add(person);
    const extras = cellNumber(r.get('J')) ?? 0;
    const net = cellNumber(r.get('K'));
    money.push({ sheet: 'Payroll', row: r.row, sourceId: cellText(r.get('A')) || null, ...c, currency: 'LKR', amountMinor: toMinor(gross)!, rate: '1', lkrMinor: toMinor(gross)!, extrasMinor: toMinor(extras) ?? 0, netMinor: net === null ? null : toMinor(net), department: cellText(r.get('D')), project: cellText(r.get('E')) || null, party: person, category: null, description: `Salary ${cellText(r.get('H')) || c.date.slice(0, 7)} — ${person ?? ''}`.trim(), account: cellText(r.get('L')), method: cellText(r.get('M')) || null, channel: null, reference: cellText(r.get('O')) || cellText(r.get('A')) || null });
  }
  for (const r of dataRows(sheets['Transfers'])) {
    if (!cellText(r.get('B')) && !cellText(r.get('J'))) continue;
    const c = common('Transfers', r.row, r.get('B'), r.get('N'), r.get('O'));
    if (!c) continue;
    const a = amounts('Transfers', r.row, r.get('I'), r.get('J'), r.get('K'));
    if (!a) continue;
    money.push({ sheet: 'Transfers', row: r.row, sourceId: cellText(r.get('A')) || null, ...c, ...a, department: cellText(r.get('D')), toDepartment: cellText(r.get('E')), project: null, party: null, category: null, description: cellText(r.get('F')) || 'Department transfer', account: cellText(r.get('G')), toAccount: cellText(r.get('H')), method: null, channel: null, reference: cellText(r.get('M')) || cellText(r.get('A')) || null });
  }
  money.sort((x, y) => x.date.localeCompare(y.date) || x.row - y.row);
  return { accounts, projects, clients: [...clients], vendors: [...vendors], staff: [...staff], money, skippedVoid, issues };
}

/** Read an .xlsx file into plain row arrays (formula cells give their cached results). */
export async function readWorkbook(file: File | ArrayBuffer): Promise<WorkbookSheets> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file instanceof ArrayBuffer ? file : await file.arrayBuffer());
  const out: WorkbookSheets = {};
  wb.eachSheet((ws) => {
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const values: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const v = cell.value as unknown;
        values[colNumber - 1] = v && typeof v === 'object' && 'formula' in (v as object) ? (v as { result?: unknown }).result ?? null : v;
      });
      rows[rowNumber - 1] = values;
    });
    out[ws.name] = rows;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface ExecuteOptions {
  openingDate: string;
  /** Foreign account name → opening balance in its own currency (minor units). */
  foreignOpening: Record<string, number | null>;
  /** true: post payroll like the workbook did (gross + extras leave the paying account). */
  payrollParity: boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface ExecuteResult {
  created: { accounts: number; contacts: number; projects: number; entries: number };
  issues: ImportIssue[];
  alreadyImported: number;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export async function executeImport(plan: ImportPlan, repo: Repository, existing: { departments: Department[]; accounts: LedgerAccount[]; parties: Party[]; projects: Project[] }, opts: ExecuteOptions): Promise<ExecuteResult> {
  const issues: ImportIssue[] = [];
  const created = { accounts: 0, contacts: 0, projects: 0, entries: 0 };
  let skipped = 0;
  const deptByName = (name: string) => existing.departments.find((d) => norm(d.name) === norm(name) || norm(d.code) === norm(name));
  const accounts = [...existing.accounts];
  const accountByName = (name: string) => accounts.find((a) => norm(a.name) === norm(name));
  const sys = (key: string) => accounts.find((a) => a.system_key === key)!;

  // Accounts + opening balances
  let nextCode = 1010;
  const usedCodes = new Set(accounts.map((a) => a.code));
  for (const pa of plan.accounts) {
    if (accountByName(pa.name)) continue;
    const dept = deptByName(pa.department);
    if (!dept) {
      issues.push({ sheet: 'Accounts', row: 0, message: `${pa.name}: unknown department "${pa.department}"` });
      continue;
    }
    while (usedCodes.has(String(nextCode))) nextCode += 10;
    usedCodes.add(String(nextCode));
    const acc = await repo.insert('ledger_accounts', { code: String(nextCode), name: pa.name, type: pa.type, currency: pa.currency, department_id: dept.id, category_group: null, notes: pa.notes, last_reconciled_date: pa.lastReconciled });
    accounts.push(acc);
    created.accounts++;
    const amount = pa.currency === 'LKR' ? pa.openingLkrMinor : opts.foreignOpening[pa.name] ?? null;
    if (amount) {
      try {
        // Rate implied by the workbook's LKR opening balance and the balance in the account's currency.
        const fxRate = pa.currency === 'LKR' ? '1' : (pa.openingLkrMinor / amount).toFixed(8);
        await repo.postEntry(buildOpeningBalance({ date: opts.openingDate, account: acc, amountMinor: amount, fxRate, equityAccount: sys('opening_equity') }));
      } catch (e) {
        issues.push({ sheet: 'Accounts', row: 0, message: `${pa.name} opening balance: ${e instanceof Error ? e.message : e}` });
      }
    }
  }

  // Contacts
  const parties = [...existing.parties];
  const partyFor = async (name: string | null, kind: Party['kind'], deptId?: string | null) => {
    if (!name) return null;
    const found = parties.find((p) => p.kind === kind && norm(p.name) === norm(name));
    if (found) return found;
    const p = await repo.insert('parties', { kind, name, staff_type: kind === 'staff' ? 'employee' : null, default_department_id: deptId ?? null });
    parties.push(p);
    created.contacts++;
    return p;
  };

  // Projects
  const projects = [...existing.projects];
  for (const pp of plan.projects) {
    if (projects.some((p) => norm(p.code) === norm(pp.code))) continue;
    const dept = deptByName(pp.department);
    if (!dept) {
      issues.push({ sheet: 'Projects', row: 0, message: `${pp.code}: unknown department "${pp.department}"` });
      continue;
    }
    const client = await partyFor(pp.client, 'client');
    const p = await repo.insert('projects', { code: pp.code, department_id: dept.id, client_id: client?.id ?? null, name: pp.name, country: pp.country, channel: pp.channel, pricing_type: pp.pricingType, contract_currency: pp.currency, contract_value_minor: pp.valueMinor, planning_fx_rate: pp.planningRate, start_date: pp.start, target_date: pp.target, status: pp.status, notes: pp.notes });
    projects.push(p);
    created.projects++;
  }
  const projectId = (code: string | null) => (code ? projects.find((p) => norm(p.code) === norm(code))?.id ?? null : null);

  // Entries (re-running an import skips rows already imported, recognised by sheet + workbook ID)
  const imported = new Set(
    (await repo.list('entries'))
      .map((e) => (e.meta as { import?: { sheet?: string; id?: string | null } }).import)
      .filter((i): i is { sheet: string; id: string } => !!i?.sheet && !!i.id)
      .map((i) => `${i.sheet}|${i.id}`),
  );
  let done = 0;
  for (const m of plan.money) {
    opts.onProgress?.(done++, plan.money.length);
    if (m.sourceId && imported.has(`${m.sheet}|${m.sourceId}`)) {
      skipped++;
      continue;
    }
    const fail = (message: string) => issues.push({ sheet: m.sheet, row: m.row, message });
    const dept = deptByName(m.department);
    const account = accountByName(m.account);
    if (!dept) { fail(`Unknown department "${m.department}"`); continue; }
    if (!account) { fail(`Unknown account "${m.account}" — add it to the Accounts sheet`); continue; }
    try {
      let draft: PostingDraft;
      const meta = { import: { sheet: m.sheet, row: m.row, id: m.sourceId } };
      // Amount in the account's currency
      const inAccountCcy = () => {
        if (account.currency === m.currency) return { amount: m.amountMinor, rate: m.rate };
        if (account.currency === 'LKR') return { amount: m.lkrMinor, rate: '1' };
        throw new PostingError([`${m.currency} amount paid through a ${account.currency} account — convert it manually`]);
      };
      if (m.sheet === 'Income') {
        const { amount, rate } = inAccountCcy();
        const revenue = accounts.find((a) => norm(a.name) === norm(m.category) && a.type === 'income') ?? accounts.find((a) => a.name === 'Consulting / Other Services')!;
        const party = await partyFor(m.party, 'client', dept.id);
        draft = buildIncome({ date: m.date, status: m.status, description: m.description, reference: m.reference, departmentId: dept.id, projectId: projectId(m.project), partyId: party?.id, paymentMethod: m.method, channel: m.channel, moneyAccount: account, revenueAccount: revenue, grossMinor: amount, fxRate: rate, meta });
      } else if (m.sheet === 'Expenses') {
        const { amount, rate } = inAccountCcy();
        const category = accounts.find((a) => norm(a.name) === norm(m.category) && a.type === 'expense') ?? accounts.find((a) => a.name === 'Other Operating Expense')!;
        const party = await partyFor(m.party, 'vendor', dept.id);
        draft = buildExpense({ date: m.date, status: m.status, description: m.description, reference: m.reference, departmentId: dept.id, projectId: projectId(m.project), partyId: party?.id, paymentMethod: m.method, moneyAccount: account, splits: [{ account: category, amountMinor: amount }], fxRate: rate, meta });
      } else if (m.sheet === 'Transfers') {
        const to = accountByName(m.toAccount ?? '');
        if (!to) { fail(`Unknown account "${m.toAccount}"`); continue; }
        const sent = inAccountCcy();
        const received = to.currency === m.currency ? m.amountMinor : to.currency === 'LKR' ? m.lkrMinor : null;
        if (received === null) { fail('Cross-currency transfer between two foreign accounts — record it manually'); continue; }
        draft = buildTransfer({ date: m.date, status: m.status, description: m.description, reference: m.reference, fromAccount: account, toAccount: to, sentMinor: sent.amount, receivedMinor: received, fromRate: sent.rate, toRate: to.currency === 'LKR' ? '1' : m.rate, fxAccount: sys('fx_difference'), meta });
      } else {
        if (account.currency !== 'LKR') { fail('Payroll must be paid from an LKR account'); continue; }
        const person = await partyFor(m.party, 'staff', dept.id);
        const gross = m.amountMinor;
        const extras = m.extrasMinor ?? 0;
        const line = (acc: LedgerAccount, amt: number, role: PostingDraft['lines'][number]['role'], d = dept.id) => ({ account_id: acc.id, department_id: d, project_id: role === 'salary' || role === 'employer_epf' ? projectId(m.project) : null, currency: 'LKR', amount_minor: amt, fx_rate: '1', amount_lkr_minor: amt, memo: null, role });
        const lines = [line(sys('salaries'), gross, 'salary')];
        if (extras) lines.push(line(sys('employer_epf'), extras, 'employer_epf'));
        if (opts.payrollParity || m.netMinor === null || m.netMinor === undefined) {
          lines.push(line(account, -(gross + extras), 'money', account.department_id!));
        } else {
          const deductions = gross - m.netMinor;
          if (deductions + extras) lines.push(line(sys('epf_payable'), -(deductions + extras), 'epf_payable'));
          lines.push(line(account, -m.netMinor, 'money', account.department_id!));
        }
        draft = { entry: { kind: 'payroll', date: m.date, status: m.status, department_id: dept.id, project_id: projectId(m.project), party_id: person?.id ?? null, description: m.description, reference: m.reference, channel: null, payment_method: m.method, invoice_id: null, bill_id: null, payroll_run_id: null, recurring_id: null, meta }, lines };
      }
      const entry = await repo.postEntry(draft);
      created.entries++;
      if (m.reconciled) {
        const lines = await repo.entryLines(entry.id);
        const ids = lines.filter((l) => l.role === 'money').map((l) => l.id);
        if (ids.length) await repo.reconcileLines(ids, true, null, m.date);
      }
    } catch (e) {
      fail(e instanceof PostingError ? e.issues.join(' ') : e instanceof Error ? e.message : String(e));
    }
  }
  opts.onProgress?.(plan.money.length, plan.money.length);
  return { created, issues, alreadyImported: skipped };
}
