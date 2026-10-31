/**
 * _shared/setup-gap-invalidate.ts: a settings change that a Health check reads
 * drops the stored setup-gap answer, so Home's "Fix these first" re-checks
 * instead of showing a problem the owner just fixed (2026-10-29).
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const child = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return { log: { child: () => child, warn: vi.fn(), info: vi.fn(), error: vi.fn() } }
})

import {
  invalidateSetupGapsForKey,
  invalidateSetupGapsForOrg,
  invalidateStoredSetupGaps,
} from '../../supabase/functions/_shared/setup-gap-invalidate.ts'

type Rows = Record<string, Array<Record<string, unknown>>>

/** A tiny query fake: select + eq/in filters, and delete().in() recorded. */
function fakeDb(rows: Rows, opts: { deleteError?: { code?: string; message: string } } = {}) {
  const deleted: string[][] = []
  const db = {
    from(table: string) {
      const filters: Array<(r: Record<string, unknown>) => boolean> = []
      let mode: 'select' | 'delete' = 'select'
      const q = {
        select() { mode = 'select'; return q },
        delete() { mode = 'delete'; return q },
        eq(col: string, v: unknown) { filters.push((r) => r[col] === v); return q },
        in(col: string, vs: unknown[]) {
          if (mode === 'delete') {
            deleted.push(vs as string[])
            return Promise.resolve({ error: opts.deleteError ?? null })
          }
          filters.push((r) => vs.includes(r[col]))
          return q
        },
        then(resolve: (v: { data: unknown[]; error: null }) => void) {
          resolve({ data: (rows[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null })
        },
      }
      return q
    },
  }
  return { db: db as never, deleted }
}

const ROWS: Rows = {
  organizations: [{ id: 'org-a', owner_id: 'user-1' }, { id: 'org-b', owner_id: 'user-2' }],
  projects: [
    { id: 'p1', organization_id: 'org-a' },
    { id: 'p2', organization_id: 'org-a' },
    { id: 'p3', organization_id: 'org-b' },
  ],
}

describe('setup-gap invalidation', () => {
  it('an app key drops only that app', async () => {
    const { db, deleted } = fakeDb(ROWS)
    expect(await invalidateSetupGapsForKey(db, { project_id: 'p3' })).toEqual(['p3'])
    expect(deleted).toEqual([['p3']])
  })

  it('an organization key drops every app of that organization', async () => {
    const { db, deleted } = fakeDb(ROWS)
    expect((await invalidateSetupGapsForKey(db, { organization_id: 'org-a' })).sort()).toEqual(['p1', 'p2'])
    expect(deleted[0].sort()).toEqual(['p1', 'p2'])
  })

  it('a universal key drops the apps of the organizations its owner owns (ADR 0031)', async () => {
    const { db } = fakeDb(ROWS)
    expect(await invalidateSetupGapsForKey(db, { owner_user_id: 'user-2' })).toEqual(['p3'])
  })

  it('an organization setting drops that organization\'s apps', async () => {
    const { db } = fakeDb(ROWS)
    expect((await invalidateSetupGapsForOrg(db, 'org-a')).sort()).toEqual(['p1', 'p2'])
  })

  it('no apps means no delete call', async () => {
    const { db, deleted } = fakeDb(ROWS)
    expect(await invalidateStoredSetupGaps(db, [])).toEqual([])
    expect(deleted).toEqual([])
  })

  it('a missing table (older self-host) is nothing to drop, not a failure', async () => {
    const { db } = fakeDb(ROWS, { deleteError: { code: '42P01', message: 'relation "setup_gap_results" does not exist' } })
    expect(await invalidateStoredSetupGaps(db, ['p1'])).toEqual(['p1'])
  })

  it('a failing delete never throws and reports nothing dropped', async () => {
    const { db } = fakeDb(ROWS, { deleteError: { code: '42501', message: 'permission denied for table setup_gap_results' } })
    await expect(invalidateStoredSetupGaps(db, ['p1'])).resolves.toEqual([])
  })
})
