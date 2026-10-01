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
