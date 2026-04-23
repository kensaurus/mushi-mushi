/**
 * favicon-badge.spec.ts
 *
 * Phase 2d — the favicon grows a red dot when the current
 * `pageContext` reports `criticalCount > 0`. We verify by:
 *
 *   1. Loading the admin UI (any route) and checking the default
 *      favicon href is the plain SVG.
 *   2. Stubbing `/v1/admin/reports` so the ReportsPage renders at
 *      least one `severity: 'critical'` row — the ReportsPage
 *      publisher forwards that count to `criticalCount`.
 *   3. Navigating to `/reports` and asserting the favicon href
 *      switches to a base64 PNG data URL and the rasterised image
 *      has a red pixel in the top-right quadrant.
 */

import { test, expect } from '@playwright/test'
import {
  ADMIN_URL,
  CORS_HEADERS,
  handlePreflight,
  loginToAdmin,
  shouldSkipAdminUi,
} from './admin-polish.helpers'

test.describe('Favicon criticality badge', () => {
  test.beforeEach(({}, testInfo) => {
    const reason = shouldSkipAdminUi()
    if (reason) testInfo.skip(true, reason)
  })

  test('favicon gains a red dot when criticalCount > 0', async ({ page }) => {
    // Stub the reports list so we control the critical count
    // independently of whatever state the dev DB happens to be in.
    await page.route(/\/v1\/admin\/reports(\?.*)?$/, async (route) => {
      if (await handlePreflight(route)) return
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        // `apiFetch` expects the `{ ok, data }` envelope — without it
        // `usePageData` treats the payload as a failed response.
        body: JSON.stringify({
          ok: true,
          data: {
            reports: [
              {
                id: 'rep-critical-001',
                project_id: 'e2e',
                description: 'E2E critical report for favicon badge test',
                severity: 'critical',
                status: 'new',
                category: 'bug',
                component: null,
                reporter_token_hash: 'e2e',
                created_at: new Date().toISOString(),
                classified_at: new Date().toISOString(),
              },
            ],
            total: 1,
            page: 0,
            pageSize: 50,
          },
        }),
      })
    })

    await loginToAdmin(page)

    // First, go somewhere neutral so we can verify the default favicon.
    await page.goto(`${ADMIN_URL}/health`)
    await page.waitForLoadState('domcontentloaded')
    const defaultHref = await page.evaluate(
      () => (document.querySelector('link[rel~="icon"]') as HTMLLinkElement | null)?.href ?? '',
    )
    expect(defaultHref, 'default favicon is the SVG').toMatch(/favicon\.svg$/)

    await page.goto(`${ADMIN_URL}/reports`)
    // Wait for the badge hook to raster + swap the href to a PNG data URL.
    await page.waitForFunction(
      () => {
        const link = document.querySelector('link[rel~="icon"]') as HTMLLinkElement | null
        return !!link && /^data:image\/png;base64,/.test(link.href)
      },
      undefined,
      { timeout: 10_000 },
    )

    // Decode the PNG and check the top-right quadrant for a pronounced
    // red pixel. We scan a small 10×10 box inset a pixel from the edge
    // to avoid rounding quirks between browsers.
    const hasRedDot = await page.evaluate(async () => {
      const link = document.querySelector('link[rel~="icon"]') as HTMLLinkElement
      const img = new Image()
      img.src = link.href
      await new Promise<void>((res, rej) => {
        img.onload = () => res()
        img.onerror = () => rej(new Error('favicon PNG failed to decode'))
      })
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(img.width - 11, 1, 10, 10).data
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const a = data[i + 3]
        if (a > 200 && r > 200 && g < 100 && b < 100) return true
      }
      return false
    })
    expect(hasRedDot, 'favicon top-right quadrant must contain a red badge pixel').toBe(true)
  })
})
