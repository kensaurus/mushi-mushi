/**
 * FILE: apps/admin/src/lib/reportsByApp.test.ts
 * PURPOSE: /reports in All apps mode groups its rows by app: the app with the
 *          most urgent open bug first, rows inside an app in the person's sort,
 *          and the drawn order is the cursor's order.
 */
import { describe, expect, it } from 'vitest'
import { orderReportsByApp, reportAppCounts, reportAppGroups, reportRunStatus, reportUrgencyRank } from './reportsByApp'

const row = (id: string, project_id: string, status: string, severity: string | null, project_name?: string) => ({ id, project_id, project_name, status, severity })

describe('reportUrgencyRank / reportRunStatus', () => {
  it('ranks open critical, open high, untriaged, other open, fixing, closed', () => {
    expect(reportUrgencyRank({ status: 'classified', severity: 'critical' })).toBe(0)
    expect(reportUrgencyRank({ status: 'new', severity: 'high' })).toBe(1)
    expect(reportUrgencyRank({ status: 'new', severity: 'low' })).toBe(2)
    expect(reportUrgencyRank({ status: 'classified', severity: 'medium' })).toBe(3)
    expect(reportUrgencyRank({ status: 'fixing', severity: 'critical' })).toBe(4)
    expect(reportUrgencyRank({ status: 'fixed', severity: 'critical' })).toBe(5)
  })
  it('maps to a state with its own glyph', () => {
    expect(reportRunStatus({ status: 'new', severity: 'critical' })).toBe('failed')
    expect(reportRunStatus({ status: 'new', severity: null })).toBe('waiting')
    expect(reportRunStatus({ status: 'fixing', severity: null })).toBe('running')
    expect(reportRunStatus({ status: 'fixed', severity: null })).toBe('passed')
    expect(reportRunStatus({ status: 'dismissed', severity: null })).toBe('cancelled')
  })
})

describe('reportAppGroups', () => {
  const rows = [
    row('a1', 'pa', 'new', 'low', 'Alpha'),
    row('b1', 'pb', 'classified', 'critical', 'Beta'),
    row('a2', 'pa', 'fixed', null, 'Alpha'),
    row('b2', 'pb', 'new', 'medium', 'Beta'),
  ]

  it('puts the app with the most urgent open bug first and keeps the sort inside each app', () => {
    const groups = reportAppGroups(rows)
    expect(groups.map((g) => g.name)).toEqual(['Beta', 'Alpha'])
    expect(groups[0]!.items.map((r) => r.id)).toEqual(['b1', 'b2'])
    expect(groups[1]!.items.map((r) => r.id)).toEqual(['a1', 'a2'])
  })

  it('orders the page rows as drawn, for the keyboard cursor', () => {
    expect(orderReportsByApp(rows).map((r) => r.id)).toEqual(['b1', 'b2', 'a1', 'a2'])
  })

  it('counts each app for its header chips', () => {
    expect(reportAppCounts(reportAppGroups(rows)[1]!.items)).toEqual({ waiting: 1, passed: 1 })
  })
})
