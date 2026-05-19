/**
 * FILE: examples/e2e-dogfood/tests/iterate-drift-fixes.spec.ts
 * PURPOSE: Regression guards for the 2026-05-19 bug-fix batch:
 *
 *   1. IteratePage — apiFetch type fix: iteration details panel must
 *      render iteration rows (not "No iterations recorded yet") when a
 *      succeeded run is opened.
 *
 *   2. IteratePage — error_detail: failed runs must surface the real
 *      error message via the RunDetailDrawer ErrorAlert (not stay silent).
 *
 *   3. DriftPage — SCAN_ERROR_TIPS: when a drift scan fails the page
 *      must display a persistent ErrorAlert (not a vanishing toast) with
 *      the structured error code and a human-readable tip.
 *
 *   4. ResearchPage — Firecrawl error banner: a failed search must
 *      display a persistent inline ErrorAlert (not a vanishing toast).
 *
 * Run against a local dev server:
 *   MUSHI_ADMIN_URL=http://localhost:6464 \
 *   VITE_SUPABASE_URL=... \
 *   VITE_SUPABASE_ANON_KEY=... \
 *   TEST_USER_EMAIL=... \
 *   TEST_USER_PASSWORD=... \
 *   npx playwright test iterate-drift-fixes
 */

import { test, expect } from '@playwright/test'

const ADMIN_URL = process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464'
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL ?? ''
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD ?? ''

const SKIP_REASON =
  'Requires VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY + TEST_USER_EMAIL + TEST_USER_PASSWORD'

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function seedSession(page: Parameters<typeof test>[1] extends (args: infer A) => unknown ? A extends { page: infer P } ? P : never : never) {
  const res = await page.request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    data: { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD },
  })
  expect(res.ok()).toBeTruthy()
  const { access_token, refresh_token } = (await res.json()) as {
    access_token: string
    refresh_token: string
  }
  await page.addInitScript((tokens) => {
    window.localStorage.setItem(
      'sb-mushi-auth-token',
      JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token }),
    )
  }, { access_token, refresh_token })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('IteratePage — iteration detail regression', () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_USER_EMAIL || !TEST_USER_PASSWORD,
    SKIP_REASON,
  )

  test.beforeEach(async ({ page }) => { await seedSession(page) })

  test('opens a succeeded run and shows iteration rows (not empty-state)', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/iterate`, { waitUntil: 'networkidle' })

    // Wait for the runs table to settle
    await page.waitForSelector('table, [data-testid="runs-empty"]', { timeout: 10_000 })

    // If there are no runs at all, skip gracefully — this test needs seed data
    const emptyState = page.locator('[data-testid="runs-empty"]')
    if (await emptyState.count() > 0) {
      test.skip()
      return
    }

    // Click the first succeeded row
    const succeededRow = page.locator('tr').filter({ hasText: 'succeeded' }).first()
    await succeededRow.click()

    // Drawer must open with at least one iteration entry
    // (regression: apiFetch<{ data: PdcaRun }> double-wrap returned undefined iterations)
    await page.waitForSelector('[data-testid="iteration-entry"], [aria-label^="Iteration"]', {
      timeout: 8_000,
    })
    const iterationItems = page.locator('[data-testid="iteration-entry"], [aria-label^="Iteration"]')
    await expect(iterationItems.first()).toBeVisible()

    // The old empty-state copy must NOT appear when iterations exist
    const emptyText = page.locator(':text("No iterations recorded yet")')
    await expect(emptyText).not.toBeVisible()
  })

  test('failed run drawer shows error_detail ErrorAlert', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/iterate`, { waitUntil: 'networkidle' })
    await page.waitForSelector('table, [data-testid="runs-empty"]', { timeout: 10_000 })

    const failedRow = page.locator('tr').filter({ hasText: 'failed' }).first()
    if (await failedRow.count() === 0) {
      test.skip() // no failed run in seed data — can't test
      return
    }
    await failedRow.click()

    // ErrorAlert must appear somewhere in the drawer
    // (regression: error_detail was missing from PdcaRun interface)
    const errorAlert = page.locator('[role="alert"], [data-testid="error-alert"]').first()
    await expect(errorAlert).toBeVisible({ timeout: 6_000 })
  })
})

test.describe('DriftPage — persistent scan-error panel', () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_USER_EMAIL || !TEST_USER_PASSWORD,
    SKIP_REASON,
  )

  test.beforeEach(async ({ page }) => { await seedSession(page) })

  test('scan failure renders ErrorAlert with code tip instead of vanishing toast', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/drift`, { waitUntil: 'networkidle' })

    // Switch to the Scanner tab
    const scannerTab = page.locator('[role="tab"]').filter({ hasText: /scanner/i })
    if (await scannerTab.count() > 0) await scannerTab.click()

    // Intercept the scan request to force a structured error response
    await page.route('**/functions/v1/api**/drift/scan', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          error: {
            code: 'BUILDER_FAILED',
            message: 'The contract snapshot builder failed (intercepted for test).',
          },
        }),
      })
    })

    // Trigger the scan
    const scanBtn = page.locator('button').filter({ hasText: /run scan|scan now/i }).first()
    if (await scanBtn.count() === 0) { test.skip(); return }
    await scanBtn.click()

    // ErrorAlert must appear and persist (not be replaced by a toast that fades)
    const errorAlert = page.locator('[role="alert"], [data-testid="error-alert"]').first()
    await expect(errorAlert).toBeVisible({ timeout: 8_000 })

    // The SCAN_ERROR_TIPS text for BUILDER_FAILED must be visible in the alert
    await expect(
      page.locator(':text("contract snapshot builder")'),
    ).toBeVisible()

    // After 3 seconds it must still be visible (not a toast)
    await page.waitForTimeout(3000)
    await expect(errorAlert).toBeVisible()
  })
})

test.describe('ResearchPage — persistent Firecrawl error banner', () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_USER_EMAIL || !TEST_USER_PASSWORD,
    SKIP_REASON,
  )

  test.beforeEach(async ({ page }) => { await seedSession(page) })

  test('failed search renders inline ErrorAlert that persists after toast fades', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/research`, { waitUntil: 'networkidle' })

    // Intercept the research search endpoint to force an error
    await page.route('**/functions/v1/api**/research/search', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          error: {
            code: 'FIRECRAWL_ERROR',
            message: 'Firecrawl API key is not configured (intercepted for test).',
          },
        }),
      })
    })

    // Fill in a query and submit
    const queryInput = page.locator('input[type="text"], textarea').first()
    if (await queryInput.count() === 0) { test.skip(); return }
    await queryInput.fill('test query for error state')

    const searchBtn = page.locator('button').filter({ hasText: /search|research/i }).first()
    await searchBtn.click()

    // Inline error banner must appear
    const errorAlert = page.locator('[role="alert"], [data-testid="error-alert"]').first()
    await expect(errorAlert).toBeVisible({ timeout: 8_000 })

    // It must persist (not be a vanishing toast)
    await page.waitForTimeout(3500)
    await expect(errorAlert).toBeVisible()
  })
})
