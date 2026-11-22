import { describe, expect, it } from 'vitest'
import { graphCanvasProof } from './graphCanvasCounts'

describe('graphCanvasProof', () => {
  it('says when the canvas only holds the newest slice', () => {
    expect(graphCanvasProof('nodes', 150, 200, 350)).toBe('150 of 200 items (the newest 200 of 350)')
  })

  it('stays short when everything is loaded and nothing is filtered', () => {
    expect(graphCanvasProof('edges', 40, 40, 40)).toBe('40 links')
    expect(graphCanvasProof('edges', 40, 40, undefined)).toBe('40 links')
    expect(graphCanvasProof('nodes', 1, 1, 1)).toBe('1 item')
  })

  it('says "of N" only when a filter hides some, and "no links" at zero', () => {
    expect(graphCanvasProof('nodes', 2, 5, 5)).toBe('2 of 5 items')
    expect(graphCanvasProof('edges', 0, 0, 0)).toBe('no links')
  })
})
