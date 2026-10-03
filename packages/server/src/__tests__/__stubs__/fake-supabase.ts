/**
 * Minimal in-memory stand-in for the supabase-js query builder, covering the
 * subset the voice-inbox modules use: from().select/insert/update/upsert/delete
 * with eq / not-in / order / limit / range / maybeSingle / single, `count`
 * (with or without `head`), plus rpc(). `failRead` makes a table's reads fail.
 *
 * Filters on JSON paths use the PostgREST `col->>key` spelling. Unique keys
 * per table can be declared so inserts return a `23505` error like Postgres.
 *
 * Owned by slack-events.test.ts / telegram-webhook.test.ts. (A sibling
 * `fake-query-recorder.ts` belongs to another suite — different purpose.)
 */

export type Row = Record<string, unknown>

interface FakeDbOptions {
  /** table → columns that form a unique key (insert conflicts return 23505). */
  uniques?: Record<string, string[]>
  rpc?: (fn: string, args: Record<string, unknown>) => unknown
  /** Mint a uuid `id` on insert when the row has none (mimics `default gen_random_uuid()`). */
  autoId?: boolean
  /**
   * Make `maybeSingle()` / `single()` error when more than one row matches,
   * as PostgREST does (PGRST116). Off by default for the older suites.
   */
  strictSingle?: boolean
  /**
   * Make a read fail the way PostgREST reports an error: return a message to
   * fail `from(table).select(...)`, or null to let it run. Used by the
   * fail-open suites to prove a failed read never renders as "nothing found".
   */
  failRead?: (table: string) => string | null
  /**
   * PostgREST `max_rows`: no select returns more rows than this, whatever
   * `limit` / `range` ask for (1,000 on Supabase). Unset = no cap.
   */
  maxRows?: number
}

type Op = 'select' | 'insert' | 'update' | 'upsert' | 'delete'

function readPath(row: Row, key: string): unknown {
  const m = /^(\w+)->>(\w+)$/.exec(key)
  if (m) {
    const obj = row[m[1]] as Record<string, unknown> | null | undefined
    return obj ? obj[m[2]] : undefined
  }
  return row[key]
}

class FakeQuery implements PromiseLike<{ data: unknown; error: { code?: string; message: string } | null; count?: number | null }> {
  private filters: Array<(r: Row) => boolean> = []
  private _limit: number | null = null
  private _range: { from: number; to: number } | null = null
  private _count = false
  private _head = false
  private _single: 'maybe' | 'strict' | null = null
  /** Sort keys in call order, as PostgREST applies `order=a.desc,b.asc`. */
  private _order: Array<{ key: string; ascending: boolean }> = []
  private returning = false
  private onConflict: string[] | null = null
  /** select(cols, { count: 'exact', head }) — return the match count, and no rows when head. */
  private counting: { head: boolean } | null = null

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
    private op: Op,
    private payload: Row | Row[] | null = null,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }): this {
    if (this.op !== 'select') this.returning = true
    if (opts?.count) this._count = true
    if (opts?.head) this._head = true
    return this
  }
  insert(payload: Row | Row[]): this {
    this.op = 'insert'
    this.payload = payload
    return this
  }
  update(payload: Row): this {
    this.op = 'update'
    this.payload = payload
    return this
  }
  upsert(payload: Row | Row[], opts?: { onConflict?: string }): this {
    this.op = 'upsert'
    this.payload = payload
    this.onConflict = opts?.onConflict ? opts.onConflict.split(',').map((s) => s.trim()) : null
    return this
  }
  delete(): this {
    this.op = 'delete'
    return this
  }
  eq(key: string, value: unknown): this {
    this.filters.push((r) => readPath(r, key) === value)
    return this
  }
  neq(key: string, value: unknown): this {
    this.filters.push((r) => readPath(r, key) !== value)
    return this
  }
  in(key: string, values: unknown[]): this {
    this.filters.push((r) => values.includes(readPath(r, key)))
    return this
  }
  not(key: string, op: string, value: string | null): this {
    if (op === 'is' && value === null) {
      // `.not(col, 'is', null)`: the column is set.
      this.filters.push((r) => {
        const v = readPath(r, key)
        return v !== null && v !== undefined
      })
      return this
    }
    if (op !== 'in' || value === null) throw new Error(`fake-supabase: not(${op}) unsupported`)
    const values = value.replace(/^\(|\)$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''))
    this.filters.push((r) => !values.includes(String(readPath(r, key))))
    return this
  }
  /** `is(col, null)`: the column is NULL (or absent on the fake row). */
  is(key: string, value: null | boolean): this {
    this.filters.push((r) => {
      const v = readPath(r, key)
      return value === null ? v === null || v === undefined : v === value
    })
    return this
  }
  /**
   * `or('a.is.null,b.neq.x')`: flat PostgREST alternatives of `is.null`,
   * `eq` and `neq`. `neq` never matches a NULL / absent column, as in Postgres
   * (`NULL <> 'x'` is NULL), so a filter that forgets `is.null` fails here too.
   */
  or(filters: string): this {
    const alternatives = filters.split(',').map((part) => {
      const m = /^([\w>-]+)\.(is|eq|neq)\.(.*)$/.exec(part.trim())
      if (!m) throw new Error(`fake-supabase: or(${part}) unsupported`)
      const [, key, op, raw] = m
      return (r: Row): boolean => {
        const v = readPath(r, key)
        if (op === 'is') {
          if (raw !== 'null') throw new Error(`fake-supabase: or(${part}) unsupported`)
          return v === null || v === undefined
        }
        if (v === null || v === undefined) return false
        return op === 'eq' ? String(v) === raw : String(v) !== raw
      }
    })
    this.filters.push((r) => alternatives.some((f) => f(r)))
    return this
  }
  gt(key: string, value: unknown): this {
    this.filters.push((r) => String(readPath(r, key)) > String(value))
    return this
  }
  /** `lt(col, v)`: a NULL / absent column never matches, as in Postgres. */
  lt(key: string, value: unknown): this {
    this.filters.push((r) => {
      const v = readPath(r, key)
      return v !== null && v !== undefined && String(v) < String(value)
    })
    return this
  }
  gte(key: string, value: unknown): this {
    this.filters.push((r) => String(readPath(r, key)) >= String(value))
    return this
  }
  lte(key: string, value: unknown): this {
    this.filters.push((r) => String(readPath(r, key)) <= String(value))
    return this
  }
  order(key: string, opts?: { ascending?: boolean }): this {
    this._order.push({ key, ascending: opts?.ascending !== false })
    return this
  }
  limit(n: number): this {
    this._limit = n
    return this
  }
  /** Inclusive row window, as PostgREST's Range header. */
  range(from: number, to: number): this {
    this._range = { from, to }
    return this
  }
  maybeSingle(): this {
    this._single = 'maybe'
    return this
  }
  single(): this {
    this._single = 'strict'
    return this
  }

  private matches(): Row[] {
    const rows = this.db.table(this.table)
    return rows.filter((r) => this.filters.every((f) => f(r)))
  }

  private finish(rows: Row[]): { data: unknown; error: { code?: string; message: string } | null; count?: number | null } {
    let out = rows
    if (this._order.length > 0) {
      out = [...out].sort((a, b) => {
        for (const { key, ascending } of this._order) {
          const av = String(readPath(a, key) ?? '')
          const bv = String(readPath(b, key) ?? '')
          const cmp = ascending ? av.localeCompare(bv) : bv.localeCompare(av)
          if (cmp !== 0) return cmp
        }
        return 0
      })
    }
    const total = out.length
    if (this._range) out = out.slice(this._range.from, this._range.to + 1)
    if (this._limit != null) out = out.slice(0, this._limit)
    if (this.db.options.maxRows != null) out = out.slice(0, this.db.options.maxRows)
    const count = this._count ? { count: total } : {}
    if (this._head) return { data: null, error: null, ...count }
    if (this._single && this.db.options.strictSingle && out.length > 1) {
      return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }
    }
    if (this._single) return { data: out[0] ?? null, error: null, ...count }
    return { data: out, error: null, ...count }
  }

  private exec(): { data: unknown; error: { code?: string; message: string } | null; count?: number | null } {
    const rows = this.db.table(this.table)
    switch (this.op) {
      case 'select': {
        const failure = this.db.options.failRead?.(this.table) ?? null
        if (failure) return { data: null, error: { code: 'XX000', message: failure }, count: null }
        return this.finish(this.matches())
      }
      case 'insert': {
        const items = Array.isArray(this.payload) ? this.payload : [this.payload as Row]
        const uniques = this.db.options.uniques?.[this.table]
        for (const item of items) {
          if (uniques && rows.some((r) => uniques.every((k) => r[k] === item[k]))) {
            return { data: null, error: { code: '23505', message: `duplicate key on ${this.table}` } }
          }
          if (this.db.options.autoId && item.id === undefined) item.id = crypto.randomUUID()
          rows.push({ ...item })
        }
        return this.returning ? this.finish(items) : { data: null, error: null }
      }
      case 'upsert': {
        const items = Array.isArray(this.payload) ? this.payload : [this.payload as Row]
        const keys = this.onConflict ?? this.db.options.uniques?.[this.table] ?? null
        for (const item of items) {
          const existing = keys ? rows.find((r) => keys.every((k) => r[k] === item[k])) : undefined
          if (existing) Object.assign(existing, item)
          else {
            if (this.db.options.autoId && item.id === undefined) item.id = crypto.randomUUID()
            rows.push({ ...item })
          }
        }
        return this.returning ? this.finish(items) : { data: null, error: null }
      }
      case 'update': {
        const targets = this.matches()
        for (const t of targets) Object.assign(t, this.payload as Row)
        return this.returning ? this.finish(targets) : { data: null, error: null }
      }
      case 'delete': {
        const targets = this.matches()
        for (const t of targets) rows.splice(rows.indexOf(t), 1)
        return this.returning ? this.finish(targets) : { data: null, error: null }
      }
    }
  }

  then<R1 = unknown, R2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { code?: string; message: string } | null; count?: number | null }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve()
      .then(() => this.exec())
      .then(onfulfilled ?? undefined, onrejected ?? undefined)
  }
}

export class FakeDb {
  readonly tables: Record<string, Row[]>
  readonly rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []

  constructor(seed: Record<string, Row[]> = {}, readonly options: FakeDbOptions = {}) {
    this.tables = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]))
  }

  table(name: string): Row[] {
    if (!this.tables[name]) this.tables[name] = []
    return this.tables[name]
  }

  from(name: string): FakeQuery {
    return new FakeQuery(this, name, 'select')
  }

  async rpc(fn: string, args: Record<string, unknown> = {}): Promise<{ data: unknown; error: null }> {
    this.rpcCalls.push({ fn, args })
    return { data: this.options.rpc ? this.options.rpc(fn, args) : null, error: null }
  }
}

export function makeFakeDb(seed: Record<string, Row[]> = {}, options: FakeDbOptions = {}): FakeDb {
  return new FakeDb(seed, options)
}
