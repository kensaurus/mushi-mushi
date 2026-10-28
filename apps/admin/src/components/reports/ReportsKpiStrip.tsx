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
import { criticalTileActive, criticalTileLabel } from '../../lib/criticalSurfaces'
import { PageLoadError } from '../PageLoadError'

type SeverityKey = 'critical' | 'high' | 'medium' | 'low'

interface SeverityStats {
  window_days: number
  bySeverity: Record<SeverityKey, number>
  /** Of those, still open (not fixed, resolved or verified). Absent from an older API. */
  openBySeverity?: Record<SeverityKey, number>
  byDay?: Array<{ day: string } & Record<SeverityKey | 'total', number>>
  /** All apps, and the day scan was shorter than the exact total. */
  byDayCapped?: boolean
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
  /** `enumeration` counts every app (All apps). Default is the pinned app. */
  scope?: 'enumeration' | 'project'
  /** Currently active severity filter (so we can highlight the matching tile). */
  activeSeverity?: string
  /**
   * The list's status and days. When set (including ''), the tile highlights
   * only if the list is this tile's query (severity + window + unresolved).
   * Omitted, the tile highlights on severity alone.
   */
  listStatus?: string
  listDays?: string
  /** Click handler — the page applies the severity plus this tile's window
   *  and status (`days`, `status=unresolved`) so the list matches the count. */
  onFilter: (severity: 'critical' | 'high' | 'medium' | 'low' | '', windowDays: number) => void
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
    meaning: 'Critical reports from the window that are not fixed yet (the line below counts all that came in). These usually block user flow: triage first.' },
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

export function ReportsKpiStrip({ scope = 'project', activeSeverity, listStatus, listDays, onFilter, windowDays = 14 }: Props) {
  const { isAdvanced } = useAdminMode()
  const tiles = isAdvanced ? TILES_ADVANCED : TILES_PLAIN
  const { data, loading, error, reload } = usePageData<SeverityStats>(
    `/v1/admin/reports/severity-stats?days=${windowDays}`,
    { deps: [windowDays, scope], scope },
  )

  const counts = data?.bySeverity ?? { critical: 0, high: 0, medium: 0, low: 0 }
  // A capped scan would draw a trend that does not add up to the tiles.
  const trendHidden = Boolean(data?.byDayCapped)
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
    // Plain-English cause and fix, never the raw `message (CODE)` string.
    return (
      <div className="mb-3">
        <PageLoadError error={error} resource="severity counts" onRetry={reload} />
      </div>
    )
  }

  const criticalCount = counts.critical

  return (
    <>
    <MetricStrip cols={4} panel ariaLabel="Reports severity breakdown" className="mb-3" stagger>
      {tiles.map((tile) => {
        const isActive =
          listStatus !== undefined
            ? criticalTileActive(
                { severity: activeSeverity ?? '', status: listStatus, days: listDays ?? '' },
                tile.key,
                windowDays,
              )
            : activeSeverity === tile.key
        const total = data?.total ?? 0
        const count = counts[tile.key]
        // Lead with what is still open; how many came in is the sub-line.
        const openCount = data?.openBySeverity?.[tile.key]
        const scopeLabel = openCount == null ? `${tile.label} · ${windowDays}d` : criticalTileLabel(tile.label, windowDays)
        const sharePct = total > 0 ? Math.round((count / total) * 100) : 0
        const isHero = tile.key === 'critical' && (data?.openBySeverity?.critical ?? criticalCount) > 0
        return (
          <button
            key={tile.key}
            type="button"
            onClick={() => onFilter(isActive ? '' : tile.key, windowDays)}
            aria-pressed={isActive}
            aria-label={isActive ? `Clear ${scopeLabel} filter` : `Show ${scopeLabel}`}
            className={`relative block w-full min-w-0 overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 motion-safe:transition-[transform,opacity] ${
              isActive ? 'ring-2 ring-brand/60' : ''
            }`}
          >
            <KpiTile
              density="flat"
              // The quick-filter chips count all time, any status. This number is
              // reports from the window that are not closed, so the label says
              // both and the line under it is that number's composition.
              label={scopeLabel}
              value={loading ? '…' : (openCount ?? count)}
              sublabel={
                loading
                  ? `last ${windowDays} days`
                  : openCount != null
                    ? count > 0
                      ? `of ${count} filed in ${windowDays}d · ${count - openCount} closed${isActive ? ' · filtering' : ''}`
                      : `none in ${windowDays}d${isActive ? ' · filtering' : ''}`
                    : total > 0
                      ? `${sharePct}% of ${total} in ${windowDays}d${isActive ? ' · filtering' : ''}`
                      : `none in ${windowDays}d${isActive ? ' · filtering' : ''}`
              }
              accent={tile.accent}
              meaning={tile.meaning}
              series={trendHidden ? [] : sparks[tile.key]}
              delta={trendHidden ? null : severityDelta(sparks[tile.key])}
              seriesAriaLabel={`${tile.label} reports per day, last ${windowDays} days`}
              // The per-day series only exists after the fetch; without the
              // reservation the four tiles grow a sparkline row on load and
              // shove the filters and the table down the page.
              reserveSeriesSpace
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
    {trendHidden ? (
      <p className="-mt-2 mb-3 text-2xs text-fg-muted" data-testid="reports-kpi-trend-cap">
        Daily trend is hidden: this window has more bugs than the chart can read. The counts above include every bug.
      </p>
    ) : null}
    </>
  )
}
