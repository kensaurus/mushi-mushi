/**
 * FILE: packages/server/src/__tests__/lesson-cluster-retire.test.ts
 * PURPOSE: Retiring a lesson retires the cluster it came from, so the
 *          clusterer (which skips only retired clusters) stops adding real
 *          reports to it. Only a still-`promoted` cluster in the lesson's
 *          own project changes.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  retirePromotedCluster,
  type ClusterRetireDb,
} from '../../supabase/functions/_shared/lesson-cluster-retire.ts'

interface ClusterRow {
  id: string
  project_id: string
  status: 'candidate' | 'promoted' | 'retired'
}

/** In-memory mistake_clusters that applies the update's eq filters for real. */
function fakeDb(rows: ClusterRow[], fail = false) {
  const calls: Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }> = []
  const db: ClusterRetireDb = {
    from: () => ({
      update: (patch) => {
        const filters: Record<string, unknown> = {}
        const query = {
          eq(column: string, value: unknown) {
            filters[column] = value
            return query
          },
          select() {
            calls.push({ patch, filters })
            if (fail) return Promise.resolve({ data: null, error: { message: 'boom' } })
            const hit = rows.filter((r) =>
              Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v),
            )
            for (const r of hit) r.status = patch.status
            return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null })
          },
        }
        return query
      },
    }),
  }
  return { db, calls }
}

describe('retirePromotedCluster', () => {
  it('retires the promoted source cluster of the lesson', async () => {
    const rows: ClusterRow[] = [{ id: 'c1', project_id: 'p1', status: 'promoted' }]
    const { db, calls } = fakeDb(rows)
    const res = await retirePromotedCluster(db, 'c1', 'p1', new Date('2026-10-07T00:00:00Z'))
    expect(res).toEqual({ retired: 1, error: null })
    expect(rows[0].status).toBe('retired')
    expect(calls[0]).toEqual({
      patch: { status: 'retired', updated_at: '2026-10-07T00:00:00.000Z' },
      filters: { id: 'c1', project_id: 'p1', status: 'promoted' },
    })
  })

  it('leaves a cluster in another project alone', async () => {
    const rows: ClusterRow[] = [{ id: 'c1', project_id: 'other', status: 'promoted' }]
    const { db } = fakeDb(rows)
    expect(await retirePromotedCluster(db, 'c1', 'p1')).toEqual({ retired: 0, error: null })
    expect(rows[0].status).toBe('promoted')
  })

  it('leaves a candidate cluster alone', async () => {
    const rows: ClusterRow[] = [{ id: 'c1', project_id: 'p1', status: 'candidate' }]
    const { db } = fakeDb(rows)
    expect(await retirePromotedCluster(db, 'c1', 'p1')).toEqual({ retired: 0, error: null })
    expect(rows[0].status).toBe('candidate')
  })

  it('does nothing for a lesson with no source cluster', async () => {
    const { db, calls } = fakeDb([])
    expect(await retirePromotedCluster(db, null, 'p1')).toEqual({ retired: 0, error: null })
    expect(calls).toHaveLength(0)
  })

  it('reports a database error instead of swallowing it', async () => {
    const { db } = fakeDb([{ id: 'c1', project_id: 'p1', status: 'promoted' }], true)
    expect(await retirePromotedCluster(db, 'c1', 'p1')).toEqual({ retired: 0, error: 'boom' })
  })
})

describe('PATCH /v1/admin/lessons/:id wiring', () => {
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/lessons.ts'), 'utf8')
  const start = src.indexOf("app.patch('/v1/admin/lessons/:id'")
  const body = src.slice(start, src.indexOf('\n  app.', start + 10))

  it('retires the source cluster only when the lesson is being retired', () => {
    expect(body).toMatch(/if \(body\.data\.retired === true\) \{[\s\S]*retirePromotedCluster\(/)
  })

  it('scopes the cluster to the lesson project and returns a failure', () => {
    expect(body).toMatch(/retirePromotedCluster\([\s\S]*rowAccess\.projectId,?\s*\)/)
    expect(body).toMatch(/if \(cluster\.error\) return dbError\(/)
  })
})
