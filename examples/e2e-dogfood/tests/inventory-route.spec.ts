/**
 * Inventory v2 admin route — smoke test (requires operator credentials).
 */
import { test, expect } from '@playwright/test'
import { loginToAdmin, shouldSkipAdminUi, ADMIN_URL } from './admin-polish.helpers'

test.describe('Admin /inventory', () => {
  test.beforeEach(({ }, testInfo) => {
    const skip = shouldSkipAdminUi()
    if (skip) testInfo.skip(true, skip)
  })

  test('loads inventory shell', async ({ page }) => {
    await loginToAdmin(page)
    await page.goto(`${ADMIN_URL}/inventory`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('mushi-page-inventory')).toBeVisible({ timeout: 30_000 })
  })
})
