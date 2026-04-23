/**
 * byok-no-flash.spec.ts
 *
 * Regression test for the "container refresh flash" that used to happen
 * after clicking Test connection in the BYOK panel. Phase 1 of the
 * UIUX polish migrated `usePageData` to stale-while-revalidate, which
 * means the panel should stay mounted across a `reload()` — including
 * the one fired right after a successful Test round-trip.
 *
 * The assertion is intentionally narrow: no element carrying the
 * `data-loading-skeleton` attribute may appear between the moment the
 * Test button is clicked and the moment the result chip renders. If the
 * SWR upgrade ever regresses, the panel will unmount and this test
 * catches it immediately.
 *
 * We stub the backend `/v1/admin/byok` endpoints so this runs on any
 * admin session — no pre-configured BYOK key required.
 */

import { test, expect } from '@playwright/test'
import {
  ADMIN_URL,
  CORS_HEADERS,
  handlePreflight,
  loginToAdmin,
  shouldSkipAdminUi,
  waitForNoSkeleton,
} from './admin-polish.helpers'

test.describe('BYOK no-flash revalidation', () => {
  test.beforeEach(({}, testInfo) => {
    const reason = shouldSkipAdminUi()
    if (reason) testInfo.skip(true, reason)
  })

  test('clicking Test connection keeps the panel mounted', async ({ page }) => {
    // Stub BYOK status so the panel renders with one configured
    // provider regardless of the underlying DB. Without this the test
    // would flake when the dev env has no BYOK keys set.
    await page.route(/\/v1\/admin\/byok(\?.*)?$/, async (route) => {
      if (await handlePreflight(route)) return
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        // apiFetch wraps responses in an `ApiResult<T> = { ok, data, error }`
        // envelope — the Edge Function returns this shape, so our mock must
        // too or `usePageData` will treat the missing `ok` as a failure.
        body: JSON.stringify({
          ok: true,
          data: {
            keys: [
              {
                provider: 'anthropic',
                configured: true,
                hint: 'sk-ant-****',
                addedAt: new Date().toISOString(),
                baseUrl: null,
                testStatus: null,
                testedAt: null,
                testMessage: null,
                lastUsedAt: null,
              },
              {
                provider: 'openai',
                configured: false,
                hint: null,
                addedAt: null,
                baseUrl: null,
                testStatus: null,
                testedAt: null,
                testMessage: null,
                lastUsedAt: null,
              },
            ],
          },
        }),
      })
    })

    // Slow the Test response down a touch (350ms) so we have a guaranteed
    // window during which a skeleton *could* appear if the bug regressed.
    await page.route(/\/v1\/admin\/byok\/anthropic\/test/, async (route) => {
      if (await handlePreflight(route)) return
      await new Promise((r) => setTimeout(r, 350))
      await route.fulfill({
        status: 200,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          data: { status: 'ok', latencyMs: 412, hint: 'Connection OK', source: 'byok' },
        }),
      })
    })

    await loginToAdmin(page)
    await page.goto(`${ADMIN_URL}/settings?tab=byok`)
    await waitForNoSkeleton(page)

    // Count skeleton appearances from the click forward — we rely on
    // MutationObserver instead of polling so a brief mid-frame unmount
    // still gets counted.
    await page.evaluate(() => {
      ;(window as unknown as { __skelCount: number }).__skelCount = 0
      const mo = new MutationObserver((records) => {
        for (const r of records) {
          r.addedNodes.forEach((n) => {
            if (!(n instanceof Element)) return
            if (n.matches?.('[data-loading-skeleton], [data-skeleton]')) {
              ;(window as unknown as { __skelCount: number }).__skelCount++
            }
            if (n.querySelector?.('[data-loading-skeleton], [data-skeleton]')) {
              ;(window as unknown as { __skelCount: number }).__skelCount++
            }
          })
        }
      })
      mo.observe(document.body, { childList: true, subtree: true })
      ;(window as unknown as { __skelObserver: MutationObserver }).__skelObserver = mo
    })

    const testButton = page.getByRole('button', { name: /test connection/i }).first()
    await expect(testButton).toBeVisible({ timeout: 5_000 })
    await testButton.click()

    // The "Connection OK" chip should land and stay on screen. Use
    // `.first()` because the panel also renders "Connection OK" in the
    // card header badge for already-tested providers — Playwright's
    // strict mode would otherwise reject the multi-match locator.
    await expect(page.getByText(/connection ok/i).first()).toBeVisible({ timeout: 5_000 })

    const skelCount = await page.evaluate(
      () => (window as unknown as { __skelCount: number }).__skelCount ?? 0,
    )
    expect(skelCount, 'no loading skeleton should appear after Test click').toBe(0)

    // Focus retention: after the async Test completes, the Test button
    // should still be the focused element for keyboard re-run.
    const focusedId = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.id ?? '')
    expect(focusedId).toMatch(/^byok-test-/)
  })
})
