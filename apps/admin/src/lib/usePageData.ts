/**
 * FILE: apps/admin/src/lib/usePageData.ts
 * PURPOSE: StrictMode-safe data loading hook. React 18 StrictMode invokes
 *          effects twice in development which causes pages that fetch in
 *          a bare useEffect to flash the loading spinner twice and to fire
 *          duplicate network requests. This hook tracks an `aborted` flag
 *          per mount and exposes a stable `reload` callback so consumers
 *          don't have to re-implement the bookkeeping.
 *
 *          Use this for any GET-style page load that fits the pattern
 *          "render loading → render data → render error" with optional
 *          manual refresh. For mutations (POST/PUT/DELETE) keep using
 *          apiFetch directly with toast feedback.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ZodType } from 'zod'
import { apiFetch } from './supabase'

export interface PageDataState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

export interface UsePageDataOptions<T> {
  /** When false the hook will not auto-fetch on mount. Defaults to true. */
  autoLoad?: boolean
  /** Re-runs the fetch whenever any of these change (deep-eq via JSON). */
  deps?: ReadonlyArray<unknown>
  /**
   * FE-API-1 (audit 2026-04-21): optional runtime Zod validation. See
   * apiSchemas.ts. A failed parse is reported to Sentry and surfaced here
   * as a conventional `error` string so pages can render their existing
   * error UI rather than crashing inside a render commit.
   */
  schema?: ZodType<T>
}

export function usePageData<T>(
  path: string | null,
  opts: UsePageDataOptions<T> = {},
): PageDataState<T> {
  const { autoLoad = true, deps = [], schema } = opts
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState<boolean>(autoLoad && path != null)
  const [error, setError] = useState<string | null>(null)

  // We keep the abort flag in a ref so that a second StrictMode invocation
  // of the effect can flip the previous run's flag before it commits state.
  const aborted = useRef(false)
  // Bumping `tick` forces a refetch from `reload()` without changing path.
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick((t) => t + 1), [])

  // We intentionally serialise deps to a string so consumers can pass arrays
  // of primitives without worrying about identity churn.
  const depKey = JSON.stringify(deps)

  useEffect(() => {
    if (!path || !autoLoad) return
    aborted.current = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        // `tick > 0` means the user hit "Retry" or "Refresh" — bypass the
        // micro-cache so we never serve a stale value to a user who explicitly
        // asked for fresh data. The first mount (`tick === 0`) still uses
        // dedup so concurrent component mounts share one request.
        const res = await apiFetch<T>(path, {
          ...(tick > 0 ? { cache: 'no-store' } : {}),
          ...(schema ? { schema } : {}),
        })
        if (aborted.current) return
        if (res.ok && res.data !== undefined) {
          setData(res.data as T)
        } else {
          setError(res.error?.message ?? 'Request failed')
        }
      } catch (err) {
        if (aborted.current) return
        setError(err instanceof Error ? err.message : 'Request failed')
      } finally {
        if (!aborted.current) setLoading(false)
      }
    })()
    return () => {
      aborted.current = true
    }
    // depKey is the JSON-serialised version of `deps`, so we intentionally
    // depend on it instead of `deps` itself to avoid array-identity churn.
  }, [path, autoLoad, tick, depKey, schema])

  return { data, loading, error, reload }
}
