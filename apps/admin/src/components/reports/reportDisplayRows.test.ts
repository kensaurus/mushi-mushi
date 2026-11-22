import { describe, expect, it } from 'vitest'
import { buildDisplayRows, displayGroupKey, variantChip } from './reportDisplayRows'
import type { ReportRow } from './types'

const r = (id: string, extra: Partial<ReportRow>): ReportRow =>
  ({ id, project_id: 'p1', description: '', category: 'bug', severity: 'medium', summary: null, status: 'classified', created_at: '2026-11-18T00:00:00Z', user_category: 'bug', confidence: 0.9, component: null, ...extra }) as ReportRow

describe('buildDisplayRows', () => {
  // Three "Known security hole in next 16.4.2" rows, one per app (R2 sweep 2026-11-18).
  const advisory = 'Known security hole in next 16.4.2: upgrade to 16.4.5'
  const rows = [
    r('a', { source: 'security_advisory', title: advisory, project_id: 'glot', report_group_id: 'g1' }),
    r('b', { source: 'sentry', title: 'An unexpected error was reported in the app', report_group_id: 'g2' }),
    r('c', { source: 'security_advisory', title: advisory, project_id: 'mushi', report_group_id: 'g3' }),
    r('d', { source: 'sentry', title: 'An unexpected error was reported in the app', report_group_id: 'g4' }),
    r('e', { source: 'security_advisory', title: `  ${advisory} `, project_id: 'yen', report_group_id: 'g5' }),
    r('f', { source: 'sentry', title: 'Same fingerprint', report_group_id: 'g6' }),
    r('g', { source: 'sentry', title: 'Same fingerprint', report_group_id: 'g6' }),
  ]

  it('groups one check across apps under its first row, keeping order', () => {
    const out = buildDisplayRows(rows, true, new Set())
    expect(out.map((d) => d.row.id)).toEqual(['a', 'b', 'd', 'f'])
    expect(out[0].variantCount).toBe(3)
    expect(out[0].appCount).toBe(3)
    expect(out[3].variantCount).toBe(2)
  })

  it('never merges different Sentry bugs that share a generic title', () => {
    expect(displayGroupKey(rows[1])).not.toBe(displayGroupKey(rows[3]))
  })

  it('expands a group by its key and lists the siblings under it', () => {
    const key = displayGroupKey(rows[0])!
    expect(key).not.toContain(',')
    const out = buildDisplayRows(rows, true, new Set([key]))
    expect(out.slice(0, 3).map((d) => [d.row.id, d.isVariantOf ?? null])).toEqual([
      ['a', null],
      ['c', key],
      ['e', key],
    ])
  })

  it('lists every row when grouping is off', () => {
    expect(buildDisplayRows(rows, false, new Set())).toHaveLength(rows.length)
  })
})

describe('variantChip', () => {
  it('labels the count instead of a bare "+1"', () => {
    expect(variantChip(2, 1).label).toBe('+1 similar')
    expect(variantChip(3, 3).tooltip).toBe('2 more reports of the same bug, across 3 apps')
  })
})
