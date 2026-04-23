/**
 * FILE: apps/admin/src/lib/useBrushSelection.test.ts
 * PURPOSE: Unit tests for the pure helpers behind the brush hook. The
 *          hook itself needs a React renderer to test (we don't ship
 *          @testing-library/react in this package), so we extract and
 *          export the coordinate-mapping and range-normalisation logic
 *          and verify those directly.
 */

import { describe, expect, it } from 'vitest'
import { brushIndexFromClient, normaliseBrushRange } from './useBrushSelection'

describe('brushIndexFromClient', () => {
  it('clamps to 0 when the pointer is left of the chart', () => {
    expect(brushIndexFromClient(-50, { left: 0, width: 100 }, 10)).toBe(0)
  })

  it('clamps to dataLength - 1 when the pointer is right of the chart', () => {
    expect(brushIndexFromClient(999, { left: 0, width: 100 }, 10)).toBe(9)
  })

  it('maps a midpoint to the middle index', () => {
    expect(brushIndexFromClient(50, { left: 0, width: 100 }, 11)).toBe(5)
  })

  it('respects a non-zero left offset', () => {
    expect(brushIndexFromClient(110, { left: 100, width: 100 }, 11)).toBe(1)
  })

  it('handles zero-width charts defensively', () => {
    expect(brushIndexFromClient(50, { left: 0, width: 0 }, 10)).toBe(0)
  })
})

describe('normaliseBrushRange', () => {
  it('orders low-to-high regardless of drag direction', () => {
    expect(normaliseBrushRange(8, 2)).toEqual({ start: 2, end: 8 })
    expect(normaliseBrushRange(2, 8)).toEqual({ start: 2, end: 8 })
  })

  it('returns null for zero-movement "click" interactions', () => {
    expect(normaliseBrushRange(5, 5)).toBeNull()
  })
})
