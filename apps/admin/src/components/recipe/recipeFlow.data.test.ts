/**
 * FILE: apps/admin/src/components/recipe/recipeFlow.data.test.ts
 * PURPOSE: The recipe diagram stays readable (console finding B22: fitView
 *          shrank the four lanes to ~0.5x, so card text rendered at ~6 px).
 *          Pins the zoom floor against the smallest font, and the layout so
 *          stacked cards never overlap at their laid-out height.
 */

import { describe, expect, it } from 'vitest'
import { RECIPE_ELEMENT_KEYS } from '../../lib/recipeTypes'
import {
  RECIPE_CARD_MAX_HEIGHT,
  RECIPE_LANE_HEADER_Y,
  RECIPE_MIN_ZOOM,
  RECIPE_POSITIONS,
  RECIPE_SMALLEST_FONT_PX,
  recipeDiagramBounds,
} from './recipeFlow.data'

describe('recipe diagram readability', () => {
  it('never renders card text below 12 px: zoom floor x smallest font >= 12', () => {
    expect(RECIPE_MIN_ZOOM * RECIPE_SMALLEST_FONT_PX).toBeGreaterThanOrEqual(12)
  })

  it('cards in the same lane never overlap at their laid-out height, and sit below the lane headings', () => {
    const byLane = new Map<number, number[]>()
    for (const key of RECIPE_ELEMENT_KEYS) {
      const p = RECIPE_POSITIONS[key]
      byLane.set(p.x, [...(byLane.get(p.x) ?? []), p.y])
    }
    for (const ys of byLane.values()) {
      const sorted = [...ys].sort((a, b) => a - b)
      expect(sorted[0]).toBeGreaterThan(RECIPE_LANE_HEADER_Y)
      for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(RECIPE_CARD_MAX_HEIGHT)
    }
  })

  it('the canvas (h-232, 928 px) holds the whole diagram height at 100%', () => {
    const { height } = recipeDiagramBounds()
    expect(height + 32).toBeLessThanOrEqual(928)
  })
})
