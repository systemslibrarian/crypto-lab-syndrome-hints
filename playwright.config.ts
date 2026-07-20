import { defineConfig, devices } from '@playwright/test';

/**
 * Strict a11y (axe-core) gate. Serves the production build via `vite preview`
 * on a unique port (4327 — chosen not to collide with any sibling lab's
 * playwright.config.ts), then scans both themes with WCAG 2.0/2.1 A + AA rules.
 * The base path must match vite.config.ts (`/crypto-lab-syndrome-hints/`).
 */
const PORT = 4327;
const BASE = '/crypto-lab-syndrome-hints/';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}${BASE}`,
    colorScheme: 'dark',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${BASE}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
