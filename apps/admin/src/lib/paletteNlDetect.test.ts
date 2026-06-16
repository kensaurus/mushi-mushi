/**
 * FILE: apps/admin/src/lib/paletteNlDetect.test.ts
 * PURPOSE: Unit tests for Cmd+K NL detection and live-search gating.
 */

import { describe, expect, it } from 'vitest'
import { isNavigateQuery, shouldRunPaletteLiveSearch } from './paletteNlDetect'

describe('isNavigateQuery', () => {
  it('detects question starters', () => {
    expect(isNavigateQuery('how do I connect GitHub?')).toBe(true)
    expect(isNavigateQuery('where do I triage')).toBe(true)
  })

  it('detects long natural phrases', () => {
    expect(
      isNavigateQuery('show me the page for reviewing pull requests'),
    ).toBe(true)
  })

  it('rejects short keyword search', () => {
    expect(isNavigateQuery('reports')).toBe(false)
    expect(isNavigateQuery('fix pr')).toBe(false)
  })
})

describe('shouldRunPaletteLiveSearch', () => {
  it('runs for short keyword queries', () => {
    expect(shouldRunPaletteLiveSearch('checkout bug')).toBe(true)
  })

  it('skips NL assist queries', () => {
    expect(shouldRunPaletteLiveSearch('how do I connect GitHub?')).toBe(false)
    expect(
      shouldRunPaletteLiveSearch('<img src=x onerror=alert(1)> how triage'),
    ).toBe(false)
  })

  it('skips while composing mentions or slash commands', () => {
    expect(
      shouldRunPaletteLiveSearch('@page:rep', { composingMention: true }),
    ).toBe(false)
    expect(
      shouldRunPaletteLiveSearch('/howto', { composingSlash: true }),
    ).toBe(false)
  })
})
