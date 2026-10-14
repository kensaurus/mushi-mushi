/**
 * FILE: packages/server/src/__tests__/report-sentry-links-contract.test.ts
 * PURPOSE: Source-level guard for the report page's Sentry state (console IA
 *          pass, 2026-10-14). GET /v1/admin/reports/:id returns the Sentry
 *          issues a report came from, read from report_external_issues and
 *          scoped to this report, its project and system 'sentry', with
 *          resolved_at, so the page can say "resolves when the fix merges" or
 *          "resolved in Sentry" from what Sentry answered, not from the
 *          report's own status. A failed read is null, never [].
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPORTS = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/reports.ts'), 'utf8')

function detailRoute(): string {
  const start = REPORTS.indexOf("app.get('/v1/admin/reports/:id', adminOrApiKey()")
  expect(start).toBeGreaterThan(0)
  const end = REPORTS.indexOf('app.', start + 10)
  return REPORTS.slice(start, end > start ? end : undefined)
}

describe('report detail: sentry_links', () => {
  it('reads the report’s own Sentry links with their resolve state', () => {
    const route = detailRoute()
    const at = route.indexOf(".from('report_external_issues')")
    expect(at).toBeGreaterThan(0)
    const query = route.slice(at, at + 400)
    expect(query).toContain("'external_id, external_url, resolved_at'")
    expect(query).toContain(".eq('report_id', reportId)")
    expect(query).toContain(".eq('project_id', data.project_id as string)")
    expect(query).toContain(".eq('system', 'sentry')")
  })

  it('answers null on a failed read', () => {
    expect(detailRoute()).toContain('sentry_links: sentryLinksRes.error ? null : (sentryLinksRes.data ?? [])')
  })
})
