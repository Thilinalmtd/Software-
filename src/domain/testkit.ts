import { DEFAULT_CHART, DEFAULT_DEPARTMENTS, DEFAULT_SETTINGS } from './defaults';
import type { Department, EntryStatus, LedgerAccount, LedgerRow, PostingDraft, Uuid } from './types';

// Deterministic fixtures for unit tests.

let counter = 0;
export function testId(prefix = 'id'): Uuid {
  counter++;
  return `${prefix}-${String(counter).padStart(6, '0')}`;
}

export function makeWorld() {
  const departments: Department[] = DEFAULT_DEPARTMENTS.map((d) => ({ ...d, id: `dept-${d.code}`, archived: false }));
  const [civ, mec, corp] = departments;
  const accounts: LedgerAccount[] = DEFAULT_CHART.map((a) => ({
    id: `acc-${a.code}`,
    code: a.code,
    name: a.name,
    type: a.type,
    currency: a.currency ?? null,
    department_id: null,
    category_group: a.category_group,
    system_key: a.system_key ?? null,
    account_number: null,
    last_reconciled_date: null,
    archived: false,
    notes: null,
  }));
  const money = (code: string, name: string, type: LedgerAccount['type'], currency: string, dept: Department): LedgerAccount => {
    const a: LedgerAccount = { id: `acc-${code}`, code, name, type, currency, department_id: dept.id, category_group: null, system_key: null, account_number: null, last_reconciled_date: null, archived: false, notes: null };
    accounts.push(a);
    return a;
  };
  const civBank = money('1010', 'Civil Bank (LKR)', 'bank', 'LKR', civ);
  const mecBank = money('1020', 'Mechanical Bank (LKR)', 'bank', 'LKR', mec);
  const corpBank = money('1030', 'Corporate Bank (LKR)', 'bank', 'LKR', corp);
  const payoneer = money('1110', 'Payoneer (USD)', 'platform', 'USD', civ);
  const upwork = money('1120', 'Upwork (USD)', 'platform', 'USD', corp);
  const map = new Map(accounts.map((a) => [a.id, a]));
  const byName = (name: string) => {
    const a = accounts.find((x) => x.name === name);
    if (!a) throw new Error(`No account ${name}`);
    return a;
  };
  const sys = (key: LedgerAccount['system_key']) => accounts.find((a) => a.system_key === key)!;
  return {
    departments,
    deptMap: new Map(departments.map((d) => [d.id, d])),
    civ,
    mec,
    corp,
    accounts,
    accountMap: map,
    byName,
    sys,
    civBank,
    mecBank,
    corpBank,
    payoneer,
    upwork,
    settings: structuredClone(DEFAULT_SETTINGS),
  };
}

/** Turns a posting draft into ledger rows as the database would store them. */
export function toRows(draft: PostingDraft, status: EntryStatus = draft.entry.status): LedgerRow[] {
  const entryId = draft.entry.id ?? testId('entry');
  return draft.lines.map((l, i) => ({
    ...l,
    id: testId('line'),
    entry_id: entryId,
    line_no: i + 1,
    reconciled: false,
    reconciled_at: null,
    statement_line_id: null,
    date: draft.entry.date,
    status,
    kind: draft.entry.kind,
    entry_number: entryId,
    entry_department_id: draft.entry.department_id,
    entry_description: draft.entry.description,
    party_id: draft.entry.party_id,
    channel: draft.entry.channel,
  }));
}
