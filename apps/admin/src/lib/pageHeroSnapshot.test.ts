import { describe, expect, it } from 'vitest'
import { heroMetricChips } from './pageHeroSnapshot'

describe('heroMetricChips', () => {
  it('splits metrics into readable chips', () => {
    const chips = heroMetricChips('3 members · 3 inactive · 0 pending')
    expect(chips).toEqual(['3 members', '3 inactive', '0 pending'])
  })
})
