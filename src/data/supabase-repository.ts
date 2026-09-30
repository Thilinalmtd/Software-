import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { withDefaults } from '@/domain/defaults';
import type { Attachment, CompanySettings, Entry, EntryLine, FxRate, LedgerRow, Member, PostingDraft, Role, Uuid } from '@/domain/types';
import {
  RepositoryError,
  safeFileName,
  sha256Hex,
  type EntryLinks,
  type ListOptions,
  type Repository,
  type Session,
  type TableName,
  type TableRows,
  type WritableTable,
} from './repository';

const PAGE = 1000; // PostgREST's default maximum rows per request
const BUCKET = 'attachments';

// Numeric columns arrive as JSON numbers; the domain keeps rates/quantities as decimal strings.
function normalise<T extends TableName>(table: T | 'v_ledger' | 'entry_lines', row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  const toStr = (k: string) => {
    if (out[k] !== null && out[k] !== undefined) out[k] = String(out[k]);
  };
  if (table === 'v_ledger' || table === 'entry_lines') toStr('fx_rate');
  if (table === 'fx_rates') toStr('rate');
  if (table === 'projects') toStr('planning_fx_rate');
  if (table === 'invoice_items') toStr('quantity');
  return out;
}

function fail(error: { message: string; code?: string } | null, fallback = 'Something went wrong.'): never {
  throw new RepositoryError(error?.message?.replace(/^.*?ERROR:\s*/, '') || fallback, error?.code);
}

const PK: Partial<Record<TableName, string>> = { members: 'user_id' };

export class SupabaseRepository implements Repository {
  readonly mode = 'supabase' as const;
  readonly client: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'aptocad-finance-auth' },
    });
  }

  // ---------------------------------------------------------------- auth
  async getSession(): Promise<Session | null> {
    const { data } = await this.client.auth.getSession();
    const u = data.session?.user;
    return u ? { userId: u.id, email: u.email ?? '' } : null;
  }

  onAuthChange(cb: (session: Session | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      const u = session?.user;
      // Defer: calling Supabase from inside this callback can deadlock the auth lock.
      setTimeout(() => cb(u ? { userId: u.id, email: u.email ?? '' } : null), 0);
    });
    return () => data.subscription.unsubscribe();
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) fail(error);
  }

  async signUp(email: string, password: string, fullName: string): Promise<{ needsConfirmation: boolean }> {
    const { data, error } = await this.client.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
    if (error) fail(error);
    return { needsConfirmation: !data.session };
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  async resetPassword(email: string): Promise<void> {
    const { error } = await this.client.auth.resetPasswordForEmail(email);
    if (error) fail(error);
  }

  async currentMember(): Promise<Member | null> {
    const session = await this.getSession();
    if (!session) return null;
    const { data, error } = await this.client.from('members').select('*').eq('user_id', session.userId).maybeSingle();
    if (error) fail(error);
    return (data as Member) ?? null;
  }

  // ---------------------------------------------------------------- tables
  private async selectAll(source: string, opts: ListOptions = {}): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = this.client.from(source).select('*');
      for (const [k, v] of Object.entries(opts.eq ?? {})) q = v === null ? q.is(k, null) : q.eq(k, v);
      for (const [k, v] of Object.entries(opts.gte ?? {})) q = q.gte(k, v);
      for (const [k, v] of Object.entries(opts.lte ?? {})) q = q.lte(k, v);
      if (opts.order) q = q.order(opts.order.column, { ascending: opts.order.ascending ?? true });
      else if (source === 'v_ledger') q = q.order('date').order('entry_id').order('line_no');
      const limit = opts.limit ? Math.min(PAGE, opts.limit - rows.length) : PAGE;
      const { data, error } = await q.range(from, from + limit - 1);
      if (error) fail(error);
      rows.push(...(data ?? []));
      if (!data || data.length < limit || (opts.limit && rows.length >= opts.limit)) break;
    }
    return rows;
  }

  async list<T extends TableName>(table: T, opts?: ListOptions): Promise<TableRows[T][]> {
    const rows = await this.selectAll(table, opts);
    return rows.map((r) => normalise(table, r)) as unknown as TableRows[T][];
  }

  async insert<T extends WritableTable>(table: T, row: Partial<TableRows[T]>): Promise<TableRows[T]> {
    const { data, error } = await this.client.from(table).insert(row as never).select('*').single();
    if (error) fail(error);
    return normalise(table, data) as unknown as TableRows[T];
  }

  async insertMany<T extends WritableTable>(table: T, rows: Partial<TableRows[T]>[]): Promise<TableRows[T][]> {
    if (rows.length === 0) return [];
    const out: TableRows[T][] = [];
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await this.client.from(table).insert(rows.slice(i, i + 500) as never[]).select('*');
      if (error) fail(error);
      out.push(...((data ?? []).map((r) => normalise(table, r)) as unknown as TableRows[T][]));
    }
    return out;
  }

  async update<T extends WritableTable>(table: T, id: string, patch: Partial<TableRows[T]>): Promise<TableRows[T]> {
    const { data, error } = await this.client.from(table as string).update(patch as never).eq(String(PK[table] ?? 'id'), id).select('*').single();
    if (error) fail(error);
    return normalise(table, data) as unknown as TableRows[T];
  }

  async remove<T extends WritableTable>(table: T, id: string): Promise<void> {
    const { error } = await this.client.from(table as string).delete().eq(String(PK[table] ?? 'id'), id);
    if (error) fail(error);
  }

  async upsertFxRates(rates: FxRate[]): Promise<void> {
    if (!rates.length) return;
    const { error } = await this.client.from('fx_rates').upsert(rates.map((r) => ({ ...r, rate: Number(r.rate) })), { onConflict: 'date,currency' });
    if (error) fail(error);
  }

  async upsertBudgets(rows: Omit<import('@/domain/types').Budget, 'id'>[]): Promise<void> {
    if (!rows.length) return;
    const { error } = await this.client.from('budgets').upsert(rows, { onConflict: 'department_id,account_id,month' });
    if (error) fail(error);
  }

  // ---------------------------------------------------------------- settings & control
  async getSettings(): Promise<CompanySettings> {
    const { data, error } = await this.client.from('company_settings').select('data').eq('id', 1).maybeSingle();
    if (error) fail(error);
    return withDefaults((data?.data as Partial<CompanySettings>) ?? null);
  }

  async saveSettings(settings: CompanySettings): Promise<void> {
    const { error } = await this.client.from('company_settings').update({ data: settings }).eq('id', 1);
    if (error) fail(error);
  }

  async getPeriodLock(): Promise<string | null> {
    const { data, error } = await this.client.from('period_lock').select('locked_through').eq('id', 1).maybeSingle();
    if (error) fail(error);
    return (data?.locked_through as string | null) ?? null;
  }

  async setPeriodLock(date: string | null): Promise<void> {
    const { error } = await this.client.rpc('set_period_lock', { p_date: date });
    if (error) fail(error);
  }

  async setMember(userId: Uuid, role: Role | null, departmentId: Uuid | null, active: boolean): Promise<void> {
    const { error } = await this.client.rpc('set_member', { p_user_id: userId, p_role: role, p_department_id: departmentId, p_active: active });
    if (error) fail(error);
  }

  // ---------------------------------------------------------------- ledger
  async ledger(range: { from?: string; to?: string } = {}): Promise<LedgerRow[]> {
    const rows = await this.selectAll('v_ledger', { gte: range.from ? { date: range.from } : undefined, lte: range.to ? { date: range.to } : undefined });
    return rows.map((r) => normalise('v_ledger', r)) as unknown as LedgerRow[];
  }

  async entryLines(entryId: Uuid): Promise<EntryLine[]> {
    const rows = await this.selectAll('entry_lines', { eq: { entry_id: entryId }, order: { column: 'line_no' } });
    return rows.map((r) => normalise('entry_lines', r)) as unknown as EntryLine[];
  }

  async postEntry(draft: PostingDraft, links: EntryLinks = {}): Promise<Entry> {
    const { data, error } = await this.client.rpc('post_entry', { p_entry: draft.entry, p_lines: draft.lines, p_links: links });
    if (error) fail(error);
    return data as Entry;
  }

  async voidEntry(id: Uuid, reason: string): Promise<Entry> {
    const { data, error } = await this.client.rpc('void_entry', { p_id: id, p_reason: reason });
    if (error) fail(error);
    return data as Entry;
  }

  async setEntryStatus(id: Uuid, status: 'cleared' | 'pending'): Promise<Entry> {
    const { data, error } = await this.client.rpc('set_entry_status', { p_id: id, p_status: status });
    if (error) fail(error);
    return data as Entry;
  }

  async reconcileLines(lineIds: Uuid[], reconciled: boolean, statementLineId: Uuid | null = null, date?: string): Promise<number> {
    const { data, error } = await this.client.rpc('reconcile_lines', { p_line_ids: lineIds, p_reconciled: reconciled, p_statement_line_id: statementLineId, p_date: date ?? new Date().toISOString().slice(0, 10) });
    if (error) fail(error);
    return data as number;
  }

  async completeReconciliation(accountId: Uuid, date: string): Promise<void> {
    const { error } = await this.client.rpc('complete_reconciliation', { p_account_id: accountId, p_date: date });
    if (error) fail(error);
  }

  // ---------------------------------------------------------------- files
  async uploadAttachment(file: File, link: { entry_id?: Uuid | null; invoice_id?: Uuid | null; bill_id?: Uuid | null }): Promise<Attachment> {
    if (file.size > 25 * 1024 * 1024) throw new RepositoryError('Files must be 25 MB or smaller.');
    const buffer = await file.arrayBuffer();
    const folder = link.entry_id ?? link.invoice_id ?? link.bill_id ?? 'misc';
    const path = `${folder}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    const { error: upErr } = await this.client.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (upErr) fail(upErr);
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
    const { data, error } = await this.client.storage.from(BUCKET).createSignedUrl(attachment.storage_path, 3600);
    if (error) fail(error);
    return data.signedUrl;
  }

  async deleteAttachment(attachment: Attachment): Promise<void> {
    await this.remove('attachments', attachment.id);
    await this.client.storage.from(BUCKET).remove([attachment.storage_path]);
  }

  subscribeChanges(cb: (table: string) => void): () => void {
    const channel = this.client
      .channel('aptocad-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => cb(payload.table))
      .subscribe();
    return () => {
      void this.client.removeChannel(channel);
    };
  }
}
