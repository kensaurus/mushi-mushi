import { describe, expect, it } from 'vitest'
import { graphCanvasProof } from './graphCanvasCounts'

describe('graphCanvasProof', () => {
  it('says when the canvas only holds the newest slice', () => {
    expect(graphCanvasProof('nodes', 150, 200, 350)).toBe('150/200 nodes (newest 200 of 350)')
  })

  it('stays short when everything is loaded', () => {
    expect(graphCanvasProof('edges', 40, 40, 40)).toBe('40/40 edges')
    expect(graphCanvasProof('edges', 40, 40, undefined)).toBe('40/40 edges')
  })
})
