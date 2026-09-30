import { readFileSync, writeFileSync } from 'node:fs';
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
