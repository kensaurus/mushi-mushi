import { describe, expect, it } from 'vitest'
import { planGraphSnapshot } from './graphSnapshot'

const base = { reportNodes: 0, edgeCount: 0, fragileComponents: 0, inventoryNodes: 0 }

describe('planGraphSnapshot', () => {
  // Round 3: the status line names the groups and links; the zero line says only what it does not.
  it('collapses an all-zero snapshot into one line without restating the status line', () => {
    expect(planGraphSnapshot(base)).toEqual({ tiles: [], zeroLine: 'No inventory items' })
  })

  it('draws tiles only for counts above zero, and never calls hotspots 0 without links', () => {
    const plan = planGraphSnapshot({ ...base, reportNodes: 2 })
    expect(plan.tiles).toEqual(['clusters'])
    expect(plan.zeroLine).toBe('No inventory items')
    expect(plan.zeroLine).not.toContain('hotspots')
  })

  it('says "no hotspots" once links exist to judge, and drops the line when nothing is zero', () => {
    expect(planGraphSnapshot({ ...base, reportNodes: 3, edgeCount: 4, inventoryNodes: 1 }).zeroLine).toBe('No hotspots')
    expect(planGraphSnapshot({ reportNodes: 3, edgeCount: 4, fragileComponents: 1, inventoryNodes: 1 })).toEqual({
      tiles: ['clusters', 'links', 'fragile', 'inventory'],
      zeroLine: null,
    })
  })
})
