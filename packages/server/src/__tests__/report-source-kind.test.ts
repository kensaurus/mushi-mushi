/**
 * Where a report came from (owner's walkthrough, 2026-11-17): CloudWatch
 * alarms and a setup task read as user bugs. GET /v1/admin/reports filters by
 * `?source=` with these clauses, and the console tags each bug the same way
 * (apps/admin/src/lib/reportSourceKind.ts).
 */
import { describe, expect, it } from 'vitest'
import {
  REPORT_SOURCE_KINDS,
  SOURCE_VALUES_BY_KIND,
  isReportSourceKind,
  reportSourceKindFilter,
} from '../../supabase/functions/_shared/report-source-kind.ts'
import { combineOrGroups } from '../../supabase/functions/_shared/report-list-filters.ts'

describe('reportSourceKindFilter', () => {
  it('maps alarms, Sentry, setup tasks and checks to their reports.source values', () => {
    expect(reportSourceKindFilter('alarm')).toEqual({ kind: 'in', values: ['cloudwatch'] })
    expect(reportSourceKindFilter('sentry')).toEqual({ kind: 'in', values: ['sentry'] })
    expect(reportSourceKindFilter('task')).toEqual({ kind: 'in', values: ['sdk_health'] })
    expect(reportSourceKindFilter('check')).toEqual({ kind: 'in', values: SOURCE_VALUES_BY_KIND.check })
  })

  it('a test is the "Send a test report" sample, by its metadata', () => {
    expect(reportSourceKindFilter('test')).toEqual({ kind: 'eq_meta', value: 'admin_test_report' })
  })

  it('user reports are everything else, never an alarm, a task or a test', () => {
    const f = reportSourceKindFilter('user')
    if (f.kind !== 'or') throw new Error('expected or groups')
    expect(f.groups[0]).toContain('source.is.null')
    for (const v of ['cloudwatch', 'sentry', 'sdk_health', 'site_watch']) expect(f.groups[0]).toContain(v)
    expect(f.groups[1]).toContain('custom_metadata->>source.neq.admin_test_report')
    // ANDed with a search group as one or= value, the PostgREST form.
    expect(combineOrGroups(['summary.ilike.%x%', ...f.groups])).toMatch(/^and\(or\(summary/)
  })

  it('accepts only the known kinds', () => {
    expect(REPORT_SOURCE_KINDS.every(isReportSourceKind)).toBe(true)
    expect(isReportSourceKind('widget')).toBe(false)
  })
})
