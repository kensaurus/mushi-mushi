/**
 * Smoke test: QA Coverage mode UX + banner.
 */
import { test, expect } from '@playwright/test'

const ADMIN_URL = process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464'
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL ?? ''
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD ?? ''

async function setupSession(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    data: { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD },
  })
  expect(res.ok()).toBeTruthy()
  const session = (await res.json()) as Record<string, unknown> & {
    access_token: string
    refresh_token: string
    expires_in?: number
    expires_at?: number
  }
  const ref = SUPABASE_URL.match(/https:\/\/([^.]+)\./)?.[1] ?? 'mushi'
  const storageKey = `sb-${ref}-auth-token`
  const expiresAt =
    (session.expires_at as number | undefined) ??
    Math.floor(Date.now() / 1000) + ((session.expires_in as number | undefined) ?? 3600)
  await page.addInitScript(({ key, payload }) => {
    window.localStorage.setItem(key, JSON.stringify(payload))
    window.localStorage.removeItem('mushi:pagehelp:read:qa-coverage')
  }, { key: storageKey, payload: { ...session, expires_at: expiresAt } })
}

test.describe('QA Coverage mode UX smoke', () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_USER_EMAIL || !TEST_USER_PASSWORD,
    'Requires auth env vars',
  )

  test.beforeEach(async ({ page, request }) => {
    await setupSession(page, request)
  })

  test('Beginner mode — tab strip + snapshot + plain title', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mushi:mode', 'beginner')
    })
    await page.goto(`${ADMIN_URL}/qa-coverage`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)

    await expect(page.getByTestId('mushi-page-qa-coverage')).toBeVisible()
    await expect(page.getByRole('radiogroup', { name: 'QA coverage sections' })).toBeVisible()
    await expect(page.getByText('At a glance', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Catch bugs before users do' })).toBeVisible()
  })

  test('Quick mode — stories panel only (no tabs, no snapshot)', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mushi:mode', 'quickstart')
    })
    await page.goto(`${ADMIN_URL}/qa-coverage`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)

    await expect(page.getByTestId('mushi-page-qa-coverage')).toBeVisible()
    await expect(page.getByRole('radiogroup', { name: 'QA coverage sections' })).toHaveCount(0)
    await expect(page.getByText('At a glance', { exact: true })).toHaveCount(0)
  })
})
