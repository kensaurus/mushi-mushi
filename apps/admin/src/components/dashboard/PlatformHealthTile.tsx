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
import { ContainedBlock, SignalChip } from '../report-detail/ReportSurface'
import { EmptySectionMessage } from '../report-detail/ReportClassification'

interface PlatformRow {
  platform: string
  sdk_package: string | null
  reports_24h: number
  critical_24h: number
  high_24h: number
  sdk_versions: string[]
}

interface PlatformRollupData {
  platforms: PlatformRow[]
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
        <EmptySectionMessage text="Platform rollup not available." />
      )}

      {!loading && !error && rows.length === 0 && (
        <ContainedBlock tone="muted">
          <p className="text-2xs text-fg-muted italic">
            No multi-platform data yet. Reports from iOS, Android, and Web will appear here once your app sends them.
          </p>
        </ContainedBlock>
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
                <SignalChip tone="neutral" className="shrink-0 w-14 justify-center uppercase text-3xs">
                  {row.platform}
                </SignalChip>

                <SignalChip tone="neutral" className="shrink-0 font-mono text-3xs">
                  {sdkShortName(row.sdk_package)}
                </SignalChip>

                <span className="flex-1 flex items-center gap-1.5 min-w-0">
                  <span className="text-2xs font-mono text-fg">{row.reports_24h}</span>
                  <span className="text-3xs text-fg-faint">reports</span>
                  {hasCritical && (
                    <SignalChip tone="danger" className="text-3xs font-mono">
                      {row.critical_24h} crit
                    </SignalChip>
                  )}
                  {!hasCritical && hasHigh && (
                    <SignalChip tone="warn" className="text-3xs font-mono">
                      {row.high_24h} high
                    </SignalChip>
                  )}
                </span>

                {(row.sdk_versions?.length ?? 0) > 1 && (
                  <span className="text-3xs text-warn shrink-0" title={`Multiple SDK versions: ${row.sdk_versions.join(', ')}`}>
                    {row.sdk_versions.length} versions
                  </span>
                )}
                {(row.sdk_versions?.length ?? 0) === 1 && (
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

