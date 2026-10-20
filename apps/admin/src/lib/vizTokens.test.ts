/**
 * FILE: apps/admin/src/lib/vizTokens.test.ts
 * PURPOSE: readVizToken returns the live stylesheet value and does not
 *          carry a second chart palette.
 */

import { describe, expect, it } from 'vitest'
import { extBadgeColor, readVizToken } from './vizTokens'

describe('vizTokens', () => {
  it('maps file extensions through langVizColor', () => {
    expect(extBadgeColor('tsx')).toBe(readVizToken('viz-lang-react'))
    expect(extBadgeColor('py')).toBe(readVizToken('viz-lang-python'))
    expect(extBadgeColor('unknown-ext')).toBe(readVizToken('viz-lang-default'))
  })

  it('returns the stylesheet value when the custom property is set', () => {
    const root = document.documentElement
    root.style.setProperty('--color-viz-node-bg-dark', 'oklch(0.19 0.007 265)')
    try {
      expect(readVizToken('viz-node-bg-dark')).toBe('oklch(0.19 0.007 265)')
      root.style.setProperty('--color-viz-node-bg-dark', 'oklch(0.41 0.02 20)')
      expect(readVizToken('viz-node-bg-dark')).toBe('oklch(0.41 0.02 20)')
    } finally {
      root.style.removeProperty('--color-viz-node-bg-dark')
    }
  })

  it('uses one unset colour when the stylesheet has no token', () => {
    document.documentElement.style.removeProperty('--color-viz-node-bg-dark')
    document.documentElement.style.removeProperty('--color-viz-flow-danger')
    document.documentElement.style.removeProperty('--color-viz-lang-javascript')
    const unset = readVizToken('viz-node-bg-dark')
    expect(readVizToken('viz-flow-danger')).toBe(unset)
    expect(readVizToken('viz-lang-javascript')).toBe(unset)
    expect(unset).toBe('oklch(0.55 0.01 285)')
  })
})
