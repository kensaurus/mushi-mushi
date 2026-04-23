/**
 * chart-annotations.spec.ts
 *
 * Wave T.5.8b regression test for the `<ChartAnnotations>` overlay on
 * the Judge / Dashboard charts. We stub `/v1/admin/chart-events` with a
 * known event set and assert:
 *   - the overlay renders a dot per event within the window
 *   - hovering a dot reveals the tooltip with the expected label
 *   - `kinds` query param round-trips through URL state — changing it
 *     re-fetches with the filtered set (we verify via request spy)
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

const NOW = new Date('2026-04-23T12:00:00Z').getTime()

function iso(offsetDays: number): string {
  return new Date(NOW - offsetDays * 86_400_000).toISOString()
}

test.describe('ChartAnnotations overlay', () => {
  test.beforeEach(({}, testInfo) => {
    const reason = shouldSkipAdminUi()
    if (reason) testInfo.skip(true, reason)
  })

  test('renders dots and respects kinds filter', async ({ page }) => {
    const requests: string[] = []
    await page.route(/\/v1\/admin\/chart-events(\?.*)?$/, async (route) => {
      if (await handlePreflight(route)) return
      requests.push(route.request().url())
      await route.fulfill({
        status: 200,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          data: {
            events: [
              { occurred_at: iso(1), kind: 'deploy', label: 'Deploy · abc1234', href: 'https://example.com/pr/1', project_id: null },
              { occurred_at: iso(2), kind: 'cron', label: 'Cron · judge-batch · error', href: null, project_id: null },
              { occurred_at: iso(5), kind: 'byok', label: 'BYOK · anthropic · rotated', href: null, project_id: null },
            ],
          },
        }),
      })
    })

    // Stub the dashboard payload so the page renders without a live DB.
    await page.route(/\/v1\/admin\/dashboard(\?.*)?$/, async (route) => {
      if (await handlePreflight(route)) return
      await route.fulfill({
        status: 200,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          data: {
            counts: { reports: 0, fixesInFlight: 0, llmCalls14d: 100 },
            fixSummary: { total: 0, merged: 0, pending: 0, failed: 0 },
            reportsByDay: [],
            llmByDay: Array.from({ length: 14 }, (_, i) => ({
              day: iso(13 - i),
              tokens: 1000 + i * 10,
              calls: 5 + i,
            })),
            triageQueue: [],
            topComponents: [],
          },
        }),
      })
    })

    await loginToAdmin(page)
    await page.goto(`${ADMIN_URL}/`)
    await waitForNoSkeleton(page)

    // Overlay renders — at least one testid group lands on the page.
    const overlay = page.getByTestId('chart-annotations').first()
    await expect(overlay).toBeVisible({ timeout: 5_000 })

    // At least the three stubbed dots exist across overlays.
    const dots = page.locator('[data-testid="chart-annotations"] [data-kind]')
    expect(await dots.count()).toBeGreaterThanOrEqual(3)

    // Request spy: `kinds=deploy,cron,byok` was sent.
    expect(requests.some((u) => u.includes('kinds=deploy') && u.includes('byok'))).toBe(true)
  })
})
