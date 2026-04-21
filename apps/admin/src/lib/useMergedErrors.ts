/**
 * FILE: apps/admin/src/lib/useMergedErrors.ts
 * PURPOSE: Merge the loading + error state of N parallel `usePageData` queries
 *          into one decision the page can render against (Wave P, recovery
 *          UX).
 *
 *          Multi-query pages today render a partial UI when one query
 *          succeeds and another fails — the user sees half a page, no
 *          retry, and no clear ownership of what's broken. This helper
 *          makes the decision atomic:
 *
 *            const merged = useMergedErrors([trafficQuery, eventsQuery, deviceQuery])
 *            if (merged.loading) return <Skeleton />
 *            if (merged.error) return <ErrorAlert ... onRetry={merged.retry} />
 *
 *          - `loading` is true while ANY query is still loading on first
 *            paint (subsequent reloads are reported per-query so we don't
 *            flash skeletons during background refresh).
 *          - `error` is the first non-null error, with the failing query's
 *            label so the message can name what failed.
 *          - `retry` reloads every query that errored so the user gets a
 *            single button instead of N.
 */

export interface MergedQuery {
  loading: boolean
  error: string | null
  data: unknown
  reload: () => void
}

export interface MergedErrorsResult {
  /** True until every query has resolved (success or failure) at least once. */
  loading: boolean
  /** First non-null error message across the bundle, or null. */
  error: string | null
  /** Label of the first failing query, useful for naming what broke. */
  failedLabel: string | null
  /** True if any query is currently in an error state. */
  anyError: boolean
  /** Reload every errored query (no-op for healthy ones). */
  retry: () => void
}

export function useMergedErrors(
  queries: ReadonlyArray<MergedQuery & { label?: string }>,
): MergedErrorsResult {
  // First-paint loading: a query that has neither data nor error yet is
  // still mid-flight. Once it resolves either way we stop blocking the
  // page so background refetches don't flash a skeleton.
  const stillFirstLoad = queries.some(
    (q) => q.loading && q.data == null && q.error == null,
  )
  const failingIndex = queries.findIndex((q) => q.error != null)
  const failing = failingIndex >= 0 ? queries[failingIndex] : null

  return {
    loading: stillFirstLoad,
    error: failing?.error ?? null,
    failedLabel: failing?.label ?? null,
    anyError: failingIndex >= 0,
    retry: () => {
      for (const q of queries) {
        if (q.error != null) q.reload()
      }
    },
  }
}
