/**
 * FILE: release-credit-summary.test.ts
 * PURPOSE: The console's release timeline shows "N of M reporters told" per
 *          release. `told` counts delivered messages only, every credit row
 *          is read past PostgREST's 1,000-row page, and a failed or capped
 *          read returns null so the console says "unknown", never a wrong 0.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  loadReleaseCreditSummaries,
  summarizeReleaseCredits,
} from '../../supabase/functions/_shared/release-credit-summary.ts'

type Row = { release_id: string; notified_at: string | null }

/** A release_credits table that serves `range(from, to)` pages and records them. */
function fakeDb(rows: Row[], opts: { failOnPage?: number } = {}) {
  const ranges: Array<[number, number]> = []
  const db = {
    from(table: string) {
      expect(table).toBe('release_credits')
      let ids: string[] = []
      const q = {
        select: () => q,
        in: (_col: string, v: string[]) => {
          ids = v
          return q
        },
        order: () => q,
        range: async (from: number, to: number) => {
          ranges.push([from, to])
          if (opts.failOnPage === ranges.length - 1) return { data: null, error: { message: 'boom' } }
          return { data: rows.filter((r) => ids.includes(r.release_id)).slice(from, to + 1), error: null }
        },
      }
      return q
    },
  }
  return { db: db as never, ranges }
}

describe('summarizeReleaseCredits', () => {
  it('counts credits and delivered messages per release', () => {
    const out = summarizeReleaseCredits([
      { release_id: 'r1', notified_at: '2026-10-20T00:00:00Z' },
      { release_id: 'r1', notified_at: null },
      { release_id: 'r2', notified_at: null },
    ])
    expect(out.get('r1')).toEqual({ credited: 2, told: 1 })
    expect(out.get('r2')).toEqual({ credited: 1, told: 0 })
    expect(out.has('r3')).toBe(false)
  })
})

describe('loadReleaseCreditSummaries', () => {
  it('reads past the first 1,000 rows', async () => {
    const rows: Row[] = Array.from({ length: 1500 }, (_, i) => ({ release_id: 'r1', notified_at: i < 1200 ? '2026-10-20T00:00:00Z' : null }))
    const { db, ranges } = fakeDb(rows)
    const out = await loadReleaseCreditSummaries(db, ['r1'])
    expect(out?.get('r1')).toEqual({ credited: 1500, told: 1200 })
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ])
  })

  it('returns null on a failed read, never a partial count', async () => {
    const rows: Row[] = Array.from({ length: 1500 }, () => ({ release_id: 'r1', notified_at: null }))
    const { db } = fakeDb(rows, { failOnPage: 1 })
    expect(await loadReleaseCreditSummaries(db, ['r1'])).toBeNull()
  })

  it('reads nothing for no releases', async () => {
    const { db, ranges } = fakeDb([])
    expect((await loadReleaseCreditSummaries(db, []))?.size).toBe(0)
    expect(ranges).toEqual([])
  })
})

describe('GET /v1/admin/releases', () => {
  it('attaches the summary only when asked, and only when it was read', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/releases.ts'), 'utf8')
    expect(src).toMatch(/c\.req\.query\('credits'\) === '1'/)
    expect(src).toMatch(/if \(summaries\) \{/)
  })
})
