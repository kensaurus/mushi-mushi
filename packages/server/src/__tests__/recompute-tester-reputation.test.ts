/**
 * FILE: packages/server/src/__tests__/recompute-tester-reputation.test.ts
 * PURPOSE: The daily reputation recompute (recompute-tester-reputation/reputation.ts)
 *          pages past PostgREST max_rows instead of truncating, counts the 30d
 *          signal/impact inputs in SQL, keeps impact_pct inside its 0–100
 *          CHECK, and never upserts after a failed read or hides a failed upsert.
 */

import { describe, it, expect } from 'vitest'
import { createFakeDb, findQueries, hasFilter, type FakeQuery, type FakeResult } from './__stubs__/fake-query-recorder.ts'
import {
  computeTesterReputation,
  listActiveTesterIds,
  pct,
  recomputeTesterReputation,
} from '../../supabase/functions/recompute-tester-reputation/reputation.ts'

const SINCE = '2026-09-10T00:00:00.000Z'

/** Serves `rows` the way a capped PostgREST would: at most `cap` rows per page. */
function paged(q: FakeQuery, rows: Array<Record<string, unknown>>, cap: number) {
  const range = q.filters.find((f) => f.method === 'range')
  if (!range) return { data: rows.slice(0, cap) }
  const [from, to] = range.args as [number, number]
  return { data: rows.slice(from, Math.min(to + 1, from + cap)) }
}

/** Reply to a `select(..., { count: 'exact', head: true })` query. */
function counted(n: number): FakeResult {
  return { count: n } as unknown as FakeResult
}

function kindsOf(q: FakeQuery): string[] {
  return (q.filters.find((f) => f.method === 'in' && f.args[0] === 'kind')?.args[1] as string[]) ?? []
}

describe('pct', () => {
  it('clamps to 100 and returns 0 for an empty denominator', () => {
    expect(pct(3, 2)).toBe(100)
    expect(pct(1, 3)).toBe(33.3)
    expect(pct(1, 0)).toBe(0)
  })
})

describe('listActiveTesterIds', () => {
  it('reads every page past the server cap and dedupes tester ids', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: `e${i}`, tester_id: `t${i % 1300}` }))
    const { db, queries } = createFakeDb((q) => paged(q, rows, 700))

    const ids = await listActiveTesterIds(db, SINCE)

    expect(ids).toHaveLength(1300)
    const reads = findQueries(queries, 'tester_reputation_events', 'select')
    expect(reads.length).toBeGreaterThan(1)
    expect(reads.every((q) => hasFilter(q, 'gte', 'created_at') && hasFilter(q, 'order', 'id'))).toBe(true)
  })

  it('throws on a read error instead of reporting no active testers', async () => {
    const { db } = createFakeDb(() => ({ error: { message: 'boom' } }))
    await expect(listActiveTesterIds(db, SINCE)).rejects.toThrow('boom')
  })
})

describe('computeTesterReputation', () => {
  it('sums every lifetime event and takes the 30d counts from head-only count queries', async () => {
    const lifetime = Array.from({ length: 1500 }, (_, i) => ({ id: `e${i}`, delta_score: 1 }))
    const { db } = createFakeDb((q) => {
      if (q.columns === 'id, delta_score') return paged(q, lifetime, 1000)
      const kinds = kindsOf(q)
      if (kinds.includes('bounty_severe')) return counted(9)
      if (kinds.length === 1) return counted(1)
      return counted(4)
    })

    const rep = await computeTesterReputation(db, 't1', SINCE)

    expect(rep.score).toBe(1500)
    expect(rep.signal_pct).toBe(25)
    // 9 bounty events against 4 submissions in the window: clamped to the CHECK.
    expect(rep.impact_pct).toBe(100)
  })
})

describe('recomputeTesterReputation', () => {
  it('does not upsert when the lifetime read fails', async () => {
    const { db, queries } = createFakeDb((q) => {
      if (q.columns === 'id, delta_score') return { error: { message: 'timeout' } }
      return counted(0)
    })

    await expect(recomputeTesterReputation(db, 't1', SINCE)).rejects.toThrow('timeout')
    expect(findQueries(queries, 'tester_reputation', 'upsert')).toHaveLength(0)
  })

  it('surfaces a failed upsert so the cron counts the tester as failed', async () => {
    const { db } = createFakeDb((q) => {
      if (q.op === 'upsert') return { error: { message: 'violates check constraint' } }
      if (q.columns === 'id, delta_score') return paged(q, [], 1000)
      return counted(0)
    })

    await expect(recomputeTesterReputation(db, 't1', SINCE)).rejects.toThrow('violates check constraint')
  })
})
