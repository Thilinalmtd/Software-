import { DEFAULT_SETTINGS, withDefaults } from '@/domain/defaults';
import { validatePosting } from '@/domain/posting';
import { today } from '@/domain/period';
import type {
  Attachment,
  AuditEvent,
  Budget,
  CompanySettings,
  Entry,
  EntryLine,
  FxRate,
  LedgerRow,
  Member,
  PostingDraft,
  Role,
  Uuid,
} from '@/domain/types';
import {
  RepositoryError,
  sha256Hex,
  type EntryLinks,
  type ListOptions,
  type Repository,
  type Session,
  type TableName,
  type TableRows,
  type WritableTable,
} from './repository';

// In-browser implementation used for the demo and for UI tests. It applies the same posting
// validation as the database; the demo user is an admin.

export const DEMO_USER_ID = '00000000-0000-4000-8000-000000000001';
const STORAGE_KEY = 'aptocad-finance-demo-v1';

type Tables = { [K in TableName]: TableRows[K][] };

export interface DemoStore extends Tables {
  entry_lines: EntryLine[];
  settings: CompanySettings;
  period_lock: string | null;
  sequences: Record<string, number>;
}

export function emptyStore(): DemoStore {
  return {
    departments: [], members: [], ledger_accounts: [], parties: [], projects: [], entries: [], invoices: [], invoice_items: [],
    invoice_payments: [], bills: [], bill_payments: [], payroll_runs: [], payslips: [], recurring_templates: [], statement_imports: [],
    statement_lines: [], budgets: [], categorisation_rules: [], attachments: [], fx_rates: [], audit_events: [], entry_lines: [],
    settings: structuredClone(DEFAULT_SETTINGS), period_lock: null, sequences: {},
  };
}

const PK: Partial<Record<TableName, string>> = { members: 'user_id' };
const nowIso = () => new Date().toISOString();
const clone = <T>(v: T): T => structuredClone(v);

export class DemoRepository implements Repository {
  readonly mode = 'demo' as const;
  private store: DemoStore;
  private session: Session | null = { userId: DEMO_USER_ID, email: 'demo@aptocad.lk' };
  private authListeners = new Set<(s: Session | null) => void>();
  private blobs = new Map<string, Blob>();
  private persistEnabled: boolean;

  constructor(store?: DemoStore, opts: { persist?: boolean } = {}) {
    this.persistEnabled = opts.persist ?? true;
    this.store = store ?? DemoRepository.load() ?? emptyStore();
  }

  static load(): DemoStore | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as DemoStore) : null;
    } catch {
      return null;
    }
  }

  static clearSaved(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  }

  isEmpty(): boolean {
    return this.store.departments.length === 0;
  }

  persist(): void {
    if (!this.persistEnabled) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.store));
    } catch {
      /* storage full or unavailable — demo keeps working in memory */
    }
  }

  private nextNumber(prefix: string, year: number): number {
    const key = `${prefix}|${year}`;
    this.store.sequences[key] = (this.store.sequences[key] ?? 0) + 1;
    return this.store.sequences[key];
  }

  private audit(table: string, recordId: string, action: AuditEvent['action'], before: unknown, after: unknown): void {
    const id = (this.store.audit_events.at(-1)?.id ?? 0) + 1;
    this.store.audit_events.push({ id, at: nowIso(), user_id: this.session?.userId ?? null, user_email: this.session?.email ?? null, table_name: table, record_id: recordId, action, before: (before as Record<string, unknown>) ?? null, after: (after as Record<string, unknown>) ?? null });
  }

  // ---------------------------------------------------------------- auth
  async getSession(): Promise<Session | null> {
    return this.session;
  }

  onAuthChange(cb: (session: Session | null) => void): () => void {
    this.authListeners.add(cb);
    return () => this.authListeners.delete(cb);
  }

  async signIn(email: string): Promise<void> {
    this.session = { userId: DEMO_USER_ID, email: email || 'demo@aptocad.lk' };
    this.authListeners.forEach((cb) => cb(this.session));
  }

  async signUp(email: string): Promise<{ needsConfirmation: boolean }> {
    await this.signIn(email);
    return { needsConfirmation: false };
  }

  async signOut(): Promise<void> {
    this.session = null;
    this.authListeners.forEach((cb) => cb(null));
  }

  async confirmEmail(email: string): Promise<void> {
    await this.signIn(email);
  }

  async resendConfirmation(): Promise<void> {}

  async resetPassword(): Promise<void> {}

  async completePasswordReset(email: string): Promise<void> {
    await this.signIn(email);
  }

  async currentMember(): Promise<Member | null> {
    if (!this.session) return null;
    return clone(this.store.members.find((m) => m.user_id === DEMO_USER_ID) ?? null);
  }

  // ---------------------------------------------------------------- tables
  async list<T extends TableName>(table: T, opts: ListOptions = {}): Promise<TableRows[T][]> {
    let rows = (this.store[table] as unknown as Record<string, unknown>[]).filter((r) => {
      for (const [k, v] of Object.entries(opts.eq ?? {})) if ((r[k] ?? null) !== v) return false;
      for (const [k, v] of Object.entries(opts.gte ?? {})) if ((r[k] as string | number) < v) return false;
      for (const [k, v] of Object.entries(opts.lte ?? {})) if ((r[k] as string | number) > v) return false;
      return true;
    });
    if (opts.order) {
      const { column, ascending = true } = opts.order;
      rows = [...rows].sort((a, b) => {
        const x = a[column] as string | number, y = b[column] as string | number;
        return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
      });
    }
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return clone(rows) as unknown as TableRows[T][];
  }

  private withDefaults<T extends WritableTable>(table: T, row: Partial<TableRows[T]>): TableRows[T] {
    const r = { ...row } as Record<string, unknown>;
    if (!r.id && table !== 'fx_rates') r.id = crypto.randomUUID();
    const stamp = nowIso();
    const defaults: Record<string, unknown> = { created_at: stamp, updated_at: stamp, archived: false, notes: null };
    for (const [k, v] of Object.entries(defaults)) if (!(k in r)) r[k] = v;
    if (table === 'projects' && !r.code) {
      const dept = this.store.departments.find((d) => d.id === r.department_id);
      r.code = `${dept?.code ?? 'PRJ'}-P-${String(this.nextNumber(`PRJ-${dept?.code}`, 0)).padStart(4, '0')}`;
    }
    if (table === 'invoices' && !r.number) {
      const prefix = r.kind === 'quote' ? 'QUO' : 'INV';
      const year = Number(String(r.issue_date).slice(0, 4));
      r.number = `${prefix}-${year}-${String(this.nextNumber(prefix, year)).padStart(4, '0')}`;
    }
    if ((table === 'invoices' || table === 'bills' || table === 'attachments' || table === 'payroll_runs') && !('created_by' in r)) r.created_by = this.session?.userId ?? null;
    return r as unknown as TableRows[T];
  }

  async insert<T extends WritableTable>(table: T, row: Partial<TableRows[T]>): Promise<TableRows[T]> {
    const full = this.withDefaults(table, row);
    if (table === 'statement_lines') {
      const s = full as unknown as { account_id: string; hash: string };
      if (this.store.statement_lines.some((x) => x.account_id === s.account_id && x.hash === s.hash)) throw new RepositoryError('duplicate key value violates unique constraint', '23505');
    }
    (this.store[table] as unknown as TableRows[T][]).push(full);
    this.audit(table, String((full as unknown as Record<string, unknown>)[PK[table] ?? 'id']), 'insert', null, full);
    this.persist();
    return clone(full);
  }

  async insertMany<T extends WritableTable>(table: T, rows: Partial<TableRows[T]>[]): Promise<TableRows[T][]> {
    const out: TableRows[T][] = [];
    for (const r of rows) out.push(await this.insert(table, r));
    return out;
  }

  async update<T extends WritableTable>(table: T, id: string, patch: Partial<TableRows[T]>): Promise<TableRows[T]> {
    const list = this.store[table] as unknown as Record<string, unknown>[];
    const key = PK[table] ?? 'id';
    const idx = list.findIndex((r) => r[key] === id);
    if (idx < 0) throw new RepositoryError('Record not found.');
    const before = clone(list[idx]);
    list[idx] = { ...list[idx], ...patch, ...('updated_at' in list[idx] ? { updated_at: nowIso() } : {}) };
    this.audit(table, id, 'update', before, list[idx]);
    this.persist();
    return clone(list[idx]) as unknown as TableRows[T];
  }

  async remove<T extends WritableTable>(table: T, id: string): Promise<void> {
    const list = this.store[table] as unknown as Record<string, unknown>[];
    const key = PK[table] ?? 'id';
    const idx = list.findIndex((r) => r[key] === id);
    if (idx < 0) return;
    const [removed] = list.splice(idx, 1);
    if (table === 'invoices') {
      this.store.invoice_items = this.store.invoice_items.filter((i) => i.invoice_id !== id);
    }
    this.audit(table, id, 'delete', removed, null);
    this.persist();
  }

  async upsertFxRates(rates: FxRate[]): Promise<void> {
    for (const r of rates) {
      const idx = this.store.fx_rates.findIndex((x) => x.date === r.date && x.currency === r.currency);
      if (idx >= 0) this.store.fx_rates[idx] = { ...r };
      else this.store.fx_rates.push({ ...r });
    }
    this.persist();
  }

  async upsertBudgets(rows: Omit<Budget, 'id'>[]): Promise<void> {
    for (const r of rows) {
      const idx = this.store.budgets.findIndex((b) => b.department_id === r.department_id && b.account_id === r.account_id && b.month === r.month);
      if (idx >= 0) this.store.budgets[idx] = { ...this.store.budgets[idx], amount_lkr_minor: r.amount_lkr_minor };
      else this.store.budgets.push({ ...r, id: crypto.randomUUID() });
    }
    this.persist();
  }

  // ---------------------------------------------------------------- settings & control
  async getSettings(): Promise<CompanySettings> {
    return withDefaults(clone(this.store.settings));
  }

  async saveSettings(settings: CompanySettings): Promise<void> {
    this.audit('company_settings', '1', 'update', this.store.settings, settings);
    this.store.settings = clone(settings);
    this.persist();
  }

  async getPeriodLock(): Promise<string | null> {
    return this.store.period_lock;
  }

  async setPeriodLock(date: string | null): Promise<void> {
    this.audit('period_lock', '1', 'update', { locked_through: this.store.period_lock }, { locked_through: date });
    this.store.period_lock = date;
    this.persist();
  }

  async setMember(userId: Uuid, role: Role | null, departmentId: Uuid | null, active: boolean): Promise<void> {
    const m = this.store.members.find((x) => x.user_id === userId);
    if (!m) throw new RepositoryError('User not found.');
    if (role === 'director' && !departmentId) throw new RepositoryError('A director needs a department.');
    const admins = this.store.members.filter((x) => x.role === 'admin' && x.active);
    if (m.role === 'admin' && m.active && (role !== 'admin' || !active) && admins.length === 1) throw new RepositoryError('There must be at least one active admin.');
    await this.update('members' as never, userId, { role, department_id: role === 'director' ? departmentId : null, active } as never);
  }

  // ---------------------------------------------------------------- ledger
  async ledger(range: { from?: string; to?: string } = {}): Promise<LedgerRow[]> {
    const entries = new Map(this.store.entries.map((e) => [e.id, e]));
    const rows: LedgerRow[] = [];
    for (const l of this.store.entry_lines) {
      const e = entries.get(l.entry_id);
      if (!e || (range.from && e.date < range.from) || (range.to && e.date > range.to)) continue;
      rows.push({ ...l, date: e.date, status: e.status, kind: e.kind, entry_number: e.number, entry_department_id: e.department_id, entry_description: e.description, party_id: e.party_id, channel: e.channel });
    }
    return clone(rows.sort((a, b) => a.date.localeCompare(b.date) || a.entry_id.localeCompare(b.entry_id) || a.line_no - b.line_no));
  }

  async entryLines(entryId: Uuid): Promise<EntryLine[]> {
    return clone(this.store.entry_lines.filter((l) => l.entry_id === entryId).sort((a, b) => a.line_no - b.line_no));
  }

  private snapshot(id: Uuid) {
    const e = this.store.entries.find((x) => x.id === id);
    return e ? { ...clone(e), lines: this.store.entry_lines.filter((l) => l.entry_id === id) } : null;
  }

  async postEntry(draft: PostingDraft, links: EntryLinks = {}): Promise<Entry> {
    const existing = draft.entry.id ? this.store.entries.find((e) => e.id === draft.entry.id) : undefined;
    if (existing?.status === 'void') throw new RepositoryError('A voided entry cannot be changed.');
    if (existing && existing.kind !== draft.entry.kind) throw new RepositoryError('The type of an entry cannot be changed.');
    const issues = validatePosting(existing ? draft : { ...draft, entry: { ...draft.entry, id: undefined } }, {
      accounts: new Map(this.store.ledger_accounts.map((a) => [a.id, a])),
      departments: new Map(this.store.departments.map((d) => [d.id, d])),
      lockedThrough: this.store.period_lock,
      originalDate: existing?.date ?? null,
    });
    if (issues.length) throw new RepositoryError(issues.join(' '));
    const before = existing ? this.snapshot(existing.id) : null;
    const stamp = nowIso();
    let entry: Entry;
    if (existing) {
      entry = Object.assign(existing, { ...draft.entry, id: existing.id, number: existing.number, updated_at: stamp, updated_by: this.session?.userId ?? null });
      this.store.entry_lines = this.store.entry_lines.filter((l) => l.entry_id !== existing.id);
      this.store.invoice_payments = this.store.invoice_payments.filter((p) => p.entry_id !== existing.id);
      this.store.bill_payments = this.store.bill_payments.filter((p) => p.entry_id !== existing.id);
    } else {
      const prefix = { income: 'INC', expense: 'EXP', transfer: 'TRF', payroll: 'PAY', statutory_payment: 'STA', opening_balance: 'OPB', adjustment: 'ADJ' }[draft.entry.kind];
      const year = Number(draft.entry.date.slice(0, 4));
      entry = {
        ...draft.entry,
        id: draft.entry.id ?? crypto.randomUUID(),
        number: `${prefix}-${year}-${String(this.nextNumber(prefix, year)).padStart(5, '0')}`,
        void_reason: null,
        voided_at: null,
        voided_by: null,
        created_by: this.session?.userId ?? null,
        created_at: stamp,
        updated_by: this.session?.userId ?? null,
        updated_at: stamp,
      };
      this.store.entries.push(entry);
    }
    draft.lines.forEach((l, i) => this.store.entry_lines.push({ ...l, id: crypto.randomUUID(), entry_id: entry.id, line_no: i + 1, reconciled: false, reconciled_at: null, statement_line_id: null }));
    for (const p of links.invoice_payments ?? []) if (p.amount_minor > 0) this.store.invoice_payments.push({ id: crypto.randomUUID(), entry_id: entry.id, ...p });
    for (const p of links.bill_payments ?? []) if (p.amount_minor > 0) this.store.bill_payments.push({ id: crypto.randomUUID(), entry_id: entry.id, ...p });
    this.audit('entries', entry.id, existing ? 'update' : 'post', before, this.snapshot(entry.id));
    this.persist();
    return clone(entry);
  }

  private editable(id: Uuid): Entry {
    const e = this.store.entries.find((x) => x.id === id);
    if (!e) throw new RepositoryError('Entry not found.');
    if (this.store.period_lock && e.date <= this.store.period_lock) throw new RepositoryError(`The books are locked up to ${this.store.period_lock}.`);
    return e;
  }

  async voidEntry(id: Uuid, reason: string): Promise<Entry> {
    const e = this.editable(id);
    if (e.status === 'void') throw new RepositoryError('This entry is already void.');
    if (!reason.trim()) throw new RepositoryError('Give a reason for voiding.');
    const before = this.snapshot(id);
    Object.assign(e, { status: 'void', void_reason: reason.trim(), voided_at: nowIso(), voided_by: this.session?.userId ?? null, updated_at: nowIso() });
    for (const s of this.store.statement_lines) if (s.matched_entry_id === id) Object.assign(s, { status: 'unmatched', matched_entry_id: null });
    for (const l of this.store.entry_lines) if (l.entry_id === id) Object.assign(l, { reconciled: false, reconciled_at: null, statement_line_id: null });
    this.audit('entries', id, 'void', before, this.snapshot(id));
    this.persist();
    return clone(e);
  }

  async setEntryStatus(id: Uuid, status: 'cleared' | 'pending'): Promise<Entry> {
    const e = this.editable(id);
    if (e.status === 'void') throw new RepositoryError('A voided entry cannot be changed.');
    const before = clone(e);
    e.status = status;
    e.updated_at = nowIso();
    this.audit('entries', id, 'update', before, e);
    this.persist();
    return clone(e);
  }

  async reconcileLines(lineIds: Uuid[], reconciled: boolean, statementLineId: Uuid | null = null, date = today()): Promise<number> {
    let n = 0;
    let entryId: Uuid | null = null;
    for (const l of this.store.entry_lines) {
      if (!lineIds.includes(l.id)) continue;
      Object.assign(l, { reconciled, reconciled_at: reconciled ? date : null, statement_line_id: reconciled ? statementLineId : null });
      entryId ??= l.entry_id;
      n++;
    }
    if (statementLineId) {
      const s = this.store.statement_lines.find((x) => x.id === statementLineId);
      if (s) Object.assign(s, { status: reconciled ? 'matched' : 'unmatched', matched_entry_id: reconciled ? entryId : null });
    }
    this.persist();
    return n;
  }

  async completeReconciliation(accountId: Uuid, date: string): Promise<void> {
    await this.update('ledger_accounts', accountId, { last_reconciled_date: date });
  }

  // ---------------------------------------------------------------- files
  async uploadAttachment(file: File, link: { entry_id?: Uuid | null; invoice_id?: Uuid | null; bill_id?: Uuid | null }): Promise<Attachment> {
    const buffer = await file.arrayBuffer();
    const path = `${link.entry_id ?? link.invoice_id ?? link.bill_id ?? 'misc'}/${crypto.randomUUID()}-${file.name}`;
    this.blobs.set(path, file);
    return this.insert('attachments', {
      entry_id: link.entry_id ?? null,
      invoice_id: link.invoice_id ?? null,
      bill_id: link.bill_id ?? null,
      file_name: file.name,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size,
      storage_path: path,
      sha256: await sha256Hex(buffer),
    });
  }

  async attachmentUrl(attachment: Attachment): Promise<string> {
    const blob = this.blobs.get(attachment.storage_path);
    if (!blob) throw new RepositoryError('In demo mode, files are only kept until the app is closed.');
    return URL.createObjectURL(blob);
  }

  async deleteAttachment(attachment: Attachment): Promise<void> {
    this.blobs.delete(attachment.storage_path);
    await this.remove('attachments', attachment.id);
  }

  subscribeChanges(): () => void {
    return () => {};
  }

  /** Direct access for the demo seed. */
  get raw(): DemoStore {
    return this.store;
  }
}
