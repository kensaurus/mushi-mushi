import { describe, expect, it } from 'vitest'
import { chipLinkForText, parseDecideMetric } from './heroMetricDisplay'

describe('parseDecideMetric', () => {
  it('matches primary chip to label keywords', () => {
    const parsed = parseDecideMetric('Inactive seats', '3 members · 3 inactive · 0 pending')
    expect(parsed.value).toBe('3')
    expect(parsed.unit).toBe('inactive')
    expect(parsed.secondaryChips).toEqual(['3 members', '0 pending'])
  })

  it('falls back to first chip', () => {
    const parsed = parseDecideMetric('Loop healthy', '0 new · 2 fixing')
    expect(parsed.value).toBe('0')
    expect(parsed.secondaryChips).toEqual(['2 fixing'])
  })
})

describe('chipLinkForText', () => {
  it('links inactive chips on members scope', () => {
    expect(chipLinkForText('3 inactive', 'members')).toContain('inactive=1')
  })
})
