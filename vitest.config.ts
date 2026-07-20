import { defineConfig } from 'vitest/config';

// The Playwright a11y specs under e2e/ use @playwright/test, not vitest, and
// must run via `npm run test:a11y`. Restrict the unit run to colocated
// src/**/*.test.ts so those specs are never collected here.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
