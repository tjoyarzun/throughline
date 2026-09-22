import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests. Separate from the Vitest suites, which are unit and
 * database tests — this is the only place a real browser is involved, and the
 * only place layout bugs are visible at all.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // Retries mask the races this app is most likely to have.
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    colorScheme: 'dark',
  },
  projects: [
    // Writes the session cookie and the fixture rows the accessibility suite
    // needs. A dependency rather than a global setup so its failures are
    // reported as a failing test rather than a runner crash.
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
    { name: 'iphone', use: { ...devices['iPhone 14 Pro'] }, dependencies: ['setup'] },
  ],
  // Spread rather than `webServer: undefined` — exactOptionalPropertyTypes
  // distinguishes "absent" from "explicitly undefined", and Playwright's type
  // only accepts absent. Set E2E_BASE_URL to run against a deployed URL.
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: 'pnpm dev',
          url: 'http://localhost:3000/auth/signin',
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }),
});
