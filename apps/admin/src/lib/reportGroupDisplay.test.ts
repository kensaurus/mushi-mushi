import { describe, expect, it } from 'vitest'
import { reportGroupCategory, reportGroupLabel, reportGroupSeverity } from './reportGroupDisplay'

const reports = [
  { id: 'r1', summary: 'Checkout button does nothing', severity: 'medium', category: 'bug' },
  { id: 'r2', summary: 'Cart total wrong', severity: 'high', category: 'bug' },
]

describe('reportGroupLabel', () => {
  it('prefers the group title', () => {
    expect(reportGroupLabel({ id: 'g', title: 'Checkout broken', reports })).toBe('Checkout broken')
  })

  it('falls back to the canonical report summary, never a UUID', () => {
    expect(reportGroupLabel({ id: 'g-uuid', title: null, canonical_report_id: 'r2', reports })).toBe('Cart total wrong')
    expect(reportGroupLabel({ id: 'g-uuid', reports })).toBe('Checkout button does nothing')
    expect(reportGroupLabel({ id: 'g-uuid', reports: [] })).not.toContain('g-uuid')
  })
})

describe('reportGroupSeverity', () => {
  it('uses the worst severity in the group', () => {
    expect(reportGroupSeverity({ id: 'g', reports })).toBe('high')
    expect(reportGroupSeverity({ id: 'g', reports: [] })).toBeNull()
  })
})

describe('reportGroupCategory', () => {
  it('reads the canonical report category', () => {
    expect(reportGroupCategory({ id: 'g', canonical_report_id: 'r1', reports })).toBe('bug')
  })
})
