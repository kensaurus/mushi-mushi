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

  // Layers is the default map view: the force graph drew 850 files as a strip (2026-10-08 review).
  it('falls back unknown tabs to layers', () => {
    expect(resolveExploreTab('bogus')).toBe('layers')
  })
})
