import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: { __APP_VERSION__: JSON.stringify('test') },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
