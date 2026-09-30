import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildExpense, buildIncome, buildTransfer } from '../../src/domain/posting';
import { figuresFor, countableRows } from '../../src/domain/reports';
import type { Department, LedgerAccount, LedgerRow, PostingDraft } from '../../src/domain/types';

// Integration tests for the Supabase schema on a real Postgres.
// DATABASE_URL must point at a server where we may create databases (see docs/DEVELOPMENT.md).

// Return dates as yyyy-mm-dd strings and bigints as numbers, like PostgREST does.
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(20, (v: string) => Number(v));

const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:54329/postgres';
const dbName = `aptocad_test_${Date.now()}`;
const root = fileURLToPath(new URL('..', import.meta.url));
let admin: pg.Client;
let db: pg.Client;

const ids = {
  owner: '00000000-0000-0000-0000-000000000001',
  civil: '00000000-0000-0000-0000-000000000002',
  mech: '00000000-0000-0000-0000-000000000003',
  viewer: '00000000-0000-0000-0000-000000000004',
  stranger: '00000000-0000-0000-0000-000000000005',
};

/** Runs `fn` inside a transaction as the given Supabase user (role authenticated). */
async function as<T>(uid: string | null, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    if (uid) await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await db.query('set local role authenticated');
    const result = await fn(db);
    await db.query('commit');
    return result;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}

async function post(uid: string, draft: PostingDraft, links: object = {}) {
  return as(uid, async (c) => (await c.query('select * from public.post_entry($1, $2, $3)', [JSON.stringify(draft.entry), JSON.stringify(draft.lines), JSON.stringify(links)])).rows[0]);
}

async function signUp(id: string, email: string) {
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
}

let departments: Department[];
let accounts: LedgerAccount[];
const acc = (name: string) => accounts.find((a) => a.name === name)!;
const sys = (key: string) => accounts.find((a) => a.system_key === key)!;
const dept = (code: string) => departments.find((d) => d.code === code)!;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${dbName}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${dbName}`;
  db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  await db.query(readFileSync(`${root}/tests/local-supabase-stub.sql`, 'utf8'));
  for (const f of readdirSync(`${root}/migrations`).sort()) await db.query(readFileSync(`${root}/migrations/${f}`, 'utf8'));
});

afterAll(async () => {
  await db?.end();
  await admin?.query(`drop database if exists ${dbName}`);
  await admin?.end();
});

describe('sign-up and roles', () => {
  it('makes the first user admin and later users wait for approval', async () => {
    await signUp(ids.owner, 'owner@aptocad.lk');
    await signUp(ids.civil, 'civil@aptocad.lk');
    await signUp(ids.mech, 'mech@aptocad.lk');
    await signUp(ids.viewer, 'accountant@example.lk');
    await signUp(ids.stranger, 'stranger@example.com');
    const { rows } = await db.query('select user_id, role from public.members order by email');
    expect(rows.find((r) => r.user_id === ids.owner).role).toBe('admin');
    expect(rows.filter((r) => r.role === null)).toHaveLength(4);
  });

  it('hides company data from users who are not approved', async () => {
    const own = await as(ids.stranger, async (c) => (await c.query('select * from public.members')).rows);
    expect(own).toHaveLength(1); // only themselves
    const depts = await as(ids.stranger, async (c) => (await c.query('select * from public.departments')).rows);
    expect(depts).toHaveLength(0);
  });

  it('lets only an admin assign roles', async () => {
    await expect(as(ids.civil, (c) => c.query(`select public.set_member($1, 'admin', null, true)`, [ids.civil]))).rejects.toThrow(/Only an admin/);
    departments = (await db.query('select * from public.departments')).rows;
    await as(ids.owner, async (c) => {
      await c.query(`select public.set_member($1, 'director', $2, true)`, [ids.civil, dept('CIV').id]);
      await c.query(`select public.set_member($1, 'director', $2, true)`, [ids.mech, dept('MEC').id]);
      await c.query(`select public.set_member($1, 'viewer', null, true)`, [ids.viewer]);
    });
    await expect(as(ids.owner, (c) => c.query(`select public.set_member($1, 'viewer', null, true)`, [ids.owner]))).rejects.toThrow(/at least one active admin/);
  });

  it('seeds departments, chart of accounts and settings', async () => {
    departments = await as(ids.civil, async (c) => (await c.query('select * from public.departments order by sort_order')).rows);
    expect(departments.map((d) => d.code)).toEqual(['CIV', 'MEC', 'CORP']);
    const settings = await as(ids.viewer, async (c) => (await c.query('select data from public.company_settings')).rows[0].data);
    expect(settings.fy_start_month).toBe(4);
  });
});

describe('master data permissions', () => {
  it('lets a director create money accounts and projects only for their department', async () => {
    await as(ids.owner, async (c) => {
      await c.query(`insert into public.ledger_accounts (code, name, type, currency, department_id) values
        ('1010', 'Civil Bank', 'bank', 'LKR', $1), ('1020', 'Mechanical Bank', 'bank', 'LKR', $2),
        ('1030', 'Corporate Bank', 'bank', 'LKR', $3), ('1110', 'Payoneer USD', 'platform', 'USD', $1)`, [dept('CIV').id, dept('MEC').id, dept('CORP').id]);
    });
    await expect(as(ids.civil, (c) => c.query(`insert into public.ledger_accounts (code, name, type, currency, department_id) values ('1021', 'Mech 2', 'bank', 'LKR', $1)`, [dept('MEC').id]))).rejects.toThrow(/row-level security/);
    await expect(as(ids.civil, (c) => c.query(`insert into public.ledger_accounts (code, name, type, category_group) values ('6999', 'New cat', 'expense', 'operating')`))).rejects.toThrow(/row-level security/);
    const p = await as(ids.civil, async (c) => (await c.query(`insert into public.projects (department_id, name) values ($1, 'Smith residence') returning code`, [dept('CIV').id])).rows[0]);
    expect(p.code).toBe('CIV-P-0001');
    await expect(as(ids.civil, (c) => c.query(`insert into public.projects (department_id, name) values ($1, 'x')`, [dept('MEC').id]))).rejects.toThrow(/row-level security/);
    accounts = (await db.query('select * from public.ledger_accounts')).rows;
  });

  it('keeps viewers read-only', async () => {
    await expect(as(ids.viewer, (c) => c.query(`insert into public.parties (kind, name) values ('client', 'x')`))).rejects.toThrow(/row-level security/);
  });
});

describe('posting', () => {
  const depMap = () => new Map(departments.map((d) => [d.id, d]));

  it('posts a balanced entry, numbers it and records an audit event', async () => {
    const draft = buildIncome({ date: '2026-10-02', description: 'Upwork payout', departmentId: dept('CIV').id, moneyAccount: acc('Payoneer USD'), revenueAccount: acc('Permit / Construction Drawings'), grossMinor: 100000, feeMinor: 10000, feeAccount: sys('platform_fees'), fxRate: '300', channel: 'Upwork' });
    const entry = await post(ids.civil, draft);
    expect(entry.number).toBe('INC-2026-00001');
    const audit = (await db.query(`select action from public.audit_events where table_name = 'entries' and record_id = $1`, [entry.id])).rows;
    expect(audit).toEqual([{ action: 'post' }]);
    expect(depMap().size).toBe(3);
  });

  it('blocks writing entries directly (only through post_entry)', async () => {
    await expect(as(ids.owner, (c) => c.query(`insert into public.entries (number, kind, date, department_id, description) values ('X', 'income', '2026-10-01', $1, 'x')`, [dept('CIV').id]))).rejects.toThrow(/row-level security/);
  });

  it("stops a director recording another department's entries", async () => {
    const draft = buildIncome({ date: '2026-10-02', description: 'x', departmentId: dept('MEC').id, moneyAccount: acc('Mechanical Bank'), revenueAccount: acc('Mechanical Engineering Services'), grossMinor: 100000 });
    await expect(post(ids.civil, draft)).rejects.toThrow(/your own department/);
    await expect(post(ids.viewer, draft)).rejects.toThrow(/permission/);
    await expect(post(ids.mech, draft)).resolves.toMatchObject({ number: 'INC-2026-00002' });
  });

  it('rejects entries that break the accounting rules', async () => {
    const base = buildExpense({ date: '2026-10-03', description: 'x', departmentId: dept('CIV').id, moneyAccount: acc('Civil Bank'), splits: [{ account: acc('Utilities'), amountMinor: 1000 }] });
    const unbalanced = structuredClone(base);
    unbalanced.lines[0].amount_minor = 1001;
    unbalanced.lines[0].amount_lkr_minor = 1001;
    await expect(post(ids.civil, unbalanced)).rejects.toThrow(/does not balance/);

    const payrollAsExpense = buildExpense({ date: '2026-10-03', description: 'x', departmentId: dept('CIV').id, moneyAccount: acc('Civil Bank'), splits: [{ account: sys('salaries'), amountMinor: 1000 }] });
    await expect(post(ids.civil, payrollAsExpense)).rejects.toThrow(/Payroll only/);

    const corporateRevenue = buildIncome({ date: '2026-10-03', description: 'x', departmentId: dept('CORP').id, moneyAccount: acc('Corporate Bank'), revenueAccount: acc('CAD / Revit Drafting'), grossMinor: 1000 });
    await expect(post(ids.owner, corporateRevenue)).rejects.toThrow(/operating department/);

    const wrongRate = buildIncome({ date: '2026-10-03', description: 'x', departmentId: dept('CIV').id, moneyAccount: acc('Payoneer USD'), revenueAccount: acc('CAD / Revit Drafting'), grossMinor: 1000, fxRate: '300' });
    wrongRate.lines[0].amount_lkr_minor += 500;
    wrongRate.lines[1].amount_lkr_minor -= 500;
    await expect(post(ids.civil, wrongRate)).rejects.toThrow(/does not match its exchange rate/);

    const wrongDeptAccount = structuredClone(base);
    wrongDeptAccount.lines[1].department_id = dept('MEC').id;
    await expect(post(ids.owner, wrongDeptAccount)).rejects.toThrow(/belongs to another department/);
  });

  it('records department transfers and edits entries with a full before/after audit', async () => {
    const t = buildTransfer({ date: '2026-10-10', description: 'Funding', fromAccount: acc('Civil Bank'), toAccount: acc('Mechanical Bank'), sentMinor: 2000000, receivedMinor: 2000000, fxAccount: sys('fx_difference') });
    const entry = await post(ids.civil, t);
    expect(entry.number).toBe('TRF-2026-00001');
    const edited = structuredClone(t);
    edited.entry.id = entry.id;
    edited.lines[0].amount_minor = edited.lines[0].amount_lkr_minor = -2500000;
    edited.lines[1].amount_minor = edited.lines[1].amount_lkr_minor = 2500000;
    await post(ids.civil, edited);
    const audit = (await db.query(`select action, before, after from public.audit_events where record_id = $1 order by id`, [entry.id])).rows;
    expect(audit.map((a) => a.action)).toEqual(['post', 'update']);
    expect(audit[1].before.lines[0].amount_minor).toBe(-2000000);
    expect(audit[1].after.lines[0].amount_minor).toBe(-2500000);
  });

  it('links a receipt to an invoice', async () => {
    const client = (await as(ids.civil, (c) => c.query(`insert into public.parties (kind, name) values ('client', 'Smith LLC') returning id`))).rows[0];
    const inv = (await as(ids.civil, (c) => c.query(`insert into public.invoices (department_id, client_id, issue_date, currency, total_minor) values ($1, $2, '2026-10-01', 'USD', 50000) returning id, number`, [dept('CIV').id, client.id]))).rows[0];
    expect(inv.number).toBe('INV-2026-0001');
    const d = buildIncome({ date: '2026-10-12', description: 'Invoice payment', departmentId: dept('CIV').id, moneyAccount: acc('Payoneer USD'), revenueAccount: acc('CAD / Revit Drafting'), grossMinor: 50000, fxRate: '301', invoiceId: inv.id });
    const e = await post(ids.civil, d, { invoice_payments: [{ invoice_id: inv.id, amount_minor: 50000 }] });
    const pay = (await db.query('select * from public.invoice_payments where entry_id = $1', [e.id])).rows;
    expect(pay).toHaveLength(1);
  });
});

describe('void, status and month lock', () => {
  it('voids with a reason and keeps the record', async () => {
    const d = buildExpense({ date: '2026-10-15', description: 'Duplicate bill', departmentId: dept('CIV').id, moneyAccount: acc('Civil Bank'), splits: [{ account: acc('Utilities'), amountMinor: 5000 }] });
    const e = await post(ids.civil, d);
    await expect(as(ids.civil, (c) => c.query(`select public.void_entry($1, '')`, [e.id]))).rejects.toThrow(/reason/);
    const v = (await as(ids.civil, (c) => c.query(`select * from public.void_entry($1, 'Entered twice')`, [e.id]))).rows[0];
    expect(v.status).toBe('void');
    await expect(as(ids.civil, (c) => c.query(`select public.void_entry($1, 'again')`, [e.id]))).rejects.toThrow(/already void/);
  });

  it('locks closed months against posting, editing and voiding', async () => {
    const d = buildExpense({ date: '2026-09-20', description: 'September bill', departmentId: dept('CIV').id, moneyAccount: acc('Civil Bank'), splits: [{ account: acc('Utilities'), amountMinor: 7000 }] });
    const e = await post(ids.civil, d);
    await expect(as(ids.civil, (c) => c.query(`select public.set_period_lock('2026-09-30')`))).rejects.toThrow(/Only an admin/);
    await as(ids.owner, (c) => c.query(`select public.set_period_lock('2026-09-30')`));
    await expect(post(ids.civil, d)).rejects.toThrow(/locked up to 2026-09-30/);
    await expect(as(ids.civil, (c) => c.query(`select public.void_entry($1, 'x')`, [e.id]))).rejects.toThrow(/locked/);
    const moved = structuredClone(d);
    moved.entry.id = e.id;
    moved.entry.date = '2026-10-01';
    await expect(post(ids.civil, moved)).rejects.toThrow(/locked/);
    await as(ids.owner, (c) => c.query(`select public.set_period_lock(null)`));
  });

  it('reconciles lines without allowing other departments', async () => {
    const line = (await db.query(`select l.id from public.entry_lines l join public.ledger_accounts a on a.id = l.account_id where a.name = 'Mechanical Bank' limit 1`)).rows[0];
    await expect(as(ids.civil, (c) => c.query(`select public.reconcile_lines($1, true)`, [[line.id]]))).rejects.toThrow(/own department/);
    const n = (await as(ids.mech, (c) => c.query(`select public.reconcile_lines($1, true) as n`, [[line.id]]))).rows[0].n;
    expect(n).toBe(1);
  });
});

describe('reports read from v_ledger match the TypeScript engine', () => {
  it('computes department figures from the database rows', async () => {
    const rows: LedgerRow[] = await as(ids.viewer, async (c) => (await c.query('select * from public.v_ledger')).rows);
    const accountMap = new Map(accounts.map((a) => [a.id, a]));
    const fig = figuresFor(countableRows(rows), { accounts: accountMap, departments });
    // Civil: 1,000 USD @300 + 500 USD @301 revenue; fee 30,000
    expect(fig.byDept[dept('CIV').id].revenue).toBe(30000000 + 15050000);
    expect(fig.byDept[dept('CIV').id].expenses).toBe(3000000 + 7000); // fee + September bill (void one excluded)
    expect(fig.byDept[dept('MEC').id].revenue).toBe(100000);
    expect(fig.byDept[dept('CIV').id].transferNet).toBe(-2500000);
    expect(fig.byDept[dept('MEC').id].transferNet).toBe(2500000);
    expect(fig.operatingProfit).toBe(fig.revenue - fig.totalCost);
  });
});
