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
