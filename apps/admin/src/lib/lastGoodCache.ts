/**
 * FILE: apps/admin/src/lib/lastGoodCache.ts
 * PURPOSE: The last successful GET answer per request key, so a page visited
 *          before paints at once and refetches behind it (stale-while-
 *          revalidate across pages) instead of opening on a skeleton.
 *
 *          apiFetch (supabase.ts) owns the request key: it registers the
 *          function that builds it (team, project, scope, path) and stores
 *          each successful answer here. usePageData only reads. Kept apart
 *          from supabase.ts so tests that mock that module still load
 *          usePageData; with nothing registered every lookup is a miss.
 *
 *          Memory only. supabase.ts clears it when the signed-in user
 *          changes, so one user's data never reaches another's screen.
 */

export type RequestScope = 'enumeration' | 'project' | 'none'

type KeyFn = (path: string, scope: RequestScope) => string | null

const MAX_ENTRIES = 120
const entries = new Map<string, { data: unknown; at: number }>()
let keyFor: KeyFn | null = null

/** apiFetch registers how it keys a GET, so lookups match what it stored. */
export function registerLastGoodKey(fn: KeyFn): void {
  keyFor = fn
}

export function rememberLastGood(key: string, data: unknown): void {
  if (data === undefined) return
  // Re-insert so Map order tracks recency; evict the least recently stored.
  entries.delete(key)
  entries.set(key, { data, at: Date.now() })
  if (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value
    if (oldest !== undefined) entries.delete(oldest)
  }
}

/** The last successful answer for this GET in the current team/project, if any. */
export function peekLastGood<T>(
  path: string,
  scope: RequestScope = 'project',
): { data: T; at: number } | null {
  const key = keyFor?.(path, scope)
  if (!key) return null
  const hit = entries.get(key)
  return hit ? { data: hit.data as T, at: hit.at } : null
}

export function clearLastGood(): void {
  entries.clear()
}
