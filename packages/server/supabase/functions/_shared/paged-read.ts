/**
 * FILE: packages/server/supabase/functions/_shared/paged-read.ts
 * PURPOSE: Read every row of a PostgREST query, page by page, and say when the
 *          result was cut short. A bare `.limit(20000)` is silently capped at
 *          the server's `max_rows` (1,000 on Supabase), so a sum over it reads
 *          as a real total while it is not.
 *
 * The caller builds the query and must order it by a unique column (`id`), so
 * pages never overlap or skip a row. Only the first page asks for
 * `count: 'exact'` (the fetcher gets `'exact'` there and `undefined` after):
 * an exact count per page would re-count the whole filtered table each time.
 * The reader stops once it has the counted rows, on an empty page, or at
 * `maxRows`. It advances by the rows actually returned, so a server cap lower
 * than `pageSize` only costs more requests, never rows.
 *
 * A read error throws `PagedReadError` — never an empty result.
 *
 * Pure apart from the injected page fetcher; no Deno globals.
 */

export interface PageResult<T> {
  data: T[] | null
  error: { message: string } | null
  /** Rows matching the query, when it was asked for with `count: 'exact'` (first page only). */
  count?: number | null
}

export interface PagedRead<T> {
  rows: T[]
  /** True when more rows matched than were read (`maxRows` reached). */
  truncated: boolean
  /** Rows matching the query, when the server counted them. */
  total: number | null
}

export const DEFAULT_PAGE_ROWS = 1000

export class PagedReadError extends Error {
  constructor(readonly what: string, detail: string) {
    super(`${what}: ${detail}`)
    this.name = 'PagedReadError'
  }
}

/** What a page fetcher passes as `select(cols, { count })`: `'exact'` on the first page only. */
export type PageCount = 'exact' | undefined

export async function readAllPages<T>(
  fetchPage: (from: number, to: number, count: PageCount) => PromiseLike<PageResult<T>>,
  opts: { what: string; maxRows: number; pageSize?: number },
): Promise<PagedRead<T>> {
  const pageSize = Math.max(1, opts.pageSize ?? DEFAULT_PAGE_ROWS)
  const rows: T[] = []
  let total: number | null = null
  while (rows.length < opts.maxRows) {
    const want = Math.min(pageSize, opts.maxRows - rows.length)
    const from = rows.length
    const { data, error, count } = await fetchPage(from, from + want - 1, from === 0 ? 'exact' : undefined)
    if (error) throw new PagedReadError(opts.what, error.message)
    if (from === 0 && typeof count === 'number') total = count
    const page = data ?? []
    rows.push(...page)
    if (page.length === 0) break
    if (total !== null && rows.length >= total) break
    // Without a count, a short page is the last one only when it is shorter
    // than what the server could have sent; keep reading until an empty page.
  }
  const truncated = total !== null ? total > rows.length : rows.length >= opts.maxRows
  return { rows, truncated, total }
}
