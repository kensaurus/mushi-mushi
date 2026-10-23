/**
 * FILE: report-false-alarm-close.test.ts
 * PURPOSE: A false alarm is stored only for a report Mushi's own check filed,
 *          and that close tells no reporter.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BULK_CLOSED_REASONS,
  CLOSED_REASONS,
  MUSHI_CHECK_SOURCES,
  bulkClosedReason,
  closedReasonAllowed,
  silentClosedReason,
} from '../../supabase/functions/_shared/report-close-reasons.ts'

const root = resolve(__dirname, '../../../..')

describe('false_alarm close reason', () => {
  it('stores the reason for a check Mushi filed, and refuses it on a widget report', () => {
    expect(CLOSED_REASONS.has('false_alarm')).toBe(true)
    for (const source of MUSHI_CHECK_SOURCES) {
      expect(closedReasonAllowed('false_alarm', source)).toBe(true)
    }
    for (const source of ['widget', 'sentry', 'sdk', '', null, undefined]) {
      expect(closedReasonAllowed('false_alarm', source)).toBe(false)
    }
    expect(closedReasonAllowed('wont_fix', 'widget')).toBe(true)
    expect(closedReasonAllowed('nope', 'site_audit')).toBe(false)
  })

  it('tells no reporter, and a bulk close cannot stamp it on a mixed batch', () => {
    expect(silentClosedReason('false_alarm')).toBe(true)
    expect(silentClosedReason('spam')).toBe(true)
    expect(silentClosedReason('wont_fix')).toBe(false)
    expect(silentClosedReason(null)).toBe(false)
    expect(BULK_CLOSED_REASONS.has('false_alarm')).toBe(false)
    expect(bulkClosedReason('dismissed', 'false_alarm').ok).toBe(false)
  })

  it('the single-report PATCH checks the source, then stores the reason', () => {
    const reports = readFileSync(resolve(root, 'packages/server/supabase/functions/api/routes/reports.ts'), 'utf8')
    const patch = reports.slice(reports.indexOf("app.patch('/v1/admin/reports/:id'"))
    expect(patch).toContain("select('project_id, reporter_token_hash, status, report_group_id, source')")
    const gate = patch.indexOf("closedReasonAllowed('false_alarm'")
    const update = patch.indexOf('.update(updates)')
    expect(gate).toBeGreaterThan(0)
    expect(update).toBeGreaterThan(gate)
  })

  it('the database check and the console offer the same reason', () => {
    const sql = readFileSync(
      resolve(root, 'packages/server/supabase/migrations/20261023091000_reports_closed_reason_false_alarm.sql'),
      'utf8',
    )
    expect(sql).toContain("ARRAY['false_alarm']")
    expect(sql).toContain('reports_closed_reason_check')
    const ui = readFileSync(resolve(root, 'apps/admin/src/lib/closeReasons.ts'), 'utf8')
    expect(ui).toContain("value: 'false_alarm'")
    expect(ui).toContain("False alarm (Mushi's check was wrong)")
    for (const source of MUSHI_CHECK_SOURCES) expect(ui).toContain(`'${source}'`)
  })
})
