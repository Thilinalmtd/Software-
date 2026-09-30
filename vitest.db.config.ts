import { defineConfig } from 'vitest/config';

// Database tests run against a real Postgres (DATABASE_URL) with the Supabase migrations applied.
export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    fileParallelism: false,
  },
});
