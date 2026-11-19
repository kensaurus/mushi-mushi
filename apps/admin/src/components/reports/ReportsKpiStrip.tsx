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
import { PageLoadError } from '../PageLoadError'
import { SEVERITY_TRAFFIC } from '../../lib/severityTraffic'

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
  const title = `${last7} filed in the last 7 days vs ${prev7} the 7 days before`
  if (prev7 === 0) return { value: 'new', direction: 'up', tone: 'warn', title }
  const pct = Math.round(((last7 - prev7) / prev7) * 100)
  if (pct === 0) return { value: '0%', direction: 'flat', tone: 'muted', title }
  return {
    title,
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
  /** Click handler — the page applies the severity plus this tile's window
   *  and status (`days`, `status=active`) so the list matches the count. */
  onFilter: (severity: 'critical' | 'high' | 'medium' | 'low' | '', windowDays: number) => void
  windowDays?: number
}

/**
 * One severity palette for the whole console (lib/severityTraffic.ts, what
 * Home and the Bugs rows use): the tiles drew Medium blue and Low grey while
 * the rows beside them drew Medium yellow and Low green (R2 sweep
 * 2026-11-18). Each tile's trend line takes its severity's hue; only the two
 * problem severities colour the number itself (critical red, high amber).
 * @internal Exported for tests.
 */
export function severityTileSparkAccent(key: SeverityKey): string {
  return SEVERITY_TRAFFIC[key].bg.replace(/^bg-/, 'text-')
}

const TILES_ADVANCED: Array<{
  key: 'critical' | 'high' | 'medium' | 'low'
  label: string
  /** Number colour; null keeps the number ink. */
  accent: Tone | null
  meaning: string
}> = [
  { key: 'critical', label: 'Critical', accent: 'danger',
    meaning: 'Critical reports from the window that are not fixed yet (the line below counts all that came in). These usually block user flow: triage first.' },
  { key: 'high', label: 'High', accent: 'warn',
    meaning: 'High-severity reports — broken functionality but with a workaround. Schedule a fix before next release.' },
  { key: 'medium', label: 'Medium', accent: null,
    meaning: 'Medium-severity reports — annoyance or polish. Batch-review at end of week.' },
  { key: 'low', label: 'Low', accent: null,
    meaning: 'Low-severity reports — usually visual nits or confusion. Useful signal, low individual urgency.' },
]

const TILES_PLAIN: typeof TILES_ADVANCED = [
  { key: 'critical', label: 'Critical', accent: 'danger',
    meaning: 'Bugs that block user flow — review these first.' },
  { key: 'high', label: 'High', accent: 'warn',
    meaning: 'Broken functionality with a workaround — fix before next release.' },
  { key: 'medium', label: 'Medium', accent: null,
    meaning: 'Annoyance or polish issues — batch-review at end of week.' },
  { key: 'low', label: 'Low', accent: null,
    meaning: 'Visual nits or confusion — low urgency individually.' },
]

export function ReportsKpiStrip({ scope = 'project', activeSeverity, onFilter, windowDays = 14 }: Props) {
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
        const isActive = activeSeverity === tile.key
        const total = data?.total ?? 0
        const count = counts[tile.key]
        // Lead with what is still open; how many came in is the sub-line.
        const openCount = data?.openBySeverity?.[tile.key]
        const sharePct = total > 0 ? Math.round((count / total) * 100) : 0
        const isHero = tile.key === 'critical' && (data?.openBySeverity?.critical ?? criticalCount) > 0
        return (
          <button
            key={tile.key}
            type="button"
            onClick={() => onFilter(isActive ? '' : tile.key, windowDays)}
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
              // The quick-filter chips count all time; these tiles count a
              // window, so the label says which. "Not fixed", not "open": the
              // Open chip below means "waiting on a decision" and counted 280
              // beside tiles adding up to 511 (2026-10-28). The window goes in
              // the label too: "Critical · not fixed 3" beside "Critical 40"
              // and Home's all-open count read as a contradiction (2026-11-19).
              label={openCount == null ? `${tile.label} · ${windowDays} d` : `${tile.label} · ${windowDays} d, not fixed`}
              value={loading ? '…' : (openCount ?? count)}
              sublabel={
                loading
                  ? `last ${windowDays} days`
                  : openCount != null
                    ? `${count} filed · ${count - openCount} closed${isActive ? ' · filtering' : ''}`
                    : total > 0
                      ? `${sharePct}% of ${total} in ${windowDays}d${isActive ? ' · filtering' : ''}`
                      : `none in ${windowDays}d${isActive ? ' · filtering' : ''}`
              }
              accent={tile.accent ?? undefined}
              seriesAccent={severityTileSparkAccent(tile.key)}
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
            {/* No unlabeled share bar under the tile: its width (share of the
                window) had no label and the sub-line already gives the
                counts (R2 sweep 2026-11-18). */}
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
