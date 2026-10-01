import { DEFAULT_CHART, DEFAULT_DEPARTMENTS, DEFAULT_SETTINGS } from './defaults';

// Generates supabase/migrations/*_seed.sql from the TypeScript defaults so both stay in sync.
// Regenerate with:  UPDATE_SEED=1 npx vitest run src/domain/seed-sql.test.ts

const q = (v: string | null | undefined) => (v === null || v === undefined ? 'null' : `'${v.replace(/'/g, "''")}'`);

export function seedSql(): string {
  const depts = DEFAULT_DEPARTMENTS.map(
    (d) => `  (${q(d.code)}, ${q(d.name)}, ${d.is_operating}, ${q(d.director_name)}, ${q(d.color)}, ${d.sort_order})`,
  ).join(',\n');
  const accounts = DEFAULT_CHART.map(
    (a) => `  (${q(a.code)}, ${q(a.name)}, '${a.type}', ${q(a.currency)}, ${a.category_group ? `'${a.category_group}'` : 'null'}, ${q(a.system_key)})`,
  ).join(',\n');
  return `-- AptoCAD Finance — default data (generated from src/domain/defaults.ts; do not edit by hand)

insert into public.departments (code, name, is_operating, director_name, color, sort_order) values
${depts}
on conflict (code) do nothing;

insert into public.ledger_accounts (code, name, type, currency, category_group, system_key) values
${accounts}
on conflict (code) do nothing;

insert into public.company_settings (id, data) values
  (1, ${q(JSON.stringify(DEFAULT_SETTINGS, null, 2))}::jsonb)
on conflict (id) do nothing;

insert into public.period_lock (id, locked_through) values (1, null)
on conflict (id) do nothing;
`;
}
