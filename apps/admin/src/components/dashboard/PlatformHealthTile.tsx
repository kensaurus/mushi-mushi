/**
 * FILE: apps/admin/src/components/dashboard/PlatformHealthTile.tsx
 * PURPOSE: Dashboard tile showing 24h report volume, error class breakdown,
 *          and SDK version drift per platform — enabling operators to spot
 *          platform-specific regressions at a glance.
 */

import { Link } from 'react-router-dom'
import { usePageData } from '../../lib/usePageData'
import { CardPanel } from '../ui'
import { EmptySectionMessage } from '../report-detail/ReportClassification'

interface PlatformRow {
  platform: string
  sdk_package: string | null
  reports_24h: number
  critical_24h: number
  high_24h: number
  sdk_versions: string[] | null
}

interface PlatformRollupData {
  platforms: PlatformRow[]
}

const PLATFORM_BADGE: Record<string, string> = {
  ios:     'bg-info/15 text-info',
  android: 'bg-ok/15 text-ok',
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
    <CardPanel
      title="Platform health · 24h"
      action={
        rows.length > 0 ? (
          <span className="shrink-0 text-3xs text-fg-faint">
            {rows.length} platform{rows.length !== 1 ? 's' : ''}
          </span>
        ) : undefined
      }
    >
      {loading && (
        <div className="space-y-1.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-7 rounded-sm bg-surface-raised animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <EmptySectionMessage
          text="Platform rollup unavailable."
          hint="The /platform-rollup endpoint may not be deployed yet."
        />
      )}

      {!loading && !error && rows.length === 0 && (
        <EmptySectionMessage
          text="No multi-platform data yet."
          hint="Send reports from iOS, Android, or Web and they will appear here, segmented by platform."
        />
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
                className="group flex items-center gap-2 rounded-sm px-2 py-1.5 motion-safe:transition-colors hover:bg-surface-overlay"
              >
                <span
                  className={`inline-flex w-14 shrink-0 items-center justify-center rounded-sm px-1.5 py-0.5 text-center text-3xs font-semibold uppercase tracking-wider ${PLATFORM_BADGE[row.platform] ?? 'bg-surface-overlay text-fg-secondary'}`}
                >
                  {row.platform}
                </span>

                <span className="w-12 shrink-0 text-2xs text-fg-muted">
                  {sdkShortName(row.sdk_package)}
                </span>

                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="font-mono text-2xs text-fg">{row.reports_24h}</span>
                  <span className="text-3xs text-fg-faint">reports</span>
                  {hasCritical && (
                    <span className="rounded-sm bg-danger/15 px-1 font-mono text-3xs text-danger">
                      {row.critical_24h} crit
                    </span>
                  )}
                  {!hasCritical && hasHigh && (
                    <span className="rounded-sm bg-warn/15 px-1 font-mono text-3xs text-warn">
                      {row.high_24h} high
                    </span>
                  )}
                </span>

                {(row.sdk_versions?.length ?? 0) > 1 && (
                  <span
                    className="shrink-0 text-3xs text-warn"
                    title={`Multiple SDK versions: ${row.sdk_versions!.join(', ')}`}
                  >
                    {row.sdk_versions!.length} versions
                  </span>
                )}
                {row.sdk_versions?.length === 1 && (
                  <span className="shrink-0 font-mono text-3xs text-fg-faint">
                    v{row.sdk_versions[0]}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </CardPanel>
  )
}
