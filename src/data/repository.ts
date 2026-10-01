import type {
  Attachment,
  AuditEvent,
  Bill,
  BillPayment,
  Budget,
  CategorisationRule,
  CompanySettings,
  Department,
  Entry,
  EntryLine,
  EntryStatus,
  FxRate,
  Invoice,
  InvoiceItem,
  InvoicePayment,
  LedgerAccount,
  LedgerRow,
  Member,
  Party,
  PayrollRun,
  Payslip,
  PostingDraft,
  Project,
  RecurringTemplate,
  Role,
  StatementImport,
  StatementLine,
  Uuid,
} from '@/domain/types';

// The single data interface used by every screen. Two implementations:
//   SupabaseRepository — the shared company database (production)
//   DemoRepository     — in-browser sample data (try the app without a database)

export interface TableRows {
  departments: Department;
  members: Member;
  ledger_accounts: LedgerAccount;
  parties: Party;
  projects: Project;
  entries: Entry;
  invoices: Invoice;
  invoice_items: InvoiceItem;
  invoice_payments: InvoicePayment;
  bills: Bill;
  bill_payments: BillPayment;
  payroll_runs: PayrollRun;
  payslips: Payslip;
  recurring_templates: RecurringTemplate;
  statement_imports: StatementImport;
  statement_lines: StatementLine;
  budgets: Budget;
  categorisation_rules: CategorisationRule;
  attachments: Attachment;
  fx_rates: FxRate;
  audit_events: AuditEvent;
}

export type TableName = keyof TableRows;

/** Tables the UI may write directly (the rest change only through RPCs). */
export type WritableTable = Exclude<TableName, 'members' | 'entries' | 'invoice_payments' | 'bill_payments' | 'audit_events'>;

export interface ListOptions {
  eq?: Record<string, string | number | boolean | null>;
  gte?: Record<string, string | number>;
  lte?: Record<string, string | number>;
  order?: { column: string; ascending?: boolean };
  limit?: number;
}

export interface Session {
  userId: Uuid;
  email: string;
}

export interface EntryLinks {
  invoice_payments?: { invoice_id: Uuid; amount_minor: number }[];
  bill_payments?: { bill_id: Uuid; amount_minor: number }[];
}

export type RepositoryMode = 'supabase' | 'demo';

export interface Repository {
  readonly mode: RepositoryMode;

  // Authentication
  getSession(): Promise<Session | null>;
  onAuthChange(cb: (session: Session | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, fullName: string): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;
  /** Confirms a new account with the code from the sign-up email, and signs in. */
  confirmEmail(email: string, code: string): Promise<void>;
  resendConfirmation(email: string): Promise<void>;
  /** Emails a password-reset code. */
  resetPassword(email: string): Promise<void>;
  /** Signs in with the code from the reset email and sets the new password. */
  completePasswordReset(email: string, code: string, newPassword: string): Promise<void>;
  currentMember(): Promise<Member | null>;

  // Generic table access (RLS applies)
  list<T extends TableName>(table: T, opts?: ListOptions): Promise<TableRows[T][]>;
  insert<T extends WritableTable>(table: T, row: Partial<TableRows[T]>): Promise<TableRows[T]>;
  insertMany<T extends WritableTable>(table: T, rows: Partial<TableRows[T]>[]): Promise<TableRows[T][]>;
  update<T extends WritableTable>(table: T, id: string, patch: Partial<TableRows[T]>): Promise<TableRows[T]>;
  remove<T extends WritableTable>(table: T, id: string): Promise<void>;
  upsertFxRates(rates: FxRate[]): Promise<void>;
  upsertBudgets(rows: Omit<Budget, 'id'>[]): Promise<void>;

  // Settings & control
  getSettings(): Promise<CompanySettings>;
  saveSettings(settings: CompanySettings): Promise<void>;
  getPeriodLock(): Promise<string | null>;
  setPeriodLock(date: string | null): Promise<void>;
  setMember(userId: Uuid, role: Role | null, departmentId: Uuid | null, active: boolean): Promise<void>;

  // Ledger
  ledger(range?: { from?: string; to?: string }): Promise<LedgerRow[]>;
  entryLines(entryId: Uuid): Promise<EntryLine[]>;
  postEntry(draft: PostingDraft, links?: EntryLinks): Promise<Entry>;
  voidEntry(id: Uuid, reason: string): Promise<Entry>;
  setEntryStatus(id: Uuid, status: Exclude<EntryStatus, 'void'>): Promise<Entry>;
  reconcileLines(lineIds: Uuid[], reconciled: boolean, statementLineId?: Uuid | null, date?: string): Promise<number>;
  completeReconciliation(accountId: Uuid, date: string): Promise<void>;

  // Files
  uploadAttachment(file: File, link: { entry_id?: Uuid | null; invoice_id?: Uuid | null; bill_id?: Uuid | null }): Promise<Attachment>;
  attachmentUrl(attachment: Attachment): Promise<string>;
  deleteAttachment(attachment: Attachment): Promise<void>;

  /** Subscribe to changes made by other users (Supabase Realtime); returns an unsubscribe function. */
  subscribeChanges(cb: (table: string) => void): () => void;
}

export class RepositoryError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'RepositoryError';
  }
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function safeFileName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(-120);
}
