/**
 * FILE: examples/e2e-dogfood/tests/admin-visual-regression.spec.ts
 * PURPOSE: Light/dark visual regression snapshots for high-traffic admin routes
 *          after the UI/UX unification pass (HelpBanner, hero chrome, Connect layout).
 */

import { test, expect } from '@playwright/test'

const ADMIN_URL = process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464'
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL ?? ''
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD ?? ''

const ROUTES = [
  '/dashboard',
  '/reports',
  '/connect',
  '/onboarding',
  '/explore',
  '/settings',
  '/health',
  '/qa-coverage',
  '/billing',
  '/fixes',
] as const

async function setupSession(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    data: { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD },
  })
  expect(res.ok()).toBeTruthy()
  const { access_token, refresh_token } = await res.json() as {
    access_token: string
    refresh_token: string
  }
  await page.addInitScript((tokens) => {
    window.localStorage.setItem(
      'sb-mushi-auth-token',
      JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token }),
    )
    window.localStorage.setItem('mushi:mode', 'advanced')
  }, { access_token, refresh_token })
}

async function setTheme(page: import('@playwright/test').Page, theme: 'light' | 'dark') {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t
    window.localStorage.setItem('mushi:theme', t)
  }, theme)
}

test.describe('Admin visual regression — top routes', () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_USER_EMAIL || !TEST_USER_PASSWORD,
    'Requires VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY + TEST_USER_EMAIL + TEST_USER_PASSWORD',
  )

  test.beforeEach(async ({ page, request }) => {
    await setupSession(page, request)
  })

  for (const route of ROUTES) {
    for (const theme of ['light', 'dark'] as const) {
      test(`${route} — ${theme}`, async ({ page }) => {
        await page.goto(`${ADMIN_URL}${route}`, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(2500)
        await setTheme(page, theme)
        await page.waitForTimeout(500)
        await expect(page.locator('[data-portal="admin"], main, body')).toBeVisible()
        await expect(page).toHaveScreenshot(`${route.replace(/\//g, '-')}-${theme}.png`, {
          fullPage: false,
          maxDiffPixelRatio: 0.02,
        })
      })
    }
  }
})
