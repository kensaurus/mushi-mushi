import { describe, expect, it } from 'vitest'
import { planLabel } from './billing.js'

describe('planLabel', () => {
  it('names plans the way the console and pricing page do (2026-10-28)', () => {
    expect(planLabel('free_cloud')).toBe('Free')
    expect(planLabel('indie')).toBe('Builder')
    expect(planLabel('pro')).toBe('Studio')
    expect(planLabel('enterprise')).toBe('Enterprise')
    expect(planLabel('hobby')).toBe('Free')
  })

  it('falls back to the raw id or a dash', () => {
    expect(planLabel('custom_plan')).toBe('custom_plan')
    expect(planLabel(null)).toBe('—')
  })
})
