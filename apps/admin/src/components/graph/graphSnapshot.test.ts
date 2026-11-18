import { describe, expect, it } from 'vitest'
import { planGraphSnapshot } from './graphSnapshot'

const base = { reportNodes: 0, edgeCount: 0, fragileComponents: 0, inventoryNodes: 0 }

describe('planGraphSnapshot', () => {
  it('collapses an all-zero snapshot into one line and never calls hotspots 0 without links', () => {
    expect(planGraphSnapshot(base)).toEqual({
      tiles: [],
      zeroLine: 'No clusters · no links · hotspots: not enough links to tell · no inventory items',
    })
  })

  it('draws tiles only for counts above zero', () => {
    const plan = planGraphSnapshot({ ...base, reportNodes: 2 })
    expect(plan.tiles).toEqual(['clusters'])
    expect(plan.zeroLine).toContain('hotspots: not enough links to tell')
  })

  it('says "no hotspots" once links exist to judge, and drops the line when nothing is zero', () => {
    expect(planGraphSnapshot({ ...base, reportNodes: 3, edgeCount: 4, inventoryNodes: 1 }).zeroLine).toBe('No hotspots')
    expect(planGraphSnapshot({ reportNodes: 3, edgeCount: 4, fragileComponents: 1, inventoryNodes: 1 })).toEqual({
      tiles: ['clusters', 'links', 'fragile', 'inventory'],
      zeroLine: null,
    })
  })
})
