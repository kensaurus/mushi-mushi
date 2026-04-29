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
}))

import { deleteOldReportsBatch } from '../../supabase/functions/retention-sweep/index.ts'

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
})
