/**
 * FILE: apps/admin/src/components/reports/ReportsKpiStrip.tsx
 * PURPOSE: 4-tile severity strip on the Reports page header. Lets triagers
 *          see the shape of incoming pain (1 critical · 12 high · …) before
 *          they scroll, and clicking any tile filters the table to that
 *          severity in one click.
 */

import { usePageData } from '../../lib/usePageData'
import { KpiTile } from '../charts'
import type { Tone } from '../charts'

interface SeverityStats {
  window_days: number
  bySeverity: { critical: number; high: number; medium: number; low: number }
  total: number
}

interface Props {
  /** Currently active severity filter (so we can highlight the matching tile). */
  activeSeverity?: string
  /** Click handler — page will mutate the URL state to apply the filter. */
  onFilter: (severity: 'critical' | 'high' | 'medium' | 'low' | '') => void
  windowDays?: number
}

const TILES: Array<{
  key: 'critical' | 'high' | 'medium' | 'low'
  label: string
  accent: Tone
  meaning: string
}> = [
  { key: 'critical', label: 'Critical', accent: 'danger',
    meaning: 'Reports flagged Critical by the classifier in the window. These usually block user flow — triage first.' },
  { key: 'high', label: 'High', accent: 'warn',
    meaning: 'High-severity reports — broken functionality but with a workaround. Schedule a fix before next release.' },
  { key: 'medium', label: 'Medium', accent: 'info',
    meaning: 'Medium-severity reports — annoyance or polish. Batch-triage at end of week.' },
  { key: 'low', label: 'Low', accent: 'muted',
    meaning: 'Low-severity reports — usually visual nits or confusion. Useful as PDCA signal, low individual urgency.' },
]

export function ReportsKpiStrip({ activeSeverity, onFilter, windowDays = 14 }: Props) {
  const { data, loading, error, reload } = usePageData<SeverityStats>(
    `/v1/admin/reports/severity-stats?days=${windowDays}`,
    { deps: [windowDays] },
  )

  const counts = data?.bySeverity ?? { critical: 0, high: 0, medium: 0, low: 0 }

  // Surface fetch failures inline instead of silently rendering zeros — the
  // audit found this row claiming "0 critical · 0 high" when the endpoint
  // 500'd, which is actively misleading. Audit Wave K bugfix.
  if (error) {
    return (
      <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-danger">Couldn\u2019t load severity stats</p>
          <p className="mt-0.5 truncate text-3xs text-fg-muted">{error}</p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="shrink-0 rounded-sm border border-danger/40 bg-danger/10 px-2 py-1 text-2xs font-medium text-danger hover:bg-danger/15 motion-safe:transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3">
      {TILES.map((tile) => {
        const isActive = activeSeverity === tile.key
        return (
          <button
            key={tile.key}
            type="button"
            onClick={() => onFilter(isActive ? '' : tile.key)}
            aria-pressed={isActive}
            aria-label={
              isActive
                ? `Clear ${tile.label} filter`
                : `Filter to ${tile.label} severity reports`
            }
            className={`text-left rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 motion-safe:transition-all ${
              isActive ? 'ring-2 ring-brand/60' : ''
            }`}
          >
            <KpiTile
              label={tile.label}
              value={loading ? '…' : counts[tile.key]}
              sublabel={`last ${windowDays}d${isActive ? ' · filtering' : ''}`}
              accent={tile.accent}
              meaning={tile.meaning}
            />
          </button>
        )
      })}
    </div>
  )
}
