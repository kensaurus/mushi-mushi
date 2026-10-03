/**
 * FILE: packages/server/src/__tests__/report-admin-seen-contract.test.ts
 * PURPOSE: Source-level guard for the console unread dot (Plan 018 decision
 *          10, completeness gap #5). The console compares
 *          `last_reporter_reply_at` with `admin_seen_at`, so the list API must
 *          return the column and opening a report in the console must stamp
 *          it, while an MCP / API-key read must not (an agent reading the
 *          report is not the developer seeing it).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPORTS = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/reports.ts'), 'utf8')

function routeBody(signature: string, length = 4000): string {
  const start = REPORTS.indexOf(signature)
  expect(start, `${signature} not found`).toBeGreaterThan(0)
  return REPORTS.slice(start, start + length)
}

describe('admin_seen_at contract', () => {
  it('the reports list selects admin_seen_at next to last_reporter_reply_at', () => {
    const list = routeBody("app.get('/v1/admin/reports',", 6000)
    const select = /\.select\(\s*(?:\/\/[^\n]*\n\s*)*'([^']+)'/.exec(list)?.[1] ?? ''
    expect(select).toContain('last_reporter_reply_at')
    expect(select).toContain('admin_seen_at')
  })

  it('opening a report stamps admin_seen_at, only for a console (JWT) read', () => {
    const detail = routeBody("app.get('/v1/admin/reports/:id', adminOrApiKey()", 2500)
    const gate = detail.indexOf("c.get('authMethod') === 'jwt'")
    const stamp = detail.indexOf('.update({ admin_seen_at:')
    expect(gate).toBeGreaterThan(0)
    expect(stamp).toBeGreaterThan(gate)
    // The stamp is scoped to the opened report.
    expect(detail.slice(stamp, stamp + 200)).toContain(".eq('id', reportId)")
  })
})
