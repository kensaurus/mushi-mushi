/**
 * Minimal in-memory stand-in for the supabase-js query builder, covering the
 * subset the voice-inbox modules use: from().select/insert/update/upsert/delete
 * with eq / not-in / order / limit / maybeSingle / single, plus rpc().
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
  private _single: 'maybe' | 'strict' | null = null
  private _order: { key: string; ascending: boolean } | null = null
  private returning = false
  private onConflict: string[] | null = null

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
    private op: Op,
    private payload: Row | Row[] | null = null,
  ) {}

  select(_cols?: string, _opts?: unknown): this {
    if (this.op !== 'select') this.returning = true
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
  not(key: string, op: string, value: string): this {
    if (op !== 'in') throw new Error(`fake-supabase: not(${op}) unsupported`)
    const values = value.replace(/^\(|\)$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''))
    this.filters.push((r) => !values.includes(String(readPath(r, key))))
    return this
  }
  gte(key: string, value: unknown): this {
    this.filters.push((r) => String(readPath(r, key)) >= String(value))
    return this
  }
  order(key: string, opts?: { ascending?: boolean }): this {
    this._order = { key, ascending: opts?.ascending !== false }
    return this
  }
  limit(n: number): this {
    this._limit = n
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

  private finish(rows: Row[]): { data: unknown; error: null } {
    let out = rows
    if (this._order) {
      const { key, ascending } = this._order
      out = [...out].sort((a, b) => {
        const av = String(readPath(a, key) ?? '')
        const bv = String(readPath(b, key) ?? '')
        return ascending ? av.localeCompare(bv) : bv.localeCompare(av)
      })
    }
    if (this._limit != null) out = out.slice(0, this._limit)
    if (this._single) return { data: out[0] ?? null, error: null }
    return { data: out, error: null }
  }

  private exec(): { data: unknown; error: { code?: string; message: string } | null } {
    const rows = this.db.table(this.table)
    switch (this.op) {
      case 'select':
        return this.finish(this.matches())
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
          else rows.push({ ...item })
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
    onfulfilled?: ((value: { data: unknown; error: { code?: string; message: string } | null }) => R1 | PromiseLike<R1>) | null,
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
