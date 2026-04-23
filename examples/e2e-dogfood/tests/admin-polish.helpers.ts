/**
 * Shared helpers for the admin-console UIUX polish suite
 * (`byok-no-flash`, `dynamic-title`, `favicon-badge`).
 *
 * These tests drive the browser against the Mushi Mushi admin UI, so we
 * need an authenticated session. The suite prefers email/password login
 * through the admin's own UI — that means we exercise the same Supabase
 * auth plumbing a real operator does, and we don't have to know the
 * shape of the localStorage key Supabase Auth writes.
 *
 * Required env to run these specs:
 *   - MUSHI_ADMIN_URL   (default http://localhost:6464)
 *   - MUSHI_ADMIN_EMAIL
 *   - MUSHI_ADMIN_PASSWORD
 *
 * If any credential is missing, the spec's `beforeAll` sets a skip via
 * `shouldSkipAdminUi()` and the tests are marked as skipped, not failed.
 */

import type { Page, Route } from '@playwright/test'

export const ADMIN_URL = (process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464').replace(/\/$/, '')

/**
 * CORS headers the admin API would normally send. Stubbed responses must
 * include these because the admin runs on `localhost:6464` and the API
 * lives on `*.supabase.co`, so every mocked request is cross-origin.
 * Without the headers, Chromium aborts the fetch and the UI shows
 * "Failed to load BYOK status: Request failed".
 */
export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-max-age': '86400',
}

/**
 * Fulfill an OPTIONS preflight with a 204 so the browser lets the real
 * request through. Use inside a `page.route()` handler before any
 * method-specific branching.
 */
export async function handlePreflight(route: Route): Promise<boolean> {
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' })
    return true
  }
  return false
}
export const ADMIN_EMAIL = process.env.MUSHI_ADMIN_EMAIL ?? ''
export const ADMIN_PASSWORD = process.env.MUSHI_ADMIN_PASSWORD ?? ''

/** Single reason string fed to `test.skip()` so operators know what to set. */
export function shouldSkipAdminUi(): string | null {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    return 'MUSHI_ADMIN_EMAIL + MUSHI_ADMIN_PASSWORD required to log into the admin UI'
  }
  return null
}

/**
 * Log the test browser into the admin console by driving the login
 * form — same path a real user takes. Idempotent: if the session is
 * already live (no login form on screen) it returns immediately.
 *
 * We detect the login state by presence of the email textbox rather
 * than URL, because the admin renders the login form inline at `/`
 * when no session exists (no client-side redirect to `/login`).
 */
export async function loginToAdmin(page: Page): Promise<void> {
  await page.goto(`${ADMIN_URL}/`, { waitUntil: 'domcontentloaded' })
  const emailField = page.getByRole('textbox', { name: /email/i })
  const hasLoginForm = await emailField
    .waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false)
  if (!hasLoginForm) return
  await emailField.fill(ADMIN_EMAIL)
  await page.getByRole('textbox', { name: /password/i }).fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: /^sign in$/i }).click()
  // Wait until the login form is gone — we no longer rely on URL
  // because the app stays at `/` after auth.
  await emailField.waitFor({ state: 'detached', timeout: 15_000 })
}

/**
 * Wait for the page to settle past its initial loading skeleton. We
 * match both `data-loading-skeleton` and `role="status"` because
 * `PanelSkeleton`, `TableSkeleton`, and `DetailSkeleton` all carry
 * slightly different semantics.
 */
export async function waitForNoSkeleton(page: Page, timeoutMs = 15_000): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('[data-loading-skeleton], [data-skeleton]').length === 0,
    undefined,
    { timeout: timeoutMs },
  )
}
