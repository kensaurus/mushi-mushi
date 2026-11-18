import { describe, expect, it } from 'vitest'
import { filterIsolated } from './isolatedNodes'
import type { GraphEdge, GraphNode } from './types'

const node = (id: string): GraphNode => ({ id, node_type: 'report_group', label: id })
const edge = (s: string, t: string, type = 'related_to'): GraphEdge => ({ id: `${s}-${t}`, source_node_id: s, target_node_id: t, edge_type: type, weight: 1 })
const all = () => true

describe('filterIsolated', () => {
  it('hides unlinked nodes when some nodes are linked', () => {
    const r = filterIsolated([node('a'), node('b'), node('c')], [edge('a', 'b')], all, true)
    expect(r.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(r).toMatchObject({ hidden: 1, allIsolated: false })
  })

  it('keeps every node when none is linked, instead of an empty map', () => {
    const r = filterIsolated([node('a'), node('b')], [], all, true)
    expect(r.nodes).toHaveLength(2)
    expect(r).toMatchObject({ hidden: 0, allIsolated: true })
  })

  it('only counts enabled edge types, and does nothing when the option is off', () => {
    const off = filterIsolated([node('a'), node('b'), node('c')], [edge('a', 'b', 'causes')], (t) => t !== 'causes', true)
    expect(off).toMatchObject({ hidden: 0, allIsolated: true })
    expect(filterIsolated([node('a'), node('c')], [], all, false)).toMatchObject({ hidden: 0, allIsolated: false })
  })
})
