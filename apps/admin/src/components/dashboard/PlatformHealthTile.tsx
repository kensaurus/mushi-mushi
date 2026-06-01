/**
 * FILE: apps/admin/src/components/dashboard/PlatformHealthTile.tsx
 * PURPOSE: Dashboard tile showing 24h report volume, error class breakdown,
 *          and SDK version drift per platform — enabling operators to spot
 *          platform-specific regressions at a glance (e.g. iOS RN build
 *          suddenly logs 3× more `critical` than Android).
 *
 * OVERVIEW:
 * - Reads from the `qa_platform_rollup_24h` materialized view via the
 *   `/v1/admin/dashboard/platform-rollup` endpoint.
 * - Falls back gracefully when no multi-platform data exists (single-SDK
 *   projects still see a useful single-row table).
 * - Each platform row is a link to `/reports?platform=<platform>` so the
 *   operator can drill straight into the filtered triage queue.
 *
 * DEPENDENCIES:
 * - `Card` UI primitive
 * - `apiFetch` for data fetching
 * - `usePageData` SWR-like hook
 * - `Link` from react-router-dom for drill-down navigation
 *
 * NOTES:
 * - The MV refresh is handled by the same pg_cron job as blast_radius_mv;
 *   data is at most 1h stale, which is fine for a dashboard tile.
 * - If the backend endpoint doesn't exist yet (pre-migration), the tile
 *   renders a compact "not available" state rather than crashing.
 */

import { Link } from 'react-router-dom'
import { usePageData } from '../../lib/usePageData'
import { Card } from '../ui'

interface PlatformRow {
  platform: string
  sdk_package: string | null
  reports_24h: number
  critical_24h: number
  high_24h: number
  // array_agg() in Postgres returns NULL (not []) when no rows match
  sdk_versions: string[] | null
}

interface PlatformRollupData {
  platforms: PlatformRow[]
}

const PLATFORM_BADGE: Record<string, string> = {
  ios:     'bg-info-muted text-info',
  android: 'bg-ok-muted text-ok',
  web:     'bg-brand/15 text-brand',
  macos:   'bg-surface-overlay text-fg-secondary',
  windows: 'bg-surface-overlay text-fg-secondary',
}

function sdkShortName(pkg: string | null): string {
  if (!pkg) return '—'
  return pkg.replace('@mushi-mushi/', '')
}

export function PlatformHealthTile({ projectId }: { projectId: string }) {
  const { data, loading, error } = usePageData<PlatformRollupData>(
    `/v1/admin/projects/${projectId}/platform-rollup`,
    { deps: [projectId] },
  )

  const rows = data?.platforms ?? []

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-semibold text-fg-secondary uppercase tracking-wider">
          Platform health · 24h
        </span>
        {rows.length > 0 && (
          <span className="text-3xs text-fg-faint">
            {rows.length} platform{rows.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {loading && (
        <div className="space-y-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-6 rounded-sm bg-surface-raised animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-2xs text-fg-faint italic">Platform rollup not available.</p>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="text-2xs text-fg-faint italic">
          No multi-platform data yet. Reports from iOS, Android, and Web will appear here once your app sends them.
        </p>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="space-y-1">
          {rows.map((row) => {
            const hasCritical = row.critical_24h > 0
            const hasHigh = row.high_24h > 0
            return (
              <Link
                key={`${row.platform}-${row.sdk_package}`}
                to={`/reports?platform=${row.platform}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-surface-overlay transition-colors group"
              >
                <span
                  className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded-sm text-3xs font-semibold uppercase tracking-wider w-14 text-center shrink-0 ${PLATFORM_BADGE[row.platform] ?? 'bg-surface-overlay text-fg-secondary'}`}
                >
                  {row.platform}
                </span>

                <span className="text-2xs text-fg-muted shrink-0 w-12">
                  {sdkShortName(row.sdk_package)}
                </span>

                <span className="flex-1 flex items-center gap-1.5 min-w-0">
                  <span className="text-2xs font-mono text-fg">{row.reports_24h}</span>
                  <span className="text-3xs text-fg-faint">reports</span>
                  {hasCritical && (
                    <span className="text-3xs font-mono bg-danger-muted text-danger px-1 rounded-sm">
                      {row.critical_24h} crit
                    </span>
                  )}
                  {!hasCritical && hasHigh && (
                    <span className="text-3xs font-mono bg-warn-muted text-warn px-1 rounded-sm">
                      {row.high_24h} high
                    </span>
                  )}
                </span>

                {(row.sdk_versions?.length ?? 0) > 1 && (
                  <span className="text-3xs text-warn shrink-0" title={`Multiple SDK versions: ${row.sdk_versions!.join(', ')}`}>
                    {row.sdk_versions!.length} versions
                  </span>
                )}
                {row.sdk_versions?.length === 1 && (
                  <span className="text-3xs text-fg-faint shrink-0 font-mono">
                    v{row.sdk_versions[0]}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </Card>
  )
}

