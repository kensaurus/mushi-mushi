import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for the Mushi Mushi full-PDCA dogfood suite.
 *
 * Why it lives in examples/: the tests exercise the public SDK surface
 * (`@mushi-mushi/web` + `@mushi-mushi/web/test-utils`) the same way a
 * customer integration would, then validate the resulting admin console
 * behaviour. It's the closest thing to a "customer ships our SDK to prod"
 * test we can run in CI without a real tenant.
 *
 * Environment knobs:
 *   - MUSHI_DOGFOOD_URL (default http://localhost:3000)
 *       URL of the dogfood app (glot.it). Set to a preview URL in CI for
 *       deploy-verify mode; leave unset for local dev.
 *   - MUSHI_ADMIN_URL (default http://localhost:6464)
 *       Mushi Mushi admin console.
 *   - E2E_LIVE_GITHUB=1
 *       Unset = msw mocks the GitHub REST surface so Act stage runs
 *       hermetically. Set = real GitHub calls (requires GITHUB_TOKEN +
 *       a sacrificial repo — see tests/README.md).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // pipeline stages depend on each other
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ...(process.env.CI ? [['github'] as const] : []),
  ],
  use: {
    baseURL: process.env.MUSHI_DOGFOOD_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // We intentionally do NOT declare `webServer` here — the suite assumes
  // the operator has `supabase start`, `pnpm --filter @mushi-mushi/admin
  // dev`, and the dogfood app already running. Spinning them all up from
  // Playwright makes CI fragile because dev-server cold-start times
  // (Next.js + Vite) balloon past the 60s timeout.
})
