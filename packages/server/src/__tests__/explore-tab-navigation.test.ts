import { describe, it, expect } from 'vitest'
import { primaryTabOf, resolveExploreTab, defaultTabForPrimary } from '../../apps/admin/src/lib/exploreTabNavigation.ts'

describe('exploreTabNavigation', () => {
  it('resolves knowledge as understand primary', () => {
    expect(resolveExploreTab('knowledge')).toBe('knowledge')
    expect(primaryTabOf('knowledge')).toBe('understand')
  })

  it('defaults understand primary to ask', () => {
    expect(defaultTabForPrimary('understand')).toBe('ask')
  })

  it('falls back unknown tabs to graph', () => {
    expect(resolveExploreTab('bogus')).toBe('graph')
  })
})
