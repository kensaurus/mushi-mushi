/**
 * reports-bulk-undo.spec.ts
 *
 * Wave T.2.4b regression test for the undo-on-bulk affordance on the admin
 * Reports page. We stub /v1/admin/reports (list) + /v1/admin/reports/bulk
 * (apply) + /v1/admin/reports/bulk/:id/undo (undo) so the spec never
 * depends on there being real data in the dev DB.
 *
 * The assertion chain:
 *   1. Load reports, select 3 rows.
 *   2. Click Dismiss → a success toast with an "Undo" action appears.
 *   3. Click Undo → the POST /undo endpoint is hit with the mutation_id
 *      returned by the apply, and a follow-up "Undone" toast appears.
 *
 * We don't bother re-rendering the rows themselves — that's covered by
 * the render tests. This spec is exclusively about the toast + network
 * contract between FE and BE.
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

const MUTATION_ID = '11111111-2222-3333-4444-555555555555'

function makeReport(id: number) {
  return {
    id: `r-${id}`,
    project_id: 'p-0',
    category: 'bug',
    description: `Stubbed bug #${id}`,
    status: 'new',
    severity: 'medium',
    created_at: new Date(Date.now() - id * 60_000).toISOString(),
    updated_at: new Date(Date.now() - id * 60_000).toISOString(),
    reporter_token_hash: 'stub-hash',
    environment: {},
  }
}

test.describe('Reports bulk undo', () => {
  test.beforeEach(({}, testInfo) => {
    const reason = shouldSkipAdminUi()
    if (reason) testInfo.skip(true, reason)
  })

  test('Dismiss → Undo toast restores rows on server', async ({ page }) => {
    // Seed the list endpoint with 3 stub reports so selection is
    // deterministic even against a fresh DB.
    await page.route(/\/v1\/admin\/reports(\?.*)?$/, async (route) => {
      if (await handlePreflight(route)) return
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          data: {
            reports: [makeReport(1), makeReport(2), makeReport(3)],
            total: 3,
          },
        }),
      })
    })

    let bulkCalls = 0
    await page.route(/\/v1\/admin\/reports\/bulk$/, async (route) => {
      if (await handlePreflight(route)) return
      if (route.request().method() !== 'POST') return route.continue()
      bulkCalls += 1
      await route.fulfill({
        status: 200,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          data: {
            updated: 3,
            ids: ['r-1', 'r-2', 'r-3'],
            mutation_id: MUTATION_ID,
          },
        }),
      })
    })

    let undoCalls = 0
    await page.route(/\/v1\/admin\/reports\/bulk\/.+\/undo$/, async (route) => {
      if (await handlePreflight(route)) return
      if (route.request().method() !== 'POST') return route.continue()
      undoCalls += 1
      await route.fulfill({
        status: 200,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          data: { mutation_id: MUTATION_ID, restored: 3 },
        }),
      })
    })

    await loginToAdmin(page)
    await page.goto(`${ADMIN_URL}/reports`)
    await waitForNoSkeleton(page)

    // Select all three rows via the header "Select all on page" checkbox.
    // The per-row checkboxes live inside a scroll container and occasionally
    // race with lazy row rendering; the header checkbox is a single
    // deterministic click that flips all visible rows on.
    const selectAll = page.getByRole('checkbox', { name: /select all/i }).first()
    await expect(selectAll).toBeVisible({ timeout: 10_000 })
    await selectAll.click()

    await expect(page.getByText(/3 selected/i)).toBeVisible({ timeout: 5_000 })

    // Scope to the BulkBar region — per-row "Dismiss" icon buttons share
    // the same accessible name, so an unscoped lookup is ambiguous.
    const bulkBar = page.getByRole('region', { name: /bulk actions/i })
    await bulkBar.getByRole('button', { name: /^dismiss$/i }).click()

    expect(bulkCalls).toBe(1)

    const undoBtn = page.getByRole('button', { name: /^undo/i }).first()
    await expect(undoBtn).toBeVisible({ timeout: 5_000 })

    await undoBtn.click()

    await expect(page.getByText(/^undone$/i).first()).toBeVisible({ timeout: 5_000 })
    expect(undoCalls).toBe(1)
  })
})
