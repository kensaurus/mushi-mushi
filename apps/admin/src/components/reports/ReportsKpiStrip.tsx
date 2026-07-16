/**
 * FILE: apps/admin/src/components/reports/ReportsKpiStrip.tsx
 * PURPOSE: 4-tile severity strip on the Reports page header. Lets triagers
 *          see the shape of incoming pain (1 critical · 12 high · …) before
 *          they scroll, and clicking any tile filters the table to that
 *          severity in one click.
 */

import { useMemo } from 'react'
import { usePageData } from '../../lib/usePageData'
import { KpiTile, type KpiDelta } from '../charts'
import { MetricStrip } from '../MetricStrip'
import type { Tone } from '../charts'
import { useAdminMode } from '../../lib/mode'

type SeverityKey = 'critical' | 'high' | 'medium' | 'low'

interface SeverityStats {
  window_days: number
  bySeverity: Record<SeverityKey, number>
  byDay?: Array<{ day: string } & Record<SeverityKey | 'total', number>>
  total: number
}

function buildSeveritySpark(
  byDay: SeverityStats['byDay'],
  key: SeverityKey,
): number[] {
  if (!byDay) return []
  return byDay.map((d) => d[key] ?? 0)
}

function severityDelta(values: number[]): KpiDelta | null {
  // Compare the last 7d window against the prior 7d window. More reports of
  // a given severity is bad → tone flips to warn on rises.
  if (values.length < 14) return null
  const last7 = values.slice(-7).reduce((a, n) => a + n, 0)
  const prev7 = values.slice(-14, -7).reduce((a, n) => a + n, 0)
  if (last7 === 0 && prev7 === 0) return null
  if (prev7 === 0) return { value: 'new', direction: 'up', tone: 'warn' }
  const pct = Math.round(((last7 - prev7) / prev7) * 100)
  if (pct === 0) return { value: '0%', direction: 'flat', tone: 'muted' }
  return {
    value: `${Math.abs(pct)}%`,
    direction: pct > 0 ? 'up' : 'down',
    tone: pct > 0 ? 'warn' : 'ok',
  }
}

interface Props {
  /** Currently active severity filter (so we can highlight the matching tile). */
  activeSeverity?: string
  /** Click handler — page will mutate the URL state to apply the filter. */
  onFilter: (severity: 'critical' | 'high' | 'medium' | 'low' | '') => void
  windowDays?: number
}

const TONE_SHARE_BAR: Record<Tone, string> = {
  danger: 'bg-danger/80',
  warn: 'bg-warn/80',
  info: 'bg-info/70',
  ok: 'bg-ok/80',
  brand: 'bg-brand/70',
  muted: 'bg-fg-faint/40',
}

const TILES_ADVANCED: Array<{
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
    meaning: 'Medium-severity reports — annoyance or polish. Batch-review at end of week.' },
  { key: 'low', label: 'Low', accent: 'muted',
    meaning: 'Low-severity reports — usually visual nits or confusion. Useful signal, low individual urgency.' },
]

const TILES_PLAIN: typeof TILES_ADVANCED = [
  { key: 'critical', label: 'Critical', accent: 'danger',
    meaning: 'Bugs that block user flow — review these first.' },
  { key: 'high', label: 'High', accent: 'warn',
    meaning: 'Broken functionality with a workaround — fix before next release.' },
  { key: 'medium', label: 'Medium', accent: 'info',
    meaning: 'Annoyance or polish issues — batch-review at end of week.' },
  { key: 'low', label: 'Low', accent: 'muted',
    meaning: 'Visual nits or confusion — low urgency individually.' },
]

export function ReportsKpiStrip({ activeSeverity, onFilter, windowDays = 14 }: Props) {
  const { isAdvanced } = useAdminMode()
  const tiles = isAdvanced ? TILES_ADVANCED : TILES_PLAIN
  const { data, loading, error, reload } = usePageData<SeverityStats>(
    `/v1/admin/reports/severity-stats?days=${windowDays}`,
    { deps: [windowDays] },
  )

  const counts = data?.bySeverity ?? { critical: 0, high: 0, medium: 0, low: 0 }
  const sparks = useMemo(
    () => ({
      critical: buildSeveritySpark(data?.byDay, 'critical'),
      high: buildSeveritySpark(data?.byDay, 'high'),
      medium: buildSeveritySpark(data?.byDay, 'medium'),
      low: buildSeveritySpark(data?.byDay, 'low'),
    }),
    [data?.byDay],
  )

  // Surface fetch failures inline instead of silently rendering zeros — the
  // audit found this row claiming "0 critical · 0 high" when the endpoint
  // 500'd, which is actively misleading. .
  if (error) {
    return (
      <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-danger">Couldn’t load severity stats</p>
          <p className="mt-0.5 truncate text-3xs text-fg-muted">{error}</p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="shrink-0 rounded-sm px-2 py-1 text-2xs font-medium hover:bg-danger-muted/40 bg-danger-muted/50 text-danger-foreground border border-danger/25 motion-safe:transition-opacity"
        >
          Retry
        </button>
      </div>
    )
  }

  const criticalCount = counts.critical

  return (
    <MetricStrip cols={4} panel ariaLabel="Reports severity breakdown" className="mb-3" stagger>
      {tiles.map((tile) => {
        const isActive = activeSeverity === tile.key
        const total = data?.total ?? 0
        const count = counts[tile.key]
        const sharePct = total > 0 ? Math.round((count / total) * 100) : 0
        const isHero = tile.key === 'critical' && criticalCount > 0
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
            className={`relative block w-full min-w-0 overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 motion-safe:transition-[transform,opacity] ${
              isActive ? 'ring-2 ring-brand/60' : ''
            }`}
          >
            <KpiTile
              density="flat"
              label={tile.label}
              value={loading ? '…' : count}
              sublabel={
                loading
                  ? `last ${windowDays}d`
                  : total > 0
                    ? `${sharePct}% of ${total} · last ${windowDays}d${isActive ? ' · filtering' : ''}`
                    : `last ${windowDays}d${isActive ? ' · filtering' : ''}`
              }
              accent={tile.accent}
              meaning={tile.meaning}
              series={sparks[tile.key]}
              delta={severityDelta(sparks[tile.key])}
              seriesAriaLabel={`${tile.label} reports per day, last ${windowDays} days`}
              variant={isHero ? 'primary' : 'default'}
            />
            {!loading && total > 0 && sharePct > 0 ? (
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-surface-overlay/40"
                aria-hidden="true"
              >
                <div
                  className={`h-full motion-safe:transition-[width] ${TONE_SHARE_BAR[tile.accent]}`}
                  style={{ width: `${sharePct}%` }}
                />
              </div>
            ) : null}
          </button>
        )
      })}
    </MetricStrip>
  )
}
