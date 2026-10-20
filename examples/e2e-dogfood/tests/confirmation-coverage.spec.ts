/**
 * FILE: examples/e2e-dogfood/tests/confirmation-coverage.spec.ts
 * PURPOSE: Assert each destructive admin surface asks before it mutates.
 *
 * OVERVIEW:
 * Opens the page, requires the control, clicks it, asserts the confirm
 * dialog, then cancels. A missing control fails the test. The spec never
 * confirms, so nothing is deleted.
 *
 * DEPENDENCIES:
 * - @playwright/test
 * - Admin at MUSHI_ADMIN_URL (default http://localhost:6464)
 * - VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, TEST_USER_EMAIL, TEST_USER_PASSWORD
 *
 * USAGE:
 * pnpm --filter @mushi-mushi/e2e-dogfood exec playwright test confirmation-coverage
 *
 * NOTES:
 * The describe-level skip is a credential guard. A missing control must fail
 * the test (BL-064). Skipping it lets the spec pass without asserting.
 * The signed-in project must already have a report, your own comment, an
 * unfixed fix, an inactive prompt, a connected routing, a BYOK key, and a QA story.
 */

import { test, expect, type Locator, type Page, type APIRequestContext } from '@playwright/test'

const ADMIN_URL = process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464'
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
// supabase-js stores the session under sb-<first host label>-auth-token.
const AUTH_STORAGE_KEY = `sb-${SUPABASE_URL ? new URL(SUPABASE_URL).hostname.split('.')[0] : 'unset'}-auth-token`
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL ?? ''
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD ?? ''

async function setupSession(page: Page, request: APIRequestContext) {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    data: { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD },
  })
  expect(res.ok()).toBeTruthy()
  const body = await res.json() as { access_token: string; refresh_token: string }
  await page.addInitScript((tokens) => {
    window.localStorage.setItem(
      tokens.storageKey,
      JSON.stringify({ access_token: tokens.access_token, refresh_token: tokens.refresh_token }),
    )
  }, { access_token: body.access_token, refresh_token: body.refresh_token, storageKey: AUTH_STORAGE_KEY })
}

/** A skip here would pass the spec without checking the confirm gate. */
async function requireControl(locator: Locator, what: string): Promise<void> {
  await expect(locator, `${what} must be visible so the confirm gate is asserted`).toBeVisible()
}

async function expectConfirmThenCancel(page: Page, name: RegExp): Promise<void> {
  // Match the dialog's accessible name (its title). A text filter also
  // matches an ancestor dialog, such as the QA story drawer.
  const modal = page.getByRole('dialog', { name })
  await expect(modal).toBeVisible()
  await modal.getByRole('button', { name: /cancel|keep/i }).click()
  await expect(modal).toBeHidden()
}

test.describe('Confirmation coverage — destructive surfaces ask first', () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_USER_EMAIL || !TEST_USER_PASSWORD,
    'Requires VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY + TEST_USER_EMAIL + TEST_USER_PASSWORD',
  )

  test.beforeEach(async ({ page, request }) => {
    await setupSession(page, request)
  })

  test('#1 ReportsPage row Dismiss asks before closing the report', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/reports`, { waitUntil: 'domcontentloaded' })
    const row = page.locator('tbody tr').first()
    await requireControl(row, 'A report row')
    await row.hover()
    const dismiss = row.getByRole('button', { name: 'Dismiss' })
    await requireControl(dismiss, 'Reports row Dismiss')
    await dismiss.click()
    await expectConfirmThenCancel(page, /dismiss this report/i)
  })

  test('#3 ReportDetail comment delete asks first', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/reports`, { waitUntil: 'domcontentloaded' })
    const opener = page.locator('a[href*="/reports/"]').first()
    await requireControl(opener, 'A report to open')
    await opener.click()
    const deleteBtn = page.getByRole('button', { name: 'Delete comment' }).first()
    await requireControl(deleteBtn, 'Comment delete')
    await deleteBtn.click()
    await expectConfirmThenCancel(page, /delete this comment/i)
  })

  test('#6 FixesPage retry of unfixed reports asks first', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/fixes`, { waitUntil: 'domcontentloaded' })
    const retry = page.getByRole('button', { name: /retry \d+ unfixed/i }).first()
    await requireControl(retry, 'Retry unfixed')
    await retry.click()
    await expectConfirmThenCancel(page, /retry .+ unfixed/i)
  })

  test('#7 PromptLabPage Activate asks before 100% traffic', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/prompt-lab`, { waitUntil: 'domcontentloaded' })
    const activate = page.getByRole('button', { name: 'Activate' }).first()
    await requireControl(activate, 'Activate prompt')
    await activate.click()
    await expectConfirmThenCancel(page, /at 100%/i)
  })

  test('#8 Integrations routing disconnect asks first', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/integrations/config`, { waitUntil: 'domcontentloaded' })
    const disconnect = page.getByRole('button', { name: 'Disconnect integration' }).first()
    await requireControl(disconnect, 'Routing disconnect')
    await disconnect.click()
    await expectConfirmThenCancel(page, /^disconnect /i)
  })

  test('#10 SettingsPage BYOK remove asks first', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/settings?tab=byok`, { waitUntil: 'domcontentloaded' })
    const remove = page.getByRole('button', { name: /remove( old)? key|^remove /i }).first()
    await requireControl(remove, 'BYOK remove')
    await remove.click()
    await expectConfirmThenCancel(page, /^remove this /i)
  })

  test('#11 QaCoveragePage story delete asks first', async ({ page }) => {
    await page.goto(`${ADMIN_URL}/qa-coverage`, { waitUntil: 'domcontentloaded' })
    const card = page.locator('[id^="qa-story-"]').first()
    await requireControl(card, 'QA story card')
    await card.click()
    const deleteBtn = page.getByRole('button', { name: 'Delete story' })
    await requireControl(deleteBtn, 'Delete story')
    await deleteBtn.click()
    await expectConfirmThenCancel(page, /^delete /i)
  })
})
