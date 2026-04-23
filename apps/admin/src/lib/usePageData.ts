/**
 * FILE: apps/admin/src/lib/usePageData.ts
 * PURPOSE: StrictMode-safe data loading hook with stale-while-revalidate
 *          semantics. React 18 StrictMode invokes effects twice in
 *          development which causes pages that fetch in a bare useEffect
 *          to flash the loading spinner twice and to fire duplicate
 *          network requests. This hook tracks an `aborted` flag per mount
 *          and exposes a stable `reload` callback so consumers don't
 *          have to re-implement the bookkeeping.
 *
 *          Stale-while-revalidate (UIUX-1, 2026-04-23): once data has
 *          loaded at least once, subsequent `reload()` calls (triggered
 *          after Test / Save / Run buttons, or by `deps` changes) keep
 *          the previous `data` visible and set `isValidating = true`
 *          instead of flipping `loading` back to true. This kills the
 *          "container refresh flash" where the entire panel briefly
 *          unmounts to a skeleton and sticky ResultChip receipts vanish
 *          mid-celebration. Matches SWR / TanStack Query defaults.
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
  /** True only during the *first* fetch for this hook instance (or
   *  after an explicit reset). Subsequent background refetches leave
   *  `loading` as false so consumers keep rendering their data view. */
  loading: boolean
  error: string | null
  /** True whenever a fetch is in flight, including background refetches
   *  triggered by `reload()` after the first successful load. Useful for
   *  subtle "refreshing…" indicators (e.g. a 2 px progress bar) that
   *  don't replace the page content with a skeleton. */
  isValidating: boolean
  /**
   * ISO timestamp of the most recent successful fetch, or `null` until
   * the first one resolves. Pages feed this into `<FreshnessPill>` so the
   * top-right of every Section can render "Updated 4 s ago" + a pulse
   * while `isValidating` is true. Stamped on the same tick that `data`
   * is committed so the pill never lies about the data it labels.
   */
  lastFetchedAt: string | null
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
  const [isValidating, setIsValidating] = useState<boolean>(autoLoad && path != null)
  const [error, setError] = useState<string | null>(null)
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null)

  // We keep the abort flag in a ref so that a second StrictMode invocation
  // of the effect can flip the previous run's flag before it commits state.
  const aborted = useRef(false)
  // Tracks whether we've ever returned data *for the current `path`*. Flips
  // `loading` off for subsequent refetches of the same resource so skeleton
  // guards only trigger on true first-paint. IMPORTANT: must reset when
  // `path` changes — otherwise switching the endpoint (window filter on
  // Health, page/filter change on Reports) keeps `loading=false` and leaves
  // the previous resource's `data` visible, briefly rendering stale rows
  // that belong to a different query.
  const hasLoadedOnce = useRef(false)
  // Tracks the `path` we last fetched from so we can detect a resource swap
  // and reset skeleton + data state. A distinct ref (not state) avoids an
  // extra render and keeps the comparison synchronous with the effect.
  const lastPath = useRef<string | null>(null)
  // Bumping `tick` forces a refetch from `reload()` without changing path.
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick((t) => t + 1), [])

  // We intentionally serialise deps to a string so consumers can pass arrays
  // of primitives without worrying about identity churn.
  const depKey = JSON.stringify(deps)

  useEffect(() => {
    if (!path || !autoLoad) return
    aborted.current = false
    // Path swap → treat as a true first-paint. Drop the stale resource so
    // the consumer's `if (loading) return <Skeleton />` guard fires
    // instead of rendering the prior path's rows against the new URL.
    const pathChanged = lastPath.current !== path
    if (pathChanged) {
      hasLoadedOnce.current = false
      setData(null)
    }
    lastPath.current = path
    // SWR semantics: only show the skeleton while we've never resolved
    // data *for this path*. Refetches after the first success leave `data`
    // stable and only flip `isValidating` so panels don't unmount
    // mid-receipt.
    if (!hasLoadedOnce.current) setLoading(true)
    setIsValidating(true)
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
          setLastFetchedAt(new Date().toISOString())
          hasLoadedOnce.current = true
        } else {
          setError(res.error?.message ?? 'Request failed')
        }
      } catch (err) {
        if (aborted.current) return
        setError(err instanceof Error ? err.message : 'Request failed')
      } finally {
        if (!aborted.current) {
          setLoading(false)
          setIsValidating(false)
        }
      }
    })()
    return () => {
      aborted.current = true
    }
    // depKey is the JSON-serialised version of `deps`, so we intentionally
    // depend on it instead of `deps` itself to avoid array-identity churn.
  }, [path, autoLoad, tick, depKey, schema])

  return { data, loading, error, isValidating, lastFetchedAt, reload }
}
