import { describe, expect, it } from 'vitest'
import { REPORT_SOURCE_FILTER_OPTIONS, REPORT_SOURCE_META, reportSourceKind, showsSeverity } from './reportSourceKind'

describe('reportSourceKind', () => {
  // Owner's walkthrough, 2026-11-17: alarms and a setup task read as user bugs.
  it('names alarms, Sentry, setup tasks, checks and tests; everything else is a user report', () => {
    expect(reportSourceKind({ source: 'cloudwatch' })).toBe('alarm')
    expect(reportSourceKind({ source: 'sentry' })).toBe('sentry')
    expect(reportSourceKind({ source: 'sdk_health' })).toBe('task')
    expect(reportSourceKind({ source: 'site_watch' })).toBe('check')
    expect(reportSourceKind({ source: null, metadata_source: 'admin_test_report' })).toBe('test')
    expect(reportSourceKind({ source: 'widget' })).toBe('user')
    expect(reportSourceKind({})).toBe('user')
  })

  it('every kind has a glyph (a shape, not colour alone) and a filter option', () => {
    for (const meta of Object.values(REPORT_SOURCE_META)) expect(meta.glyph.trim()).not.toBe('')
    expect(new Set(Object.values(REPORT_SOURCE_META).map((m) => m.glyph)).size).toBe(6)
    expect(REPORT_SOURCE_FILTER_OPTIONS.map((o) => o.value).sort()).toEqual(Object.keys(REPORT_SOURCE_META).sort())
  })

  it('a setup task or a test gets no bug severity', () => {
    expect(showsSeverity('task')).toBe(false)
    expect(showsSeverity('test')).toBe(false)
    expect(showsSeverity('alarm')).toBe(true)
    expect(showsSeverity('user')).toBe(true)
  })
})
