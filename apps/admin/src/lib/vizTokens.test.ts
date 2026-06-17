/**
 * FILE: apps/admin/src/lib/vizTokens.test.ts
 * PURPOSE: Unit tests for viz token readers used in SVG/canvas surfaces.
 */

import { describe, expect, it } from 'vitest'
import { langVizColor, readVizToken, stepStatusColor } from './vizTokens'

describe('readVizToken', () => {
  it('returns SSR-safe fallbacks when document is unavailable', () => {
    expect(readVizToken('viz-flow-info')).toMatch(/^oklch\(/)
    expect(readVizToken('viz-unknown-token', 'oklch(0.5 0 0)')).toBe('oklch(0.5 0 0)')
  })
})

describe('stepStatusColor', () => {
  it('maps known pipeline statuses to viz step tokens', () => {
    expect(stepStatusColor('passed')).toBe(readVizToken('viz-step-passed'))
    expect(stepStatusColor('failed')).toBe(readVizToken('viz-step-failed'))
  })

  it('falls back to pending for unknown statuses', () => {
    expect(stepStatusColor('unknown')).toBe(readVizToken('viz-step-pending'))
  })
})

describe('langVizColor', () => {
  it('maps common language slugs to lang viz tokens', () => {
    expect(langVizColor('typescript')).toBe(readVizToken('viz-lang-typescript'))
    expect(langVizColor('tsx')).toBe(readVizToken('viz-lang-react'))
  })

  it('falls back to default for unknown languages', () => {
    expect(langVizColor('cobol')).toBe(readVizToken('viz-lang-default'))
  })
})
