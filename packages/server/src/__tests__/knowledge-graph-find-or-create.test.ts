/**
 * FILE: knowledge-graph-find-or-create.test.ts
 * PURPOSE: findOrCreateNode (_shared/knowledge-graph.ts) never adds a copy of
 *          a node that already exists. It used `.single()`, which finds
 *          nothing once two rows exist, so each later call inserted another
 *          (98 extra rows on prod, 2026-11-13). Now it takes the oldest row,
 *          and after losing an insert race (23505) it uses the winner's row.
 */

import { describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/age-graph.ts', () => ({ mirrorNodeToAge: () => {}, mirrorEdgeToAge: () => {} }))

const { findOrCreateNode } = await import('../../supabase/functions/_shared/knowledge-graph.ts')

const P = 'p1'

describe('findOrCreateNode', () => {
  it('returns the oldest node when copies already exist, and adds none', async () => {
    const db = makeFakeDb(
      {
        graph_nodes: [
          { id: 'newer', project_id: P, node_type: 'page', label: '/company', created_at: '2026-11-09T00:00:00Z' },
          { id: 'oldest', project_id: P, node_type: 'page', label: '/company', created_at: '2026-07-30T00:00:00Z' },
        ],
      },
      { strictSingle: true, autoId: true },
    )
    expect(await findOrCreateNode(db as never, P, 'page', '/company')).toBe('oldest')
    expect(db.table('graph_nodes')).toHaveLength(2)
  })

  it('creates a node once and reuses it after', async () => {
    const db = makeFakeDb({ graph_nodes: [] }, { strictSingle: true, autoId: true })
    const a = await findOrCreateNode(db as never, P, 'component', 'Checkout')
    const b = await findOrCreateNode(db as never, P, 'component', 'Checkout')
    expect(a).toBe(b)
    expect(db.table('graph_nodes')).toHaveLength(1)
  })

  it('uses the winning row after losing an insert race', async () => {
    const db = makeFakeDb(
      { graph_nodes: [] },
      { uniques: { graph_nodes: ['project_id', 'node_type', 'label'] }, autoId: true },
    )
    // The lookup misses, then a concurrent request inserts the same node first.
    const from = db.from.bind(db)
    let lookups = 0
    db.from = ((table: string) => {
      const q = from(table)
      const insert = q.insert.bind(q)
      q.insert = ((row: Record<string, unknown>) => {
        db.table('graph_nodes').push({ id: 'winner', created_at: '2026-11-13T00:00:00Z', ...row })
        return insert(row)
      }) as typeof q.insert
      const maybeSingle = q.maybeSingle.bind(q)
      q.maybeSingle = (() => {
        lookups += 1
        return maybeSingle()
      }) as typeof q.maybeSingle
      return q
    }) as typeof db.from
    expect(await findOrCreateNode(db as never, P, 'page', '/pricing')).toBe('winner')
    expect(lookups).toBe(2)
    expect(db.table('graph_nodes')).toHaveLength(1)
  })
})
