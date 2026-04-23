/**
 * dynamic-title.spec.ts
 *
 * Verifies Phase 2 of the UIUX polish — `document.title` tracks the
 * current route and any page context a publisher has registered.
 *
 * Assertions per route:
 *   - `/`          → contains "Dashboard"
 *   - `/reports`   → contains "Reports"
 *   - `/health`    → contains "Health"
 *   - `/judge`     → contains "Judge"
 *   - `/settings?tab=byok` → contains "BYOK" and "Settings"
 *   - every title ends with "— Mushi Mushi" (suffix contract)
 *
 * We don't assert the *summary* text because its content depends on
 * live data; we check structural properties (suffix, route token)
 * which are invariant under different DB states.
 */

import { test, expect } from '@playwright/test'
import {
  ADMIN_URL,
  loginToAdmin,
  shouldSkipAdminUi,
} from './admin-polish.helpers'

test.describe('Dynamic document title', () => {
  test.beforeEach(({}, testInfo) => {
    const reason = shouldSkipAdminUi()
    if (reason) testInfo.skip(true, reason)
  })

  const ROUTES: Array<{ path: string; token: RegExp }> = [
    { path: '/', token: /Dashboard/ },
    { path: '/reports', token: /Reports/ },
    { path: '/health', token: /Health/ },
    { path: '/judge', token: /Judge/ },
    { path: '/settings?tab=byok', token: /BYOK.*Settings/ },
  ]

  test('title updates per route with the Mushi Mushi suffix', async ({ page }) => {
    await loginToAdmin(page)
    for (const { path, token } of ROUTES) {
      await page.goto(`${ADMIN_URL}${path}`)
      // Wait a frame so `useDocumentTitle`'s rAF write has a chance to
      // flush — otherwise we race the initial mount.
      await page.waitForFunction(
        (t) => /Mushi Mushi$/.test(document.title) && t.test(document.title),
        token,
        { timeout: 10_000 },
      )
      const title = await page.title()
      expect(title, `title for ${path}`).toMatch(token)
      expect(title, `title for ${path} must end with "— Mushi Mushi"`).toMatch(/— Mushi Mushi$/)
    }
  })
})
