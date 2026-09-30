-- AptoCAD Finance — complete database setup (generated; do not edit by hand).
-- Paste into Supabase → SQL Editor → New query → Run, once, on a new project.
-- See docs/SETUP.md.

-- ============================================================================
-- 20261001000100_schema.sql
-- ============================================================================

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

-- ============================================================================
-- 20261001000200_security_and_posting.sql
-- ============================================================================

-- AptoCAD Finance — permissions, audit trail and posting functions.
--
-- Roles (members.role):
--   admin      everything, incl. users, settings and month lock
--   director   records entries for their own department (and Corporate / Shared); reads everything
--   bookkeeper records entries for every department; edits master data
--   viewer     read-only (e.g. the external accountant)
-- A new sign-up has no role until an admin approves it; the very first sign-up becomes admin.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.auth_role() returns public.member_role
language sql stable security definer set search_path = public as $$
  select role from public.members where user_id = auth.uid() and active
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.auth_role() is not null
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_role() = 'admin', false)
$$;

create or replace function public.can_edit_master() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_role() in ('admin', 'bookkeeper', 'director'), false)
$$;

-- Directors write to their own department and to non-operating (Corporate / Shared) departments.
create or replace function public.can_write_department(p_department uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.auth_role()
    when 'admin' then true
    when 'bookkeeper' then true
    when 'director' then
      p_department = (select department_id from public.members where user_id = auth.uid())
      or exists (select 1 from public.departments d where d.id = p_department and not d.is_operating)
    else false
  end
$$;

create or replace function public.currency_decimals(p_currency text) returns int
language sql immutable as $$
  select case p_currency when 'JPY' then 0 when 'KWD' then 3 when 'BHD' then 3 when 'OMR' then 3 else 2 end
$$;

create or replace function public.next_number(p_prefix text, p_year int) returns int
language sql volatile security definer set search_path = public as $$
  insert into public.number_sequences as s (prefix, year, last_value) values (p_prefix, p_year, 1)
  on conflict (prefix, year) do update set last_value = s.last_value + 1
  returning last_value
$$;

create or replace function public.write_audit(p_table text, p_record text, p_action text, p_before jsonb, p_after jsonb)
returns void language sql volatile security definer set search_path = public as $$
  insert into public.audit_events (user_id, user_email, table_name, record_id, action, before, after)
  values (auth.uid(), (select email from public.members where user_id = auth.uid()), p_table, p_record, p_action, p_before, p_after)
$$;

-- ---------------------------------------------------------------------------
-- Triggers: new users, updated_at, numbering, audit of master data
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.members (user_id, email, full_name, role, active)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    case when exists (select 1 from public.members where role = 'admin') then null else 'admin'::public.member_role end,
    true
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger ledger_accounts_touch before update on public.ledger_accounts for each row execute function public.touch_updated_at();
create trigger parties_touch before update on public.parties for each row execute function public.touch_updated_at();
create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();
create trigger invoices_touch before update on public.invoices for each row execute function public.touch_updated_at();
create trigger company_settings_touch before update on public.company_settings for each row execute function public.touch_updated_at();

-- Project codes like CIV-P-0007 and invoice numbers like INV-2026-0001 are assigned automatically.
create or replace function public.assign_project_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_dept text;
begin
  if new.code is null or trim(new.code) = '' then
    select code into v_dept from public.departments where id = new.department_id;
    new.code := v_dept || '-P-' || lpad(public.next_number('PRJ-' || v_dept, 0)::text, 4, '0');
  end if;
  return new;
end $$;
create trigger projects_code before insert on public.projects for each row execute function public.assign_project_code();

create or replace function public.assign_invoice_number() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_prefix text := case when new.kind = 'quote' then 'QUO' else 'INV' end;
declare v_year int := extract(year from new.issue_date)::int;
begin
  if new.number is null or trim(new.number) = '' then
    new.number := v_prefix || '-' || v_year || '-' || lpad(public.next_number(v_prefix, v_year)::text, 4, '0');
  end if;
  return new;
end $$;
create trigger invoices_number before insert on public.invoices for each row execute function public.assign_invoice_number();

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_key text := tg_argv[0];
  v_before jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_after jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and v_before = v_after then return new; end if;
  perform public.write_audit(tg_table_name, coalesce(v_after, v_before) ->> v_key, lower(tg_op), v_before, v_after);
  return coalesce(new, old);
end $$;

create trigger audit_departments after insert or update or delete on public.departments for each row execute function public.audit_row('id');
create trigger audit_members after insert or update or delete on public.members for each row execute function public.audit_row('user_id');
create trigger audit_ledger_accounts after insert or update or delete on public.ledger_accounts for each row execute function public.audit_row('id');
create trigger audit_parties after insert or update or delete on public.parties for each row execute function public.audit_row('id');
create trigger audit_projects after insert or update or delete on public.projects for each row execute function public.audit_row('id');
create trigger audit_invoices after insert or update or delete on public.invoices for each row execute function public.audit_row('id');
create trigger audit_bills after insert or update or delete on public.bills for each row execute function public.audit_row('id');
create trigger audit_budgets after insert or update or delete on public.budgets for each row execute function public.audit_row('id');
create trigger audit_recurring after insert or update or delete on public.recurring_templates for each row execute function public.audit_row('id');
create trigger audit_rules after insert or update or delete on public.categorisation_rules for each row execute function public.audit_row('id');
create trigger audit_settings after insert or update or delete on public.company_settings for each row execute function public.audit_row('id');
create trigger audit_payroll_runs after insert or update or delete on public.payroll_runs for each row execute function public.audit_row('id');
create trigger audit_attachments after insert or delete on public.attachments for each row execute function public.audit_row('id');

-- ---------------------------------------------------------------------------
-- Posting
-- ---------------------------------------------------------------------------
create or replace function public.entry_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(e) || jsonb_build_object('lines', coalesce((select jsonb_agg(to_jsonb(l) order by l.line_no) from public.entry_lines l where l.entry_id = e.id), '[]'::jsonb))
  from public.entries e where e.id = p_id
$$;

create or replace function public.assert_can_post(p_department uuid, p_date date) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_locked date;
begin
  if public.auth_role() is null or public.auth_role() = 'viewer' then
    raise exception 'You do not have permission to record entries.' using errcode = '42501';
  end if;
  if not public.can_write_department(p_department) then
    raise exception 'You can only record entries for your own department.' using errcode = '42501';
  end if;
  select locked_through into v_locked from public.period_lock where id = 1;
  if v_locked is not null and p_date <= v_locked then
    raise exception 'The books are locked up to %. Choose a later date or ask an admin to unlock.', v_locked using errcode = 'P0001';
  end if;
end $$;

/* Lines of a posting request, numbered in the order given. */
create or replace function public.parse_lines(p_lines jsonb)
returns table (line_no int, account_id uuid, department_id uuid, project_id uuid, currency text, amount_minor bigint,
               fx_rate numeric, amount_lkr_minor bigint, memo text, role public.line_role)
language sql immutable as $$
  select x.ord::int, x.account_id, x.department_id, x.project_id, upper(x.currency), x.amount_minor, x.fx_rate, x.amount_lkr_minor, x.memo, x.role
  from rows from (jsonb_to_recordset(p_lines) as (account_id uuid, department_id uuid, project_id uuid, currency text, amount_minor bigint,
                                                  fx_rate numeric, amount_lkr_minor bigint, memo text, role public.line_role))
       with ordinality as x (account_id, department_id, project_id, currency, amount_minor, fx_rate, amount_lkr_minor, memo, role, ord)
$$;

/*
  post_entry(entry, lines, links) — create or replace an entry atomically.
  entry: {id?, kind, date, status, department_id, project_id, party_id, description, reference, channel,
          payment_method, invoice_id, bill_id, payroll_run_id, recurring_id, meta}
  lines: [{account_id, department_id, project_id, currency, amount_minor, fx_rate, amount_lkr_minor, memo, role}]
  links: {invoice_payments: [{invoice_id, amount_minor}], bill_payments: [{bill_id, amount_minor}]}
*/
create or replace function public.post_entry(p_entry jsonb, p_lines jsonb, p_links jsonb default '{}'::jsonb)
returns public.entries
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid := nullif(p_entry ->> 'id', '')::uuid;
  v_kind public.entry_kind := (p_entry ->> 'kind')::public.entry_kind;
  v_date date := (p_entry ->> 'date')::date;
  v_dept uuid := (p_entry ->> 'department_id')::uuid;
  v_status public.entry_status := coalesce(nullif(p_entry ->> 'status', ''), 'cleared')::public.entry_status;
  v_existing public.entries;
  v_before jsonb;
  v_result public.entries;
  v_count int;
  v_money int;
  v_sum bigint;
  v_problem text;
  v_prefix text;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Lines are missing.'; end if;
  if v_status = 'void' then raise exception 'Use void_entry to void an entry.'; end if;
  perform public.assert_can_post(v_dept, v_date);
  if v_kind = 'adjustment' and public.auth_role() not in ('admin', 'bookkeeper') then
    raise exception 'Only an admin or bookkeeper can post adjustments.' using errcode = '42501';
  end if;

  if v_id is not null then
    select * into v_existing from public.entries where id = v_id for update;
    if found then
      if v_existing.status = 'void' then raise exception 'A voided entry cannot be changed.'; end if;
      perform public.assert_can_post(v_existing.department_id, v_existing.date);
      if v_existing.kind <> v_kind then raise exception 'The type of an entry cannot be changed.'; end if;
      v_before := public.entry_snapshot(v_id);
    end if;
  end if;

  select count(*), coalesce(sum(amount_lkr_minor), 0) into v_count, v_sum from public.parse_lines(p_lines);
  if v_count < 2 then raise exception 'An entry needs at least two lines.'; end if;
  if v_sum <> 0 then raise exception 'The entry does not balance (difference % LKR).', v_sum / 100.0; end if;

  select string_agg(problem, ' ') into v_problem from (
    select distinct case
      when a.id is null then 'A line refers to an unknown account.'
      when d.id is null then 'A line has no valid department.'
      when l.amount_minor = 0 and l.amount_lkr_minor = 0 then format('Line for %s is zero.', a.name)
      when a.archived and v_existing.id is null then format('%s is archived.', a.name)
      when a.currency is not null and a.currency <> l.currency then format('%s is a %s account but the line is in %s.', a.name, a.currency, l.currency)
      when l.currency = 'LKR' and (l.fx_rate <> 1 or l.amount_lkr_minor <> l.amount_minor) then 'LKR lines must use a rate of 1.'
      when l.currency <> 'LKR' and abs(round(l.amount_minor * l.fx_rate * power(10::numeric, 2 - public.currency_decimals(l.currency))) - l.amount_lkr_minor) > 1
        then format('LKR amount for %s does not match its exchange rate.', a.name)
      when a.type in ('bank', 'platform', 'cash', 'card') and a.department_id <> l.department_id then format('%s belongs to another department.', a.name)
      when a.category_group = 'revenue' and not d.is_operating then format('Revenue can only be recorded for an operating department (not %s).', d.name)
      when a.category_group = 'payroll' and v_kind not in ('payroll', 'adjustment') then 'Salaries and employer contributions are recorded through Payroll only.'
      when v_kind = 'transfer' and a.type in ('income', 'expense') and l.role not in ('fee', 'fx') then 'A transfer cannot include income or expense lines (other than fees and exchange differences).'
      when v_kind = 'opening_balance' and a.type not in ('bank', 'platform', 'cash', 'card', 'equity') then 'Opening balances only use money and equity accounts.'
    end as problem
    from public.parse_lines(p_lines) l
    left join public.ledger_accounts a on a.id = l.account_id
    left join public.departments d on d.id = l.department_id
  ) p where problem is not null;
  if v_problem is not null then raise exception '%', v_problem; end if;

  -- Money may arrive in any department's account, but only leaves accounts you may write to,
  -- and income/cost lines must belong to departments you may write to.
  if exists (select 1 from public.parse_lines(p_lines) l join public.ledger_accounts a on a.id = l.account_id
             where a.type in ('bank', 'platform', 'cash', 'card') and l.amount_minor < 0 and not public.can_write_department(a.department_id)) then
    raise exception 'You can only pay from accounts of your own department.' using errcode = '42501';
  end if;
  if exists (select 1 from public.parse_lines(p_lines) l join public.ledger_accounts a on a.id = l.account_id
             where a.type not in ('bank', 'platform', 'cash', 'card') and not public.can_write_department(l.department_id)) then
    raise exception 'You can only record income and costs for your own department.' using errcode = '42501';
  end if;

  select count(*) into v_money from public.parse_lines(p_lines) l join public.ledger_accounts a on a.id = l.account_id
  where a.type in ('bank', 'platform', 'cash', 'card');
  if v_kind in ('income', 'expense', 'transfer', 'statutory_payment', 'opening_balance') and v_money = 0 then
    raise exception 'Choose the bank, platform or cash account.';
  end if;
  if v_kind = 'transfer' and v_money <> 2 then raise exception 'A transfer moves money between exactly two accounts.'; end if;

  if v_existing.id is null then
    v_prefix := case v_kind
      when 'income' then 'INC' when 'expense' then 'EXP' when 'transfer' then 'TRF' when 'payroll' then 'PAY'
      when 'statutory_payment' then 'STA' when 'opening_balance' then 'OPB' else 'ADJ' end;
    insert into public.entries (id, number, kind, date, status, department_id, project_id, party_id, description, reference, channel,
      payment_method, invoice_id, bill_id, payroll_run_id, recurring_id, meta, created_by, updated_by)
    values (
      coalesce(v_id, gen_random_uuid()),
      v_prefix || '-' || extract(year from v_date)::int || '-' || lpad(public.next_number(v_prefix, extract(year from v_date)::int)::text, 5, '0'),
      v_kind, v_date, v_status, v_dept,
      nullif(p_entry ->> 'project_id', '')::uuid, nullif(p_entry ->> 'party_id', '')::uuid,
      trim(p_entry ->> 'description'), nullif(trim(p_entry ->> 'reference'), ''), nullif(p_entry ->> 'channel', ''),
      nullif(p_entry ->> 'payment_method', ''), nullif(p_entry ->> 'invoice_id', '')::uuid, nullif(p_entry ->> 'bill_id', '')::uuid,
      nullif(p_entry ->> 'payroll_run_id', '')::uuid, nullif(p_entry ->> 'recurring_id', '')::uuid,
      coalesce(p_entry -> 'meta', '{}'::jsonb), auth.uid(), auth.uid())
    returning * into v_result;
  else
    update public.entries set
      date = v_date, status = v_status, department_id = v_dept,
      project_id = nullif(p_entry ->> 'project_id', '')::uuid, party_id = nullif(p_entry ->> 'party_id', '')::uuid,
      description = trim(p_entry ->> 'description'), reference = nullif(trim(p_entry ->> 'reference'), ''),
      channel = nullif(p_entry ->> 'channel', ''), payment_method = nullif(p_entry ->> 'payment_method', ''),
      invoice_id = nullif(p_entry ->> 'invoice_id', '')::uuid, bill_id = nullif(p_entry ->> 'bill_id', '')::uuid,
      meta = coalesce(p_entry -> 'meta', '{}'::jsonb), updated_by = auth.uid(), updated_at = now()
    where id = v_existing.id
    returning * into v_result;
    delete from public.entry_lines where entry_id = v_result.id;
    delete from public.invoice_payments where entry_id = v_result.id;
    delete from public.bill_payments where entry_id = v_result.id;
  end if;

  insert into public.entry_lines (entry_id, line_no, account_id, department_id, project_id, currency, amount_minor, fx_rate, amount_lkr_minor, memo, role)
  select v_result.id, line_no, account_id, department_id, project_id, currency, amount_minor, fx_rate, amount_lkr_minor, nullif(memo, ''), role
  from public.parse_lines(p_lines) order by line_no;

  insert into public.invoice_payments (invoice_id, entry_id, amount_minor)
  select x.invoice_id, v_result.id, x.amount_minor
  from jsonb_to_recordset(coalesce(p_links -> 'invoice_payments', '[]'::jsonb)) as x(invoice_id uuid, amount_minor bigint)
  where x.amount_minor > 0;
  insert into public.bill_payments (bill_id, entry_id, amount_minor)
  select x.bill_id, v_result.id, x.amount_minor
  from jsonb_to_recordset(coalesce(p_links -> 'bill_payments', '[]'::jsonb)) as x(bill_id uuid, amount_minor bigint)
  where x.amount_minor > 0;

  perform public.write_audit('entries', v_result.id::text, case when v_before is null then 'post' else 'update' end, v_before, public.entry_snapshot(v_result.id));
  return v_result;
end $$;

create or replace function public.void_entry(p_id uuid, p_reason text) returns public.entries
language plpgsql volatile security definer set search_path = public as $$
declare
  v_entry public.entries;
  v_before jsonb;
begin
  select * into v_entry from public.entries where id = p_id for update;
  if not found then raise exception 'Entry not found.'; end if;
  if v_entry.status = 'void' then raise exception 'This entry is already void.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for voiding.'; end if;
  perform public.assert_can_post(v_entry.department_id, v_entry.date);
  v_before := public.entry_snapshot(p_id);
  update public.entries set status = 'void', void_reason = trim(p_reason), voided_at = now(), voided_by = auth.uid(), updated_by = auth.uid(), updated_at = now()
  where id = p_id returning * into v_entry;
  update public.statement_lines set status = 'unmatched', matched_entry_id = null where matched_entry_id = p_id;
  update public.entry_lines set reconciled = false, reconciled_at = null, statement_line_id = null where entry_id = p_id;
  perform public.write_audit('entries', p_id::text, 'void', v_before, public.entry_snapshot(p_id));
  return v_entry;
end $$;

create or replace function public.set_entry_status(p_id uuid, p_status public.entry_status) returns public.entries
language plpgsql volatile security definer set search_path = public as $$
declare
  v_entry public.entries;
  v_before jsonb;
begin
  if p_status = 'void' then raise exception 'Use void_entry to void an entry.'; end if;
  select * into v_entry from public.entries where id = p_id for update;
  if not found then raise exception 'Entry not found.'; end if;
  if v_entry.status = 'void' then raise exception 'A voided entry cannot be changed.'; end if;
  perform public.assert_can_post(v_entry.department_id, v_entry.date);
  v_before := to_jsonb(v_entry);
  update public.entries set status = p_status, updated_by = auth.uid(), updated_at = now() where id = p_id returning * into v_entry;
  perform public.write_audit('entries', p_id::text, 'update', v_before, to_jsonb(v_entry));
  return v_entry;
end $$;

-- Tick lines as reconciled (optionally against a statement line). Does not change amounts,
-- so it is allowed in locked periods.
create or replace function public.reconcile_lines(p_line_ids uuid[], p_reconciled boolean, p_statement_line_id uuid default null, p_date date default current_date)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  v_count int;
  v_entry uuid;
begin
  if public.auth_role() is null or public.auth_role() = 'viewer' then
    raise exception 'You do not have permission to reconcile.' using errcode = '42501';
  end if;
  if exists (select 1 from public.entry_lines l where l.id = any (p_line_ids) and not public.can_write_department(l.department_id)) then
    raise exception 'You can only reconcile accounts of your own department.' using errcode = '42501';
  end if;
  update public.entry_lines set
    reconciled = p_reconciled,
    reconciled_at = case when p_reconciled then p_date end,
    statement_line_id = case when p_reconciled then p_statement_line_id end
  where id = any (p_line_ids);
  get diagnostics v_count = row_count;
  if p_statement_line_id is not null then
    select entry_id into v_entry from public.entry_lines where id = p_line_ids[1];
    update public.statement_lines set status = case when p_reconciled then 'matched'::public.statement_line_status else 'unmatched' end,
      matched_entry_id = case when p_reconciled then v_entry end
    where id = p_statement_line_id;
  end if;
  return v_count;
end $$;

create or replace function public.complete_reconciliation(p_account_id uuid, p_date date) returns void
language plpgsql volatile security definer set search_path = public as $$
declare v_dept uuid;
begin
  select department_id into v_dept from public.ledger_accounts where id = p_account_id;
  if public.auth_role() is null or public.auth_role() = 'viewer' or not public.can_write_department(v_dept) then
    raise exception 'You do not have permission to reconcile this account.' using errcode = '42501';
  end if;
  update public.ledger_accounts set last_reconciled_date = p_date where id = p_account_id;
end $$;

create or replace function public.set_member(p_user_id uuid, p_role public.member_role, p_department_id uuid, p_active boolean)
returns public.members language plpgsql volatile security definer set search_path = public as $$
declare v_member public.members;
begin
  if not public.is_admin() then raise exception 'Only an admin can change users.' using errcode = '42501'; end if;
  if p_role = 'director' and p_department_id is null then raise exception 'A director needs a department.'; end if;
  if (p_role is distinct from 'admin' or not p_active)
     and exists (select 1 from public.members where user_id = p_user_id and role = 'admin' and active)
     and (select count(*) from public.members where role = 'admin' and active) = 1 then
    raise exception 'There must be at least one active admin.';
  end if;
  update public.members set role = p_role, department_id = case when p_role = 'director' then p_department_id else null end, active = p_active
  where user_id = p_user_id returning * into v_member;
  if not found then raise exception 'User not found.'; end if;
  return v_member;
end $$;

create or replace function public.set_period_lock(p_date date) returns public.period_lock
language plpgsql volatile security definer set search_path = public as $$
declare
  v_before public.period_lock;
  v_after public.period_lock;
begin
  if not public.is_admin() then raise exception 'Only an admin can lock or unlock the books.' using errcode = '42501'; end if;
  select * into v_before from public.period_lock where id = 1;
  insert into public.period_lock (id, locked_through, updated_by, updated_at) values (1, p_date, auth.uid(), now())
  on conflict (id) do update set locked_through = excluded.locked_through, updated_by = excluded.updated_by, updated_at = now()
  returning * into v_after;
  perform public.write_audit('period_lock', '1', 'update', to_jsonb(v_before), to_jsonb(v_after));
  return v_after;
end $$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.company_settings enable row level security;
alter table public.departments enable row level security;
alter table public.members enable row level security;
alter table public.ledger_accounts enable row level security;
alter table public.parties enable row level security;
alter table public.projects enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.invoice_payments enable row level security;
alter table public.bills enable row level security;
alter table public.bill_payments enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payslips enable row level security;
alter table public.recurring_templates enable row level security;
alter table public.entries enable row level security;
alter table public.entry_lines enable row level security;
alter table public.statement_imports enable row level security;
alter table public.statement_lines enable row level security;
alter table public.budgets enable row level security;
alter table public.categorisation_rules enable row level security;
alter table public.attachments enable row level security;
alter table public.fx_rates enable row level security;
alter table public.period_lock enable row level security;
alter table public.number_sequences enable row level security;
alter table public.audit_events enable row level security;

-- Everyone approved can read everything (company view).
do $$
declare t text;
begin
  foreach t in array array['company_settings', 'departments', 'ledger_accounts', 'parties', 'projects', 'invoices', 'invoice_items',
    'invoice_payments', 'bills', 'bill_payments', 'payroll_runs', 'payslips', 'recurring_templates', 'entries', 'entry_lines',
    'statement_imports', 'statement_lines', 'budgets', 'categorisation_rules', 'attachments', 'fx_rates', 'period_lock', 'audit_events']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member())', t || '_read', t);
  end loop;
end $$;

-- Members: you can always see your own row (to know you are waiting for approval).
create policy members_read on public.members for select to authenticated using (user_id = auth.uid() or public.is_member());

create policy settings_write on public.company_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy departments_insert on public.departments for insert to authenticated with check (public.is_admin());
create policy departments_update on public.departments for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy accounts_insert on public.ledger_accounts for insert to authenticated
  with check (public.auth_role() in ('admin', 'bookkeeper')
    or (public.auth_role() = 'director' and type in ('bank', 'platform', 'cash', 'card') and public.can_write_department(department_id)));
create policy accounts_update on public.ledger_accounts for update to authenticated
  using (public.auth_role() in ('admin', 'bookkeeper')
    or (public.auth_role() = 'director' and type in ('bank', 'platform', 'cash', 'card') and public.can_write_department(department_id)))
  with check (public.auth_role() in ('admin', 'bookkeeper')
    or (public.auth_role() = 'director' and type in ('bank', 'platform', 'cash', 'card') and public.can_write_department(department_id)));

create policy parties_insert on public.parties for insert to authenticated with check (public.can_edit_master());
create policy parties_update on public.parties for update to authenticated using (public.can_edit_master()) with check (public.can_edit_master());

create policy projects_insert on public.projects for insert to authenticated with check (public.can_edit_master() and public.can_write_department(department_id));
create policy projects_update on public.projects for update to authenticated
  using (public.can_edit_master() and public.can_write_department(department_id))
  with check (public.can_edit_master() and public.can_write_department(department_id));

create policy invoices_insert on public.invoices for insert to authenticated with check (public.can_write_department(department_id));
create policy invoices_update on public.invoices for update to authenticated using (public.can_write_department(department_id)) with check (public.can_write_department(department_id));
create policy invoices_delete on public.invoices for delete to authenticated using (public.can_write_department(department_id) and status = 'draft');
create policy invoice_items_write on public.invoice_items for all to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and public.can_write_department(i.department_id)))
  with check (exists (select 1 from public.invoices i where i.id = invoice_id and public.can_write_department(i.department_id)));

create policy bills_insert on public.bills for insert to authenticated with check (public.can_write_department(department_id));
create policy bills_update on public.bills for update to authenticated using (public.can_write_department(department_id)) with check (public.can_write_department(department_id));

create policy payroll_runs_write on public.payroll_runs for all to authenticated
  using (public.auth_role() in ('admin', 'bookkeeper', 'director')) with check (public.auth_role() in ('admin', 'bookkeeper', 'director'));
create policy payslips_write on public.payslips for all to authenticated
  using (public.can_write_department(department_id)) with check (public.can_write_department(department_id));

create policy recurring_write on public.recurring_templates for all to authenticated
  using (public.can_write_department(department_id)) with check (public.can_write_department(department_id));
create policy budgets_write on public.budgets for all to authenticated
  using (public.can_write_department(department_id)) with check (public.can_write_department(department_id));
create policy rules_write on public.categorisation_rules for all to authenticated
  using (public.can_edit_master()) with check (public.can_edit_master());

create policy statement_imports_insert on public.statement_imports for insert to authenticated
  with check (public.can_write_department((select department_id from public.ledger_accounts a where a.id = account_id)));
create policy statement_lines_write on public.statement_lines for all to authenticated
  using (public.can_write_department((select department_id from public.ledger_accounts a where a.id = account_id)))
  with check (public.can_write_department((select department_id from public.ledger_accounts a where a.id = account_id)));

create policy attachments_insert on public.attachments for insert to authenticated
  with check (public.auth_role() in ('admin', 'bookkeeper', 'director'));
create policy attachments_delete on public.attachments for delete to authenticated
  using (public.is_admin() or created_by = auth.uid());

create policy fx_rates_insert on public.fx_rates for insert to authenticated with check (public.auth_role() in ('admin', 'bookkeeper', 'director'));
create policy fx_rates_update on public.fx_rates for update to authenticated
  using (public.auth_role() in ('admin', 'bookkeeper', 'director')) with check (public.auth_role() in ('admin', 'bookkeeper', 'director'));

-- entries, entry_lines, invoice_payments, bill_payments, period_lock, number_sequences and audit_events
-- have no write policies: they change only through the security-definer functions above.

-- ---------------------------------------------------------------------------
-- Grants (Supabase grants table access to `authenticated`; RLS decides rows)
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.post_entry(jsonb, jsonb, jsonb), public.void_entry(uuid, text), public.set_entry_status(uuid, public.entry_status),
  public.reconcile_lines(uuid[], boolean, uuid, date), public.complete_reconciliation(uuid, date), public.set_member(uuid, public.member_role, uuid, boolean),
  public.set_period_lock(date), public.auth_role(), public.is_member(), public.is_admin(), public.can_edit_master(), public.can_write_department(uuid),
  public.currency_decimals(text)
  to authenticated;

-- ============================================================================
-- 20261001000300_seed.sql
-- ============================================================================

-- AptoCAD Finance — default data (generated from src/domain/defaults.ts; do not edit by hand)

insert into public.departments (code, name, is_operating, director_name, color, sort_order) values
  ('CIV', 'Civil', true, 'Thilina', '#2a78d6', 1),
  ('MEC', 'Mechanical', true, 'Ishara Deshapriya', '#eb6834', 2),
  ('CORP', 'Corporate / Shared', false, null, '#1baf7a', 3)
on conflict (code) do nothing;

insert into public.ledger_accounts (code, name, type, currency, category_group, system_key) values
  ('4010', 'Permit / Construction Drawings', 'income', null, 'revenue', null),
  ('4020', 'Civil / Structural Engineering Services', 'income', null, 'revenue', null),
  ('4030', 'Mechanical Engineering Services', 'income', null, 'revenue', null),
  ('4040', 'Plan Check Revisions', 'income', null, 'revenue', null),
  ('4050', 'CAD / Revit Drafting', 'income', null, 'revenue', null),
  ('4060', 'Consulting / Other Services', 'income', null, 'revenue', null),
  ('4070', 'Performance Bonus', 'income', null, 'revenue', null),
  ('4910', 'Interest Income', 'income', null, 'other_income', null),
  ('4990', 'Other Income', 'income', null, 'other_income', null),
  ('5010', 'PE / EOR Review & Stamp', 'expense', null, 'direct_cost', null),
  ('5020', 'Subcontract Drafting', 'expense', null, 'direct_cost', null),
  ('5030', 'Engineering Calculation Support', 'expense', null, 'direct_cost', null),
  ('5040', 'Survey / Civil / Other Consultant', 'expense', null, 'direct_cost', null),
  ('5050', 'Project Permit / Submission Cost', 'expense', null, 'direct_cost', null),
  ('6010', 'Software & Subscriptions', 'expense', null, 'operating', null),
  ('6020', 'Internet & Phone', 'expense', null, 'operating', null),
  ('6030', 'Upwork / Platform Fees', 'expense', null, 'operating', 'platform_fees'),
  ('6040', 'Bank / FX / Transfer Fees', 'expense', null, 'operating', 'bank_fees'),
  ('6045', 'Exchange Gain / Loss', 'expense', null, 'operating', 'fx_difference'),
  ('6050', 'Advertising & Marketing', 'expense', null, 'operating', null),
  ('6060', 'Recruitment', 'expense', null, 'operating', null),
  ('6070', 'Professional Memberships', 'expense', null, 'operating', null),
  ('6080', 'Accounting / Legal / Corporate', 'expense', null, 'operating', null),
  ('6090', 'Office & Administration', 'expense', null, 'operating', null),
  ('6100', 'Equipment / Computers', 'expense', null, 'operating', null),
  ('6110', 'Training / Education', 'expense', null, 'operating', null),
  ('6120', 'Travel / Transport', 'expense', null, 'operating', null),
  ('6130', 'Taxes & Government Fees', 'expense', null, 'operating', null),
  ('6140', 'Utilities', 'expense', null, 'operating', null),
  ('6990', 'Other Operating Expense', 'expense', null, 'operating', null),
  ('7010', 'Salaries & Wages', 'expense', null, 'payroll', 'salaries'),
  ('7020', 'Employer EPF (12%)', 'expense', null, 'payroll', 'employer_epf'),
  ('7030', 'Employer ETF (3%)', 'expense', null, 'payroll', 'employer_etf'),
  ('8010', 'Income Tax Expense', 'expense', null, 'income_tax', 'income_tax_expense'),
  ('2110', 'EPF Payable', 'liability', 'LKR', null, 'epf_payable'),
  ('2120', 'ETF Payable', 'liability', 'LKR', null, 'etf_payable'),
  ('2130', 'APIT Payable', 'liability', 'LKR', null, 'apit_payable'),
  ('2140', 'Other Payroll Deductions Payable', 'liability', 'LKR', null, 'other_deductions_payable'),
  ('3010', 'Opening Balance Equity', 'equity', 'LKR', null, 'opening_equity')
on conflict (code) do nothing;

insert into public.company_settings (id, data) values
  (1, '{
  "company_name": "AptoCAD Engineering",
  "base_currency": "LKR",
  "fy_start_month": 4,
  "address": null,
  "tax_id": null,
  "invoice_footer": "Thank you for your business.",
  "currencies": [
    "LKR",
    "USD",
    "CAD",
    "GBP",
    "EUR",
    "AUD"
  ],
  "payroll": {
    "employee_epf_pct": 8,
    "employer_epf_pct": 12,
    "employer_etf_pct": 3,
    "apit_monthly_relief_minor": 15000000,
    "apit_bands": [
      {
        "width_minor": 8333333,
        "rate_pct": 6
      },
      {
        "width_minor": 4166667,
        "rate_pct": 18
      },
      {
        "width_minor": 4166667,
        "rate_pct": 24
      },
      {
        "width_minor": 4166667,
        "rate_pct": 30
      },
      {
        "width_minor": null,
        "rate_pct": 36
      }
    ]
  },
  "tax": {
    "income_tax_pct": 15,
    "sscl_pct": 2.5,
    "sscl_thresholds": [
      {
        "effective_from": "2000-01-01",
        "quarterly_minor": 1500000000,
        "annual_minor": 6000000000
      },
      {
        "effective_from": "2026-07-01",
        "quarterly_minor": 900000000,
        "annual_minor": 3600000000
      }
    ],
    "vat_pct": 18,
    "vat_thresholds": [
      {
        "effective_from": "2000-01-01",
        "quarterly_minor": 1500000000,
        "annual_minor": 6000000000
      }
    ]
  },
  "allocation": {
    "method": "none",
    "fixed_pct": {}
  },
  "attention": {
    "receipt_required_above_minor": 500000,
    "reconcile_after_days": 31
  },
  "lists": {
    "channels": [
      "Upwork",
      "Direct Client",
      "Referral / Partner",
      "Other"
    ],
    "payment_methods": [
      "Bank Transfer",
      "Upwork Payout",
      "Payoneer",
      "Card",
      "Cash",
      "Other"
    ],
    "pricing_types": [
      "Fixed Price",
      "Hourly",
      "Milestone",
      "Retainer"
    ]
  }
}'::jsonb)
on conflict (id) do nothing;

insert into public.period_lock (id, locked_through) values (1, null)
on conflict (id) do nothing;

-- ============================================================================
-- 20261001000400_storage.sql
-- ============================================================================

-- AptoCAD Finance — private storage bucket for receipts, invoices and bills.
insert into storage.buckets (id, name, public) values ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy "attachments_read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.is_member());

create policy "attachments_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.auth_role() in ('admin', 'bookkeeper', 'director'));

create policy "attachments_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (public.is_admin() or owner_id = auth.uid()::text));

-- ============================================================================
-- 20261001000500_realtime.sql
-- ============================================================================

-- Live updates: when one director posts an entry, the other director's app refreshes.
-- Only runs where Supabase Realtime exists (skipped on plain Postgres test databases).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.entries, public.invoices, public.bills, public.projects, public.parties,
      public.ledger_accounts, public.members, public.company_settings, public.period_lock,
      public.payroll_runs, public.budgets, public.recurring_templates, public.statement_lines;
  end if;
end $$;
