-- AptoCAD Finance — schema
-- Every business event is an `entries` row with `entry_lines` whose LKR amounts sum to zero.
-- Entries are written only through the post_entry / void_entry functions (see the next migration).

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('admin', 'director', 'bookkeeper', 'viewer');
create type public.account_type as enum ('bank', 'platform', 'cash', 'card', 'receivable', 'payable', 'liability', 'equity', 'income', 'expense');
create type public.category_group as enum ('revenue', 'other_income', 'direct_cost', 'operating', 'payroll', 'income_tax');
create type public.entry_kind as enum ('income', 'expense', 'transfer', 'payroll', 'statutory_payment', 'opening_balance', 'adjustment');
create type public.entry_status as enum ('cleared', 'pending', 'void');
create type public.line_role as enum ('money', 'revenue', 'expense', 'fee', 'fx', 'salary', 'employer_epf', 'employer_etf', 'epf_payable', 'etf_payable', 'apit_payable', 'deduction', 'liability', 'equity', 'adjustment');
create type public.party_kind as enum ('client', 'vendor', 'staff');
create type public.project_status as enum ('lead', 'active', 'on_hold', 'completed', 'cancelled');
create type public.invoice_kind as enum ('quote', 'invoice');
create type public.invoice_status as enum ('draft', 'sent', 'accepted', 'paid', 'void');
create type public.bill_status as enum ('open', 'paid', 'void');
create type public.statement_line_status as enum ('unmatched', 'matched', 'ignored');
create type public.payroll_run_status as enum ('draft', 'posted');
create type public.frequency as enum ('weekly', 'monthly', 'quarterly', 'yearly');

-- ---------------------------------------------------------------------------
-- Company & people
-- ---------------------------------------------------------------------------
create table public.company_settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{2,8}$'),
  name text not null,
  is_operating boolean not null default true,
  director_name text,
  color text not null default '#64748B',
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role public.member_role,           -- null = waiting for an admin to approve
  department_id uuid references public.departments (id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (role is distinct from 'director' or department_id is not null)
);

-- ---------------------------------------------------------------------------
-- Chart of accounts (money accounts, categories, liabilities, equity)
-- ---------------------------------------------------------------------------
create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type public.account_type not null,
  currency text check (currency ~ '^[A-Z]{3}$'),
  department_id uuid references public.departments (id),
  category_group public.category_group,
  system_key text unique,
  account_number text,
  last_reconciled_date date,
  archived boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (type not in ('bank', 'platform', 'cash', 'card') or (currency is not null and department_id is not null)),
  check ((type in ('income', 'expense')) = (category_group is not null))
);

create table public.parties (
  id uuid primary key default gen_random_uuid(),
  kind public.party_kind not null,
  name text not null,
  email text,
  phone text,
  country text,
  tax_id text,
  address text,
  default_account_id uuid references public.ledger_accounts (id),
  default_department_id uuid references public.departments (id),
  staff_type text check (staff_type in ('employee', 'contractor')),
  epf_number text,
  designation text,
  basic_salary_minor bigint check (basic_salary_minor is null or basic_salary_minor >= 0),
  archived boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index parties_kind_idx on public.parties (kind);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  department_id uuid not null references public.departments (id),
  client_id uuid references public.parties (id),
  name text not null,
  site text,
  country text,
  channel text,
  pricing_type text,
  contract_currency text not null default 'USD' check (contract_currency ~ '^[A-Z]{3}$'),
  contract_value_minor bigint check (contract_value_minor is null or contract_value_minor >= 0),
  planning_fx_rate numeric(20, 8) check (planning_fx_rate is null or planning_fx_rate > 0),
  start_date date,
  target_date date,
  status public.project_status not null default 'active',
  archived boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Sales, bills, payroll, recurring (documents that link to entries)
-- ---------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text unique,
  kind public.invoice_kind not null default 'invoice',
  department_id uuid not null references public.departments (id),
  project_id uuid references public.projects (id),
  client_id uuid not null references public.parties (id),
  issue_date date not null,
  due_date date,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status public.invoice_status not null default 'draft',
  notes text,
  terms text,
  subtotal_minor bigint not null default 0,
  discount_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  total_minor bigint not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  sort_order int not null default 0,
  description text not null,
  quantity numeric(12, 3) not null default 1,
  unit_price_minor bigint not null default 0,
  amount_minor bigint not null default 0
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id);

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid references public.parties (id),
  department_id uuid not null references public.departments (id),
  project_id uuid references public.projects (id),
  account_id uuid not null references public.ledger_accounts (id),
  reference text,
  description text not null,
  bill_date date not null,
  due_date date,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor > 0),
  status public.bill_status not null default 'open',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  period_end date not null,
  pay_date date not null,
  status public.payroll_run_status not null default 'draft',
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.recurring_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('income', 'expense')),
  frequency public.frequency not null default 'monthly',
  next_date date not null,
  end_date date,
  department_id uuid not null references public.departments (id),
  project_id uuid references public.projects (id),
  party_id uuid references public.parties (id),
  money_account_id uuid not null references public.ledger_accounts (id),
  category_account_id uuid not null references public.ledger_accounts (id),
  amount_minor bigint not null check (amount_minor > 0),
  description text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  kind public.entry_kind not null,
  date date not null,
  status public.entry_status not null default 'cleared',
  department_id uuid not null references public.departments (id),
  project_id uuid references public.projects (id),
  party_id uuid references public.parties (id),
  description text not null check (length(trim(description)) > 0),
  reference text,
  channel text,
  payment_method text,
  invoice_id uuid references public.invoices (id),
  bill_id uuid references public.bills (id),
  payroll_run_id uuid references public.payroll_runs (id),
  recurring_id uuid references public.recurring_templates (id) on delete set null,
  void_reason text,
  voided_at timestamptz,
  voided_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb,
  check (status <> 'void' or void_reason is not null)
);
create index entries_date_idx on public.entries (date);
create index entries_kind_idx on public.entries (kind);
create index entries_invoice_idx on public.entries (invoice_id);

create table public.statement_imports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ledger_accounts (id),
  file_name text not null,
  row_count int not null default 0,
  imported_by uuid default auth.uid(),
  imported_at timestamptz not null default now()
);

create table public.statement_lines (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.statement_imports (id) on delete cascade,
  account_id uuid not null references public.ledger_accounts (id),
  date date not null,
  description text not null,
  reference text,
  amount_minor bigint not null,
  balance_minor bigint,
  hash text not null,
  status public.statement_line_status not null default 'unmatched',
  matched_entry_id uuid references public.entries (id) on delete set null,
  unique (account_id, hash)
);
create index statement_lines_account_idx on public.statement_lines (account_id, status);

create table public.entry_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries (id) on delete cascade,
  line_no int not null,
  account_id uuid not null references public.ledger_accounts (id),
  department_id uuid not null references public.departments (id),
  project_id uuid references public.projects (id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null,
  fx_rate numeric(20, 8) not null check (fx_rate > 0),
  amount_lkr_minor bigint not null,
  memo text,
  role public.line_role not null,
  reconciled boolean not null default false,
  reconciled_at date,
  statement_line_id uuid references public.statement_lines (id) on delete set null,
  unique (entry_id, line_no)
);
create index entry_lines_entry_idx on public.entry_lines (entry_id);
create index entry_lines_account_idx on public.entry_lines (account_id);
create index entry_lines_project_idx on public.entry_lines (project_id);

create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  entry_id uuid not null references public.entries (id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0)
);
create index invoice_payments_invoice_idx on public.invoice_payments (invoice_id);

create table public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  entry_id uuid not null references public.entries (id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0)
);
create index bill_payments_bill_idx on public.bill_payments (bill_id);

create table public.payslips (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs (id) on delete cascade,
  employee_id uuid not null references public.parties (id),
  department_id uuid not null references public.departments (id),
  project_id uuid references public.projects (id),
  money_account_id uuid not null references public.ledger_accounts (id),
  epf_applicable boolean not null default true,
  basic_minor bigint not null default 0,
  epf_allowances_minor bigint not null default 0,
  other_allowances_minor bigint not null default 0,
  gross_minor bigint not null default 0,
  employee_epf_minor bigint not null default 0,
  employer_epf_minor bigint not null default 0,
  etf_minor bigint not null default 0,
  apit_minor bigint not null default 0,
  other_deductions_minor bigint not null default 0,
  net_minor bigint not null default 0,
  entry_id uuid references public.entries (id) on delete set null,
  unique (run_id, employee_id)
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id),
  account_id uuid not null references public.ledger_accounts (id),
  month date not null check (extract(day from month) = 1),
  amount_lkr_minor bigint not null,
  unique (department_id, account_id, month)
);

create table public.categorisation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  match_text text not null check (length(trim(match_text)) > 0),
  applies_to text not null default 'any' check (applies_to in ('income', 'expense', 'any')),
  account_id uuid references public.ledger_accounts (id),
  party_id uuid references public.parties (id),
  department_id uuid references public.departments (id),
  project_id uuid references public.projects (id),
  priority int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid references public.entries (id) on delete cascade,
  invoice_id uuid references public.invoices (id) on delete cascade,
  bill_id uuid references public.bills (id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0 and size_bytes <= 26214400),
  storage_path text not null unique,
  sha256 text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index attachments_entry_idx on public.attachments (entry_id);

create table public.fx_rates (
  date date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  rate numeric(20, 8) not null check (rate > 0),
  source text not null,
  fetched_at timestamptz not null default now(),
  primary key (date, currency)
);

create table public.period_lock (
  id int primary key default 1 check (id = 1),
  locked_through date,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table public.number_sequences (
  prefix text not null,
  year int not null,
  last_value int not null default 0,
  primary key (prefix, year)
);

create table public.audit_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid,
  user_email text,
  table_name text not null,
  record_id text not null,
  action text not null,
  before jsonb,
  after jsonb
);
create index audit_events_record_idx on public.audit_events (table_name, record_id);
create index audit_events_at_idx on public.audit_events (at desc);

-- Lines joined with their entry header: what every report reads. Runs with the caller's rights.
create view public.v_ledger with (security_invoker = true) as
select
  l.*,
  e.date,
  e.status,
  e.kind,
  e.number as entry_number,
  e.department_id as entry_department_id,
  e.description as entry_description,
  e.party_id,
  e.channel
from public.entry_lines l
join public.entries e on e.id = l.entry_id;
