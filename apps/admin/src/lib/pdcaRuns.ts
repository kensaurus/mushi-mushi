/**
 * FILE: apps/admin/src/lib/pdcaRuns.ts
 * PURPOSE: Normalise the /v1/admin/pdca list response for IteratePage.
 *
 * The route returns a FLAT paginated envelope — `{ ok, data: PdcaRun[],
 * total, page, limit }` — and `coerceApiResult` (apiEnvelope.ts) deliberately
 * re-nests that shape as `data: { data, total, page, limit }` so paginated
 * consumers can read `total`. IteratePage typed the hook result as
 * `PdcaRun[]`, called `.filter` on the re-nested object, and threw
 * `runs.filter is not a function` on every visit to its Runs tab — which,
 * through the route-level ErrorBoundary, took the whole console down until
 * a hard reload (2026-09-23). Never call array methods on the raw hook value.
 */

interface PdcaRunsPage<R> {
  data: R[]
  total?: number | null
  page?: number
  limit?: number
}

/** Either shape the hook can hand back, plus the not-loaded cases. */
export type PdcaRunsEnvelope<R> = R[] | PdcaRunsPage<R> | null | undefined

export function pdcaRunsFromEnvelope<R>(raw: PdcaRunsEnvelope<R>): {
  runs: R[]
  total: number | null
} {
  if (Array.isArray(raw)) return { runs: raw, total: null }
  if (raw && typeof raw === 'object' && Array.isArray(raw.data)) {
    return { runs: raw.data, total: typeof raw.total === 'number' ? raw.total : null }
  }
  return { runs: [], total: null }
}
