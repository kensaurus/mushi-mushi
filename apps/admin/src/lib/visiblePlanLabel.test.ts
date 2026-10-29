import { describe, expect, it } from 'vitest'
import { planDisplayName, visiblePlanLabel, visiblePlanTitle } from './visiblePlanLabel'

describe('visiblePlanLabel', () => {
  it('keeps a live display name and marks complimentary the same way on every surface', () => {
    const input = { displayName: 'Pro', planId: 'pro', billingMode: 'complimentary' as const }
    expect(visiblePlanLabel(input)).toBe('Pro (complimentary)')
    expect(visiblePlanTitle(input)).toBe(
      'Pro (complimentary) — billed by Mushi at no cost. Features follow this tier.',
    )
    expect(visiblePlanLabel(input)).not.toMatch(/\b(comp|admin)\b/i)
  })

  it('uses the catalog name only when the display name is missing', () => {
    expect(visiblePlanLabel({ planId: 'pro', billingMode: 'complimentary' })).toBe('Studio (complimentary)')
    expect(visiblePlanLabel({ displayName: 'Studio', planId: 'pro', billingMode: 'stripe' })).toBe('Studio')
  })

  it('does not invent a complimentary suffix for a paid plan', () => {
    expect(visiblePlanLabel({ displayName: 'Studio', planId: 'pro', billingMode: 'stripe' })).toBe('Studio')
    expect(visiblePlanTitle({ displayName: 'Studio', planId: 'pro' })).toBe('Studio')
    expect(planDisplayName(null, 'indie')).toBe('Builder')
    expect(planDisplayName('  ', 'free_cloud')).toBe('Free')
  })
})
