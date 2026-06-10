import { describe, expect, it } from 'vitest'
import {
  hasPageOwnedHero,
  PAGE_ROUTES_SKIP_LAYOUT_HERO,
  PAGE_ROUTES_WITH_OWN_HERO,
  shouldSkipLayoutHero,
} from './pageHeroOwnership'

describe('pageHeroOwnership', () => {
  it('lists all page-owned hero routes', () => {
    expect(PAGE_ROUTES_WITH_OWN_HERO.size).toBe(16)
    expect(hasPageOwnedHero('/query')).toBe(true)
    expect(hasPageOwnedHero('/queue')).toBe(true)
    expect(hasPageOwnedHero('/anti-gaming')).toBe(true)
  })

  it('skips layout fallback for owned and worklist routes', () => {
    expect(shouldSkipLayoutHero('/health')).toBe(true)
    expect(shouldSkipLayoutHero('/reports')).toBe(true)
    expect(shouldSkipLayoutHero('/fixes')).toBe(true)
    expect(shouldSkipLayoutHero('/dashboard')).toBe(false)
  })

  it('worklist routes are not page-owned heroes', () => {
    expect(PAGE_ROUTES_SKIP_LAYOUT_HERO.has('/reports')).toBe(true)
    expect(hasPageOwnedHero('/reports')).toBe(false)
  })
})
