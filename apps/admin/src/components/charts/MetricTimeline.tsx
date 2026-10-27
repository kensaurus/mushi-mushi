/**
 * FILE: apps/admin/src/components/charts/MetricTimeline.tsx
 * PURPOSE: One metric over time with what happened around it: a dashed
 *          vertical line per release, and a dot on each spike (red while it
 *          waits for you, grey once confirmed or dismissed). Used by Mushi
 *          health → Unusual spikes and → Schema changes, so "did this start
 *          with a release?" is answered by looking, not by reading tiles.
 *
 *          One series, one y-axis. The line is an SVG polyline; markers and
 *          dots are positioned in HTML (percentages) so they stay round at any
 *          width. Every dot and marker has a hover tooltip (title) and is
 *          positioned against the plot itself: a tooltip wrapper would become
 *          the positioning parent and pin every mark to the left edge. A
 *          hidden table carries the same data for screen readers.
 */

import { ChartAccessibleSummary } from './ChartAccessibleSummary'

interface TimelinePoint {
  ts: string
  value: number
}

interface TimelineMarker {
  ts: string
  label: string
}

interface TimelineDot {
  ts: string
  value: number
  label: string
  /** `open`: waiting for the user (red); `closed`: already decided (grey). */
  state: 'open' | 'closed'
}

interface Props {
  points: readonly TimelinePoint[]
  markers?: readonly TimelineMarker[]
  dots?: readonly TimelineDot[]
  /** Names the series: the chart title says what is drawn. */
  title: string
  formatValue?: (v: number) => string
  height?: number
}

const VIEW_W = 1000

function time(ts: string): number {
  const t = Date.parse(ts)
  return Number.isFinite(t) ? t : NaN
}

function defaultFormat(v: number): string {
  return Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : String(Math.round(v * 1000) / 1000)
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** @internal Exported for tests only. Maps time and value to percentages of the plot. */
export function timelineScale(points: readonly TimelinePoint[], dots: readonly TimelineDot[] = []) {
  const ts = [...points, ...dots].map((p) => time(p.ts)).filter(Number.isFinite)
  const vs = [...points, ...dots].map((p) => p.value).filter(Number.isFinite)
  const t0 = Math.min(...ts)
  const t1 = Math.max(...ts)
  const v0 = Math.min(0, ...vs)
  const v1 = Math.max(...vs)
  const tSpan = t1 - t0 || 1
  const vSpan = v1 - v0 || 1
  return {
    t0,
    t1,
    v1,
    x: (iso: string) => ((time(iso) - t0) / tSpan) * 100,
    y: (v: number) => 100 - ((v - v0) / vSpan) * 100,
    inRange: (iso: string) => {
      const t = time(iso)
      return Number.isFinite(t) && t >= t0 && t <= t1
    },
  }
}

export function MetricTimeline({ points, markers = [], dots = [], title, formatValue = defaultFormat, height = 140 }: Props) {
  const sorted = [...points].filter((p) => Number.isFinite(time(p.ts))).sort((a, b) => time(a.ts) - time(b.ts))
  if (sorted.length === 0) return null
  const scale = timelineScale(sorted, dots)
  const line = sorted.map((p) => `${(scale.x(p.ts) / 100) * VIEW_W},${scale.y(p.value)}`).join(' ')
  const shownMarkers = markers.filter((m) => scale.inRange(m.ts))
  const shownDots = dots.filter((d) => scale.inRange(d.ts))

  return (
    <figure className="m-0 min-w-0 space-y-1.5" data-testid="metric-timeline">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 truncate text-xs font-medium text-fg">{title}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-muted">
          {shownMarkers.length > 0 ? (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="inline-block h-3 border-l border-dashed border-brand" />
              Release
            </span>
          ) : null}
          {shownDots.some((d) => d.state === 'open') ? (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-danger" />
              Spike to check
            </span>
          ) : null}
          {shownDots.some((d) => d.state === 'closed') ? (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-fg-faint" />
              Already decided
            </span>
          ) : null}
        </span>
      </figcaption>
      <div className="flex min-w-0 gap-2">
        <div className="flex shrink-0 flex-col justify-between py-0.5 text-right text-3xs tabular-nums text-fg-faint" aria-hidden="true">
          <span>{formatValue(scale.v1)}</span>
          <span>{formatValue(0)}</span>
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }} role="img" aria-label={`${title}: ${sorted.length} points, ${shownMarkers.length} releases, ${shownDots.length} spikes`}>
          <svg viewBox={`0 0 ${VIEW_W} 100`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
            <line x1="0" y1="100" x2={VIEW_W} y2="100" className="stroke-edge-subtle" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <polyline points={line} fill="none" className="stroke-brand" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {shownMarkers.map((m) => (
            <span
              key={`m-${m.ts}-${m.label}`}
              data-testid="metric-timeline-release"
              tabIndex={0}
              title={`Release ${m.label} · ${shortDate(time(m.ts))}`}
              aria-label={`Release ${m.label}, ${shortDate(time(m.ts))}`}
              className="absolute inset-y-0 w-3 -translate-x-1/2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              style={{ left: `${scale.x(m.ts)}%` }}
            >
              <span aria-hidden="true" className="absolute inset-y-0 left-1/2 border-l border-dashed border-brand/70" />
            </span>
          ))}
          {shownDots.map((d) => (
            <span
              key={`d-${d.ts}-${d.label}`}
              data-testid="metric-timeline-spike"
              data-state={d.state}
              tabIndex={0}
              title={`${d.label} · ${formatValue(d.value)} · ${shortDate(time(d.ts))}`}
              aria-label={`${d.label}, ${formatValue(d.value)}, ${shortDate(time(d.ts))}`}
              className={`absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-raised focus-visible:outline-none focus-visible:ring-brand/60 ${d.state === 'open' ? 'bg-danger' : 'bg-fg-faint'}`}
              style={{ left: `${scale.x(d.ts)}%`, top: `${scale.y(d.value)}%` }}
            />
          ))}
        </div>
      </div>
      <div className="flex justify-between pl-8 text-3xs text-fg-faint" aria-hidden="true">
        <span>{shortDate(scale.t0)}</span>
        <span>{shortDate(scale.t1)}</span>
      </div>
      {/* A table ignores sr-only's 1px width; the div holds it so the page never scrolls sideways. */}
      <div className="sr-only">
      <ChartAccessibleSummary
        caption={title}
        columns={[
          { key: 'when', label: 'When' },
          { key: 'what', label: 'What' },
          { key: 'value', label: 'Value' },
        ]}
        rows={[
          ...sorted.map((p) => ({ when: new Date(time(p.ts)).toLocaleString(), what: 'Value', value: formatValue(p.value) })),
          ...shownMarkers.map((m) => ({ when: new Date(time(m.ts)).toLocaleString(), what: `Release ${m.label}`, value: '—' })),
          ...shownDots.map((d) => ({ when: new Date(time(d.ts)).toLocaleString(), what: d.label, value: formatValue(d.value) })),
        ]}
      />
      </div>
    </figure>
  )
}
