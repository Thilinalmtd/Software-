# Development

## Stack

| Layer | Choice |
|---|---|
| Desktop shell | Tauri 2 (Rust) — `src-tauri/` |
| UI | React 19, TypeScript, Vite, Tailwind CSS 4, Radix primitives, cmdk, ECharts, sonner |
| Data | Supabase (Postgres + Auth + Storage + Realtime) via `@supabase/supabase-js`; demo mode in-browser |
| Money | integer minor units + decimal.js; balanced double-entry lines |
| Files | ExcelJS (import/export), @react-pdf/renderer (payslips, invoices, reports), PapaParse (CSV) |
| Tests | Vitest (domain + data), Vitest on Postgres 16 (schema/RLS), Playwright (UI) |

## Layout

```
src/
  domain/     pure TypeScript: money, periods, posting builders + validation, payroll, reports, statements
  data/       repository interface, Supabase + demo implementations, hooks, FX rates, workbook import
  components/ UI kit (button, form, dialog, table, combobox, chart)
  features/   screens (dashboard, entries, accounts, projects, payroll, invoices, bills, budgets, …)
  app/        shell, routing, view state
supabase/
  migrations/ schema, security & posting functions, seed (generated), storage, realtime
  setup.sql   all migrations in one file (generated)
  tests/      database integration tests + local Supabase stubs
e2e/          Playwright tests (demo mode)
src-tauri/    Windows shell, icons, capabilities
```

The domain layer never touches the network or React. Posting rules exist twice on purpose: in
`src/domain/posting.ts` (instant feedback, demo mode) and in `post_entry()` (authoritative, cannot be bypassed).

## Commands

```bash
npm install
npm run dev            # browser at http://localhost:1420 (use "Try the demo")
npm run tauri dev      # desktop window (needs Rust; on Linux also webkit2gtk)
npm run typecheck
npm test               # unit tests
npm run test:db        # database tests; needs DATABASE_URL to a Postgres 16 you can create databases on
npm run test:e2e       # Playwright; PW_CHROMIUM_PATH can point at an installed Chromium
npm run build          # production web build (dist/)
npx tauri build        # Windows installer (on Windows)
```

Local Postgres for `test:db` (Linux example):

```bash
initdb -D /tmp/pg -A trust -U postgres && pg_ctl -D /tmp/pg -o "-p 54329" start
DATABASE_URL=postgres://postgres@localhost:54329/postgres npm run test:db
```

## Changing the database

1. Add a new file in `supabase/migrations/` (timestamped, never edit an applied one).
2. If defaults change, edit `src/domain/defaults.ts`.
3. Regenerate generated SQL: `UPDATE_SEED=1 npx vitest run src/domain/seed-sql.test.ts`
   (updates the seed migration and `supabase/setup.sql`; the test fails if they drift).
4. Add a test to `supabase/tests/db.test.ts`.

## Design notes

- Colours are CSS variables in `src/index.css` (light + dark). Chart series use a validated
  colour-blind-safe categorical palette; department colours follow slots 1–3.
- Every money amount is formatted with `formatMoney`; never format floats directly.
- Numbers are tabular in tables (`.tabular`), proportional in headline tiles.

## CI / release

- `.github/workflows/ci.yml` — typecheck + unit tests + build, database tests (Postgres service),
  Playwright, and a Windows installer artifact.
- `.github/workflows/release.yml` — on a `v*` tag, builds with tauri-action and creates a draft release;
  enables the updater when signing secrets are configured (see docs/SETUP.md §6).
