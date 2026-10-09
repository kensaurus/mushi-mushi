/**
 * Minimal chainable stand-in for the supabase-js query builder.
 *
 * Every `db.from(table).<op>(payload).<filter>(...)…` chain is recorded as a
 * `FakeQuery` and resolved through the test's `resolve` callback when the
 * chain is awaited, so a test can assert exactly what would have hit
 * Postgres (table, op, payload, filters) and script the reply per query.
 * `db.rpc(name, args)` is recorded with `op: 'rpc'`.
 */

export interface FakeQuery {
  table: string
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' | 'rpc'
  payload?: unknown
  columns?: string
  filters: Array<{ method: string; args: unknown[] }>
  modifiers: string[]
}

export interface FakeResult {
  data?: unknown
  error?: { code?: string; message: string } | null
}

export type FakeResolver = (q: FakeQuery) => FakeResult | Promise<FakeResult>

const FILTER_METHODS = [
  'eq', 'neq', 'is', 'in', 'lt', 'lte', 'gt', 'gte', 'or', 'not', 'like', 'ilike',
  'contains', 'match', 'range', 'order', 'limit',
] as const

export function createFakeDb(resolve: FakeResolver) {
  const queries: FakeQuery[] = []

  function from(table: string) {
    const q: FakeQuery = { table, op: 'select', filters: [], modifiers: [] }
    // deno-lint-ignore no-explicit-any
    const chain: Record<string, any> = {}
    for (const m of FILTER_METHODS) {
      chain[m] = (...args: unknown[]) => {
        q.filters.push({ method: m, args })
        return chain
      }
    }
    chain.select = (columns?: string) => {
      if (q.op === 'select') q.columns = columns
      q.modifiers.push('select')
      return chain
    }
    chain.insert = (payload: unknown) => {
      q.op = 'insert'
      q.payload = payload
      return chain
    }
    chain.update = (payload: unknown) => {
      q.op = 'update'
      q.payload = payload
      return chain
    }
    chain.upsert = (payload: unknown) => {
      q.op = 'upsert'
      q.payload = payload
      return chain
    }
    chain.delete = () => {
      q.op = 'delete'
      return chain
    }
    chain.single = () => {
      q.modifiers.push('single')
      return chain
    }
    chain.maybeSingle = () => {
      q.modifiers.push('maybeSingle')
      return chain
    }
    chain.then = (
      onFulfilled?: (v: FakeResult) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => {
      queries.push(q)
      return Promise.resolve()
        .then(() => resolve(q))
        .then((r) => ({ data: null, error: null, ...(r ?? {}) }))
        .then(onFulfilled, onRejected)
    }
    chain.catch = (onRejected: (e: unknown) => unknown) => chain.then(undefined, onRejected)
    return chain
  }

  function rpc(name: string, args?: unknown) {
    const q: FakeQuery = { table: name, op: 'rpc', payload: args, filters: [], modifiers: [] }
    queries.push(q)
    return Promise.resolve()
      .then(() => resolve(q))
      .then((r) => ({ data: null, error: null, ...(r ?? {}) }))
  }

  return { db: { from, rpc } as unknown as import('@supabase/supabase-js').SupabaseClient, queries }
}

/** Value passed to the first `.eq(column, value)` filter on the query. */
export function eqValue(q: FakeQuery, column: string): unknown {
  return q.filters.find((f) => f.method === 'eq' && f.args[0] === column)?.args[1]
}

export function hasFilter(q: FakeQuery, method: string, column?: string): boolean {
  return q.filters.some((f) => f.method === method && (column === undefined || f.args[0] === column))
}

export function findQueries(queries: FakeQuery[], table: string, op?: FakeQuery['op']): FakeQuery[] {
  return queries.filter((q) => q.table === table && (op === undefined || q.op === op))
}
