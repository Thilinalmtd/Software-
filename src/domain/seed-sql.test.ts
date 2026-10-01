import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { seedSql } from './seed-sql';

const file = fileURLToPath(new URL('../../supabase/migrations/20261001000300_seed.sql', import.meta.url));

describe('database seed', () => {
  it('matches the TypeScript defaults', () => {
    const expected = seedSql();
    if (process.env.UPDATE_SEED) writeFileSync(file, expected);
    expect(readFileSync(file, 'utf8')).toBe(expected);
  });
});

const migrations = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const bundle = fileURLToPath(new URL('../../supabase/setup.sql', import.meta.url));

/** One file to paste into the Supabase SQL editor: all migrations in order. */
export function bundleSql(): string {
  const parts = readdirSync(migrations)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => `-- ============================================================================\n-- ${f}\n-- ============================================================================\n\n${readFileSync(migrations + f, 'utf8').trim()}\n`);
  return `-- AptoCAD Finance — complete database setup (generated; do not edit by hand).\n-- Paste into Supabase → SQL Editor → New query → Run, once, on a new project.\n-- See docs/SETUP.md.\n\n${parts.join('\n')}`;
}

describe('database setup bundle', () => {
  it('contains every migration in order', () => {
    const expected = bundleSql();
    if (process.env.UPDATE_SEED) writeFileSync(bundle, expected);
    expect(readFileSync(bundle, 'utf8')).toBe(expected);
  });
});
