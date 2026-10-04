/**
 * FILE: apps/admin/src/lib/qaCoverageFilter.ts
 * PURPOSE: The /qa-coverage story-grid filter, driven by the URL. Stat cards,
 *          banner CTAs and the server's `topPriorityTo` link to
 *          `/qa-coverage?tab=failing|passing|no_data|disabled|stories`; the
 *          page used to ignore `tab`, so "Failing" changed nothing.
 *
 * The buckets mirror GET /v1/admin/projects/:pid/qa-coverage/stats so a card
 * that says "2 failing" opens a grid with exactly those 2 stories.
 */

export type QaCoverageFilter = 'all' | 'failing' | 'passing' | 'no_data' | 'disabled'

export const QA_COVERAGE_FILTERS: ReadonlyArray<{ id: QaCoverageFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'failing', label: 'Failing' },
  { id: 'passing', label: 'Passing' },
  { id: 'no_data', label: 'No runs in 24h' },
  { id: 'disabled', label: 'Turned off' },
]

const FILTER_IDS = new Set<string>(QA_COVERAGE_FILTERS.map((f) => f.id))

/** `?tab=` (and the legacy `?status=fail`) → grid filter. Unknown or `stories`/`overview` → all. */
export function resolveQaCoverageFilter(params: URLSearchParams): QaCoverageFilter {
  const tab = params.get('tab')
  if (tab && FILTER_IDS.has(tab)) return tab as QaCoverageFilter
  if (params.get('status') === 'fail') return 'failing'
  return 'all'
}

export interface QaCoverageFilterRow {
  enabled: boolean
  runs_24h: number
  pass_rate_pct: number | null
}

/** Same thresholds as the stats route: ≥ 80% passing, < 80% failing, no runs = no data. */
export function matchesQaCoverageFilter(row: QaCoverageFilterRow, filter: QaCoverageFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'disabled':
      return !row.enabled
    case 'no_data':
      return row.runs_24h === 0
    case 'passing':
      return row.runs_24h > 0 && row.pass_rate_pct != null && row.pass_rate_pct >= 80
    case 'failing':
      return row.runs_24h > 0 && row.pass_rate_pct != null && row.pass_rate_pct < 80
  }
}
