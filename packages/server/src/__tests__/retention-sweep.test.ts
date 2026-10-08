import { describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => ({}),
}))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})

vi.mock('../../supabase/functions/_shared/telemetry.ts', () => ({
  startCronRun: async () => ({ finish: async () => {}, fail: async () => {} }),
}))

vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({
  withSentry: (_name: string, handler: unknown) => handler,
}))

vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  requireServiceRoleAuth: () => null,
}))

vi.mock('../../supabase/functions/_shared/plans.ts', () => ({
  listPlans: async () => [],
  resolvePlanFromSubscription: async () => ({ id: 'hobby', retention_days: 7 }),
  getPlan: async () => ({ id: 'hobby', retention_days: 7 }),
}))

import {
  deleteOldReportsBatch,
  keepsFirstReport,
  MIN_TRACE_RETENTION_DAYS,
  sweepLlmTraces,
  sweepUxCaptures,
  traceRetentionDays,
} from '../../supabase/functions/retention-sweep/index.ts'

class QueryChain {
  calls: string[] = []

  constructor(private readonly result: { data: unknown; error: { message: string } | null }) {}

  select(_columns: string) {
    this.calls.push('select')
    return this
  }

  eq(_column: string, _value: unknown) {
    this.calls.push('eq')
    return this
  }

  lt(_column: string, _value: unknown) {
    this.calls.push('lt')
    return this
  }

  neq(column: string, value: unknown) {
    this.calls.push(`neq:${column}=${String(value)}`)
    return this
  }

  order(_column: string, _opts: unknown) {
    this.calls.push('order')
    return this
  }

  limit(_count: number) {
    this.calls.push('limit')
    return this
  }

  delete() {
    this.calls.push('delete')
    return this
  }

  in(_column: string, _values: unknown[]) {
    this.calls.push('in')
    return this
  }

  async returns<T>() {
    return this.result as { data: T; error: { message: string } | null }
  }
}

function makeDb(chains: QueryChain[]) {
  return {
    from: vi.fn((_table: string) => {
      const next = chains.shift()
      if (!next) throw new Error('Unexpected query')
      return next
    }),
  }
}

describe('deleteOldReportsBatch', () => {
  it('selects candidate ids first, then deletes by primary key', async () => {
    const select = new QueryChain({ data: [{ id: 'r1' }, { id: 'r2' }], error: null })
    const del = new QueryChain({ data: [{ id: 'r1' }, { id: 'r2' }], error: null })
    const db = makeDb([select, del])

    await expect(deleteOldReportsBatch(db as never, 'proj_1', '2026-04-01T00:00:00Z', 2)).resolves.toEqual({
      deleted: 2,
      error: null,
    })

    expect(db.from).toHaveBeenCalledTimes(2)
    expect(select.calls).toEqual(['select', 'eq', 'lt', 'order', 'limit'])
    expect(del.calls).toEqual(['delete', 'in', 'select'])
  })

  it('does not issue a delete when no candidates are selected', async () => {
    const select = new QueryChain({ data: [], error: null })
    const db = makeDb([select])

    await expect(deleteOldReportsBatch(db as never, 'proj_1', '2026-04-01T00:00:00Z')).resolves.toEqual({
      deleted: 0,
      error: null,
    })

    expect(db.from).toHaveBeenCalledTimes(1)
  })

  it('returns select/delete errors to the sweep logger instead of throwing', async () => {
    const selectErr = new QueryChain({ data: null, error: { message: 'select failed' } })
    await expect(
      deleteOldReportsBatch(makeDb([selectErr]) as never, 'proj_1', '2026-04-01T00:00:00Z'),
    ).resolves.toEqual({ deleted: 0, error: 'select failed' })

    const select = new QueryChain({ data: [{ id: 'r1' }], error: null })
    const delErr = new QueryChain({ data: null, error: { message: 'delete failed' } })
    await expect(
      deleteOldReportsBatch(makeDb([select, delErr]) as never, 'proj_1', '2026-04-01T00:00:00Z'),
    ).resolves.toEqual({ deleted: 0, error: 'delete failed' })
  })

  // Sentry MUSHI-MUSHI-SERVER-N: PostgREST occasionally returns
  // `column reports.created_at does not exist` for the few seconds after an
  // ALTER TABLE migration ships, while its in-memory schema cache catches up.
  // The sweep must absorb that one transient hit and retry, since
  // `reports.created_at` clearly does exist (the table has carried it since
  // the day-zero schema). A second permanent failure still surfaces as an
  // error so genuine schema drift is not masked.
  it('retries the candidate select once on a transient PostgREST schema-cache miss', async () => {
    const cacheMiss = new QueryChain({
      data: null,
      error: { message: 'column reports.created_at does not exist' },
    })
    const retrySuccess = new QueryChain({ data: [{ id: 'r1' }], error: null })
    const del = new QueryChain({ data: [{ id: 'r1' }], error: null })

    await expect(
      deleteOldReportsBatch(
        makeDb([cacheMiss, retrySuccess, del]) as never,
        'proj_1',
        '2026-04-01T00:00:00Z',
      ),
    ).resolves.toEqual({ deleted: 1, error: null })
  })

  it('surfaces the error if the schema-cache miss persists across the retry', async () => {
    const firstMiss = new QueryChain({
      data: null,
      error: { message: 'column reports.created_at does not exist' },
    })
    const secondMiss = new QueryChain({
      data: null,
      error: { message: 'column reports.created_at does not exist' },
    })

    await expect(
      deleteOldReportsBatch(
        makeDb([firstMiss, secondMiss]) as never,
        'proj_1',
        '2026-04-01T00:00:00Z',
      ),
    ).resolves.toEqual({
      deleted: 0,
      error: 'column reports.created_at does not exist',
    })
  })

  // A new free-plan user who returns after the 7-day window must still find
  // their first diagnosed report, not an empty project.
  it('never selects the kept first report as a deletion candidate', async () => {
    const select = new QueryChain({ data: [{ id: 'r2' }], error: null })
    const del = new QueryChain({ data: [{ id: 'r2' }], error: null })

    await expect(
      deleteOldReportsBatch(makeDb([select, del]) as never, 'proj_1', '2026-04-01T00:00:00Z', 2, 'r1'),
    ).resolves.toEqual({ deleted: 1, error: null })

    expect(select.calls).toEqual(['select', 'eq', 'lt', 'neq:id=r1', 'order', 'limit'])
  })
})

describe('keepsFirstReport', () => {
  const plans = [
    { id: 'free_cloud', monthly_price_usd: 0 },
    { id: 'hobby', monthly_price_usd: 0 },
    { id: 'pro', monthly_price_usd: 49 },
  ]

  it('keeps the first report on free plans, via the plan or the fallback', () => {
    expect(keepsFirstReport('plan', 'free_cloud', plans)).toBe(true)
    expect(keepsFirstReport('fallback', 'hobby', plans)).toBe(true)
  })

  it('follows paid plans and explicit overrides to the letter', () => {
    expect(keepsFirstReport('plan', 'pro', plans)).toBe(false)
    expect(keepsFirstReport('override', 'override', plans)).toBe(false)
    expect(keepsFirstReport('override', 'free_cloud', plans)).toBe(false)
  })

  it('treats a plan the catalog does not list as free', () => {
    expect(keepsFirstReport('fallback', 'free_cloud', [])).toBe(true)
  })
})

describe('LLM trace retention', () => {
  it('never keeps fewer than the spend-ledger floor', () => {
    expect(MIN_TRACE_RETENTION_DAYS).toBe(35)
    expect(traceRetentionDays(90)).toBe(90)
    expect(traceRetentionDays(7)).toBe(35)
    expect(traceRetentionDays(null)).toBe(35)
    expect(traceRetentionDays(Number.NaN)).toBe(35)
  })

  it('sweeps only saved policies, skips legal holds, and deletes by id below the cutoff', async () => {
    const cutoffs: Record<string, string> = {}
    const deletedIds: string[][] = []
    let current = ''
    const db = {
      from: (table: string) => {
        if (table === 'project_retention_policies') {
          return {
            select: () => ({
              returns: async () => ({
                data: [
                  { project_id: 'p-hold', llm_traces_retention_days: 30, legal_hold: true },
                  { project_id: 'p-short', llm_traces_retention_days: 7, legal_hold: false },
                ],
                error: null,
              }),
            }),
          }
        }
        // llm_invocations: one select (2 rows) then a delete per project.
        const chain = {
          select: () => chain,
          eq: (_c: string, v: string) => ((current = v), chain),
          lt: (_c: string, v: string) => ((cutoffs[current] = v), chain),
          order: () => chain,
          limit: () => chain,
          returns: async () => ({ data: [{ id: 'a' }, { id: 'b' }], error: null }),
          delete: () => ({ in: async (_c: string, ids: string[]) => (deletedIds.push(ids), { error: null }) }),
        }
        return chain
      },
    }

    const before = Date.now()
    const out = await sweepLlmTraces(db as never)
    expect(out).toEqual({ projects: 1, deleted: 2, errors: 0 })
    expect(Object.keys(cutoffs)).toEqual(['p-short'])
    expect(deletedIds).toEqual([['a', 'b']])
    // 7 days saved → the 35-day floor applies.
    const ageDays = (before - Date.parse(cutoffs['p-short'])) / 86_400_000
    expect(Math.round(ageDays)).toBe(35)
  })
})

describe('UX capture retention', () => {
  it('selects screens and attempts by their run age, removes their files and clears the paths', async () => {
    const filters: Array<[string, string, unknown]> = []
    const removed: string[][] = []
    const cleared: Array<{ patch: unknown; ids: string[] }> = []
    const surfaces = [
      { id: 's1', thumb_before: 'p1/r1/home/before-desktop.png', thumb_after: 'p1/r1/home/after-desktop.png', thumb_diff: null, thumbs: { 'before-desktop': 'p1/r1/home/before-desktop.png', 'before-mobile': 'p1/r1/home/before-mobile.png' } },
    ]
    const attempts = [{ id: 'i1', thumbs: { 'after-mobile': 'p1/r1/home/iter1-after-mobile.png' } }]
    const db = {
      from: (table: string) => {
        if (table === 'project_settings') {
          return {
            select: () => ({
              returns: async () => ({ data: [{ project_id: 'p1', ux_capture_retention_days: 10 }, { project_id: 'p2', ux_capture_retention_days: null }], error: null }),
            }),
          }
        }
        let project = ''
        const rowsFor = () => (project !== 'p1' ? [] : table === 'ux_surfaces' ? surfaces : attempts)
        const chain = {
          select: (cols: string) => (filters.push(['select', cols, null]), chain),
          eq: (c: string, v: string) => ((project = v), filters.push(['eq', c, v]), chain),
          lt: (c: string, v: string) => (filters.push(['lt', c, v]), chain),
          or: () => chain,
          limit: () => chain,
          returns: async () => ({ data: rowsFor(), error: null }),
          update: (patch: unknown) => ({ in: async (_c: string, ids: string[]) => (cleared.push({ patch, ids }), { error: null }) }),
        }
        return chain
      },
      storage: { from: () => ({ remove: async (paths: string[]) => (removed.push(paths), { error: null }) }) },
    }
    const before = Date.now()
    const res = await sweepUxCaptures(db as never)
    expect(res.deleted).toBe(4)
    // Filtered through the joined run, not a capped list of old run ids.
    expect(filters.find((f) => f[0] === 'select')?.[1]).toContain('ux_runs!inner(started_at)')
    const lts = filters.filter((f) => f[0] === 'lt')
    expect(lts.map((f) => f[1])).toEqual(Array(4).fill('ux_runs.started_at'))
    // p1 keeps 10 days; p2 falls back to 30.
    const day = 24 * 60 * 60 * 1000
    expect(Math.round((before - Date.parse(lts[0][2] as string)) / day)).toBe(10)
    expect(Math.round((before - Date.parse(lts[2][2] as string)) / day)).toBe(30)
    expect(removed).toEqual([
      ['p1/r1/home/before-desktop.png', 'p1/r1/home/after-desktop.png', 'p1/r1/home/before-mobile.png'],
      ['p1/r1/home/iter1-after-mobile.png'],
    ])
    expect(cleared).toEqual([
      { patch: { thumb_before: null, thumb_after: null, thumb_diff: null, thumbs: {} }, ids: ['s1'] },
      { patch: { thumbs: {} }, ids: ['i1'] },
    ])
  })

  it('keeps the paths when the storage delete fails', async () => {
    const cleared: string[][] = []
    const chain = {
      select: () => chain,
      eq: () => chain,
      lt: () => chain,
      or: () => chain,
      limit: () => chain,
      returns: async () => ({ data: [{ id: 's1', thumb_before: 'p1/r1/a/before-desktop.png', thumb_after: null, thumb_diff: null }], error: null }),
      update: () => ({ in: async (_c: string, ids: string[]) => (cleared.push(ids), { error: null }) }),
    }
    const db = {
      from: (table: string) =>
        table === 'project_settings'
          ? { select: () => ({ returns: async () => ({ data: [{ project_id: 'p1', ux_capture_retention_days: 30 }], error: null }) }) }
          : chain,
      storage: { from: () => ({ remove: async () => ({ error: { message: 'down' } }) }) },
    }
    expect((await sweepUxCaptures(db as never)).deleted).toBe(0)
    expect(cleared).toHaveLength(0)
  })
})
