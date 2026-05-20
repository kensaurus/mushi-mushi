/**
 * FILE: apps/admin/src/components/charts.tsx
 * PURPOSE: Shared visual primitives used across Dashboard, Judge, Queue,
 *          Fixes, and Prompt Lab. Extracted so every page speaks the same
 *          visual language — Kpi tiles, sparklines, stacked bars, status pills.
 */

import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Card, Badge, Tooltip } from './ui'
import { useBrushSelection } from '../lib/useBrushSelection'
import { ChartFrame } from './charts/ChartFrame'
import {
  buildYTickValues,
  formatChartCount,
  formatChartUsd,
  resolveChartMax,
  shortDay,
} from './charts/chartAxis'

export { shortDay, formatChartCount, formatChartUsd } from './charts/chartAxis'
export { ChartFrame } from './charts/ChartFrame'

/* ── KpiTile ────────────────────────────────────────────────────────────── */

export type Tone = 'ok' | 'warn' | 'danger' | 'brand' | 'muted' | 'info'

const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  brand: 'text-brand',
  muted: 'text-fg-muted',
  info: 'text-info',
}

const ARROW: Record<'up' | 'down' | 'flat', string> = {
  up: '↑',
  down: '↓',
  flat: '·',
}

export interface KpiDelta {
  value: string
  direction: 'up' | 'down' | 'flat'
  tone: Tone
}

export interface KpiTileProps {
  label: string
  value: string | number
  sublabel?: string
  to?: string
  accent?: Tone
  delta?: KpiDelta | null
  /** One-line "what does this number mean for me?" copy. Renders as a
   *  cursor-help hint on the tile so the dashboard answers a question
   *  rather than dumping a number. Audit P0 from 2026-04-19. */
  meaning?: string
  /** Optional trend series rendered as a tiny sparkline footer. Round 2
   *  polish: every KPI row now shows momentum, not just a snapshot.
   *  Series should be in chronological order (oldest → newest). */
  series?: number[]
  /** Optional accent class for the sparkline (Tailwind `text-*`). Defaults to
   *  matching the tile accent so the spark visually anchors to the number. */
  seriesAccent?: string
  /** Optional aria label for the sparkline. Defaults to `${label} trend`. */
  seriesAriaLabel?: string
}

const TONE_SPARK_ACCENT: Record<Tone, string> = {
  ok: 'text-ok/70',
  warn: 'text-warn/70',
  danger: 'text-danger/70',
  brand: 'text-brand/70',
  muted: 'text-fg-faint',
  info: 'text-info/70',
}

export function KpiTile({
  label,
  value,
  sublabel,
  to,
  accent,
  delta,
  meaning,
  series,
  seriesAccent,
  seriesAriaLabel,
}: KpiTileProps) {
  const showSpark = Array.isArray(series) && series.length >= 2 && series.some((v) => v > 0)
  const sparkColour = seriesAccent ?? (accent ? TONE_SPARK_ACCENT[accent] : 'text-fg-faint')
  const inner = (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-1 truncate">
        <div className="text-2xs text-fg-muted uppercase tracking-wider truncate">{label}</div>
        {meaning && (
          <Tooltip content={meaning}>
            <span
              aria-label={meaning}
              className="inline-flex h-3 w-3 items-center justify-center rounded-full border border-edge text-3xs text-fg-faint hover:text-fg-muted hover:border-fg-faint cursor-help"
            >
              <span aria-hidden="true" className="leading-none italic font-serif">i</span>
            </span>
          </Tooltip>
        )}
      </div>
      <div className="flex items-baseline gap-1.5 mt-1 min-w-0">
        <div
          className={`text-lg font-semibold font-mono truncate ${
            accent ? TONE_TEXT[accent] : 'text-fg'
          }`}
        >
          {value}
        </div>
        {delta && (
          <span
            className={`text-3xs font-mono shrink-0 ${TONE_TEXT[delta.tone]}`}
            title="vs prior period"
          >
            {ARROW[delta.direction]}
            {delta.value}
          </span>
        )}
      </div>
      {sublabel && (
        <div className="text-2xs text-fg-faint mt-0.5 truncate">{sublabel}</div>
      )}
      {showSpark && (
        <div className="-mx-1 mt-1.5" aria-hidden={seriesAriaLabel ? undefined : true}>
          <LineSparkline
            values={series!}
            accent={sparkColour}
            ariaLabel={seriesAriaLabel ?? `${label} trend`}
            height={18}
          />
        </div>
      )}
    </div>
  )
  if (to) {
    return (
      <Card elevated interactive>
        <Link
          to={to}
          className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded-md"
        >
          {inner}
        </Link>
      </Card>
    )
  }
  return <Card elevated>{inner}</Card>
}

/* ── LegendDot ──────────────────────────────────────────────────────────── */

export function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block w-2 h-2 rounded-sm ${color}`} />
      <span>{label}</span>
    </span>
  )
}

/* ── LineSparkline ──────────────────────────────────────────────────────── */

export type ChartValueFormat = 'count' | 'usd' | 'percent' | 'raw'

function formatChartValue(n: number, format: ChartValueFormat): string {
  if (format === 'usd') return formatChartUsd(n)
  if (format === 'percent') return `${(n * 100).toFixed(0)}%`
  if (format === 'count') return formatChartCount(n)
  return Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : '—'
}

/**
 * Wave T.4.7 range-select bridge. When the caller provides `timestamps`
 * alongside `values`, `LineSparkline` registers a headless brush via
 * `useBrushSelection` and emits the selected ISO range through
 * `onRangeSelect`. Without `timestamps` the brush is disabled — the
 * component gracefully degrades to a pure decoration.
 */
export function LineSparkline({
  values,
  accent = 'text-brand',
  ariaLabel = 'Trend',
  height = 28,
  timestamps,
  xLabels,
  showAxes = false,
  valueFormat = 'count',
  scaleToData = false,
  yAxisCaption,
  xAxisCaption,
  showPeakLabel = false,
  onRangeSelect,
}: {
  values: number[]
  accent?: string
  ariaLabel?: string
  height?: number
  /** ISO strings aligned 1:1 with `values`. Required to enable brushing. */
  timestamps?: string[]
  /** X-axis day/bucket labels; defaults to short-form `timestamps`. */
  xLabels?: string[]
  showAxes?: boolean
  valueFormat?: ChartValueFormat
  scaleToData?: boolean
  yAxisCaption?: string
  xAxisCaption?: string
  showPeakLabel?: boolean
  onRangeSelect?: (range: { fromIso: string; toIso: string }) => void
}) {
  const brush = useBrushSelection({
    dataLength: values.length,
    disabled: !onRangeSelect || !timestamps || timestamps.length !== values.length,
    onCommit: ({ start, end }) => {
      if (!timestamps || !onRangeSelect) return
      const fromIso = timestamps[start]
      const toIso = timestamps[end]
      if (!fromIso || !toIso) return
      onRangeSelect({ fromIso, toIso })
    },
  })

  if (values.length === 0) return null

  const min = Math.min(0, ...values)
  const chartMax = resolveChartMax(values, scaleToData)
  const range = chartMax - min || 1
  const plotHeight = showAxes ? Math.max(height, 56) : height
  const w = 100
  const h = plotHeight
  const step = w / Math.max(1, values.length - 1)
  const points = values
    .map(
      (v, i) =>
        `${(i * step).toFixed(2)},${(h - ((v - min) / range) * (h - 2) - 1).toFixed(2)}`,
    )
    .join(' ')

  const peakIdx = values.reduce((best, v, i) => (v > values[best] ? i : best), 0)
  const peakVal = values[peakIdx] ?? 0
  const rawPeak = Math.max(...values, 0)
  const yTicks = buildYTickValues(rawPeak, min, 4).map((v) => formatChartValue(v, valueFormat))
  const axisX =
    xLabels ??
    (timestamps?.map((t) => shortDay(t.slice(0, 10))) ?? [])

  const preview = brush.isDragging && brush.previewStart != null && brush.previewEnd != null
    ? {
        x: Math.min(brush.previewStart, brush.previewEnd) * step,
        width: Math.abs(brush.previewEnd - brush.previewStart) * step,
      }
    : null

  const svg = (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={`w-full h-full ${accent} ${onRangeSelect ? 'cursor-crosshair touch-none select-none' : ''}`}
      role="img"
      aria-label={ariaLabel}
      onPointerDown={brush.onPointerDown}
      onPointerMove={brush.onPointerMove}
      onPointerUp={brush.onPointerUp}
      onPointerCancel={() => brush.cancel()}
    >
      {showAxes && (
        <polyline
          points={points}
          fill="currentColor"
          fillOpacity={0.08}
          stroke="none"
        />
      )}
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={showAxes ? 1.5 : 1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {values.map((v, i) => {
        if (v <= 0) return null
        const x = values.length > 1 ? i * step : w / 2
        const y = h - ((v - min) / range) * (h - 2) - 1
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={showAxes ? 1.8 : 0}
            fill="currentColor"
            className={showAxes ? 'opacity-90' : 'opacity-0'}
          />
        )
      })}
      {preview && (
        <rect
          x={preview.x}
          y={0}
          width={preview.width}
          height={h}
          fill="currentColor"
          opacity={0.15}
          pointerEvents="none"
        />
      )}
    </svg>
  )

  const peakCaption =
    showPeakLabel && peakVal > 0 ? (
      <p className="mt-1 text-3xs font-mono text-fg-faint tabular-nums">
        peak {formatChartValue(peakVal, valueFormat)}
        {axisX[peakIdx] ? ` · ${axisX[peakIdx]}` : ''}
      </p>
    ) : null

  if (!showAxes) {
    return (
      <div>
        <div style={{ height: `${height}px` }}>{svg}</div>
        {peakCaption}
      </div>
    )
  }

  return (
    <div>
      <ChartFrame
        height={plotHeight}
        yTickLabels={yTicks}
        xLabels={axisX.length > 0 ? axisX : undefined}
        yAxisCaption={yAxisCaption}
        xAxisCaption={xAxisCaption}
      >
        {svg}
      </ChartFrame>
      {peakCaption}
    </div>
  )
}

/* ── BarSparkline (single colour) ───────────────────────────────────────── */

export function BarSparkline({
  values,
  accent = 'bg-brand',
  height = 28,
  ariaLabel = 'Bar trend',
  timestamps,
  xLabels,
  barTitles,
  scaleToData = false,
  showAxes = false,
  valueFormat = 'count',
  yAxisCaption,
  xAxisCaption,
  showBarLabels = false,
  showPeakLabel = false,
  onRangeSelect,
}: {
  values: number[]
  accent?: string
  height?: number
  ariaLabel?: string
  timestamps?: string[]
  xLabels?: string[]
  barTitles?: string[]
  scaleToData?: boolean
  showAxes?: boolean
  valueFormat?: ChartValueFormat
  yAxisCaption?: string
  xAxisCaption?: string
  /** Print formatted values above non-zero bars (use on wide charts only). */
  showBarLabels?: boolean
  showPeakLabel?: boolean
  onRangeSelect?: (range: { fromIso: string; toIso: string }) => void
}) {
  const brush = useBrushSelection({
    dataLength: values.length,
    disabled: !onRangeSelect || !timestamps || timestamps.length !== values.length,
    onCommit: ({ start, end }) => {
      if (!timestamps || !onRangeSelect) return
      const fromIso = timestamps[start]
      const toIso = timestamps[end]
      if (!fromIso || !toIso) return
      onRangeSelect({ fromIso, toIso })
    },
  })

  if (values.length === 0) return null

  const peak = Math.max(...values)
  const peakIdx = values.indexOf(peak)
  const chartMax = resolveChartMax(values, scaleToData)
  const plotHeight = showAxes ? Math.max(height, 80) : height
  const yTicks = buildYTickValues(chartMax / 1.12, 0, 4).map((v) =>
    formatChartValue(v, valueFormat),
  )
  const activeCount = values.filter((v) => v > 0).length
  const showIdleBaseline = showAxes && activeCount < values.length
  const axisX =
    xLabels ??
    (timestamps?.map((t) => shortDay(t.slice(0, 10))) ?? [])

  const bars = (
    <div
      className={`relative flex h-full items-end gap-[3px] w-full ${onRangeSelect ? 'cursor-crosshair touch-none select-none' : ''}`}
      role="img"
      aria-label={ariaLabel}
      onPointerDown={brush.onPointerDown}
      onPointerMove={brush.onPointerMove}
      onPointerUp={brush.onPointerUp}
      onPointerCancel={() => brush.cancel()}
    >
      {values.map((v, i) => {
        const isPeak = i === peakIdx && v > 0
        const isToday = i === values.length - 1
        const label =
          showBarLabels && v > 0 && (activeCount > 2 || isPeak)
            ? formatChartValue(v, valueFormat)
            : null
        const isIdle = v <= 0
        return (
          <div
            key={i}
            className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end"
          >
            {label && (
              <span
                className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-sm bg-surface-overlay/90 px-1 py-px text-3xs font-mono tabular-nums shadow-sm ${
                  isPeak ? 'text-brand font-semibold' : 'text-fg-muted'
                }`}
                aria-hidden="true"
              >
                {label}
              </span>
            )}
            {isIdle && showIdleBaseline ? (
              <div
                className={`h-1 w-1 rounded-full bg-fg-faint/30 motion-safe:transition-colors group-hover:bg-fg-faint/50 ${
                  isToday ? 'ring-1 ring-edge-subtle ring-offset-1 ring-offset-transparent' : ''
                }`}
                title={barTitles?.[i] ?? `${axisX[i] ?? i}: no spend`}
              />
            ) : (
              <div
                className={`mx-auto w-[72%] max-w-[11px] min-w-[4px] ${accent} rounded-t-sm motion-safe:transition-all ${
                  isPeak ? 'opacity-100 shadow-sm shadow-brand/40' : 'opacity-80 group-hover:opacity-100'
                } ${isToday && v > 0 ? 'ring-1 ring-brand/40 ring-offset-1 ring-offset-transparent' : ''}`}
                style={{
                  height: `${(v / chartMax) * 100}%`,
                  minHeight: v > 0 ? '4px' : 0,
                }}
                title={barTitles?.[i] ?? `${axisX[i] ?? i}: ${formatChartValue(v, valueFormat)}`}
              />
            )}
          </div>
        )
      })}
      {brush.isDragging && brush.previewStart != null && brush.previewEnd != null && (
        <div
          aria-hidden="true"
          className="absolute inset-y-0 bg-brand/20 pointer-events-none"
          style={{
            left: `${(Math.min(brush.previewStart, brush.previewEnd) / Math.max(1, values.length - 1)) * 100}%`,
            width: `${(Math.abs(brush.previewEnd - brush.previewStart) / Math.max(1, values.length - 1)) * 100}%`,
          }}
        />
      )}
    </div>
  )

  const peakCaption =
    showPeakLabel && peak > 0 ? (
      <p className="mt-1 text-3xs font-mono text-fg-faint tabular-nums">
        peak {formatChartValue(peak, valueFormat)}
        {axisX[peakIdx] ? ` · ${axisX[peakIdx]}` : ''}
      </p>
    ) : null

  if (!showAxes) {
    return (
      <div>
        <div style={{ height: `${height}px` }}>{bars}</div>
        {peakCaption}
      </div>
    )
  }

  return (
    <div>
      <ChartFrame
        height={plotHeight}
        yTickLabels={yTicks}
        xLabels={axisX.length > 0 ? axisX : undefined}
        yAxisCaption={yAxisCaption}
        xAxisCaption={xAxisCaption}
      >
        {bars}
      </ChartFrame>
      {peakCaption}
    </div>
  )
}

/* ── SeverityStackedBars ────────────────────────────────────────────────── */

export interface SeverityDay {
  day: string
  total: number
  critical: number
  high: number
  medium: number
  low: number
  unscored?: number
}

export function SeverityStackedBars({ data }: { data: SeverityDay[] }) {
  const max = Math.max(1, ...data.map((d) => d.total))
  const totalReports = data.reduce((sum, d) => sum + d.total, 0)
  return (
    <div>
      <div className="flex gap-1.5">
        <div
          className="flex flex-col justify-between items-end h-24 text-3xs text-fg-faint font-mono select-none"
          aria-hidden="true"
        >
          <span>{max}</span>
          <span>0</span>
        </div>
        <div className="flex items-end gap-1 h-24 flex-1" role="group" aria-label={`Daily severity breakdown · ${totalReports} reports across ${data.length} days`}>
          {data.map((d) => {
            const totalH = (d.total / max) * 100
            const seg = (n: number) => (d.total > 0 ? (n / d.total) * 100 : 0)
            return (
              <SeverityBarColumn
                key={d.day}
                day={d}
                totalH={totalH}
                seg={seg}
              />
            )
          })}
        </div>
      </div>
      <div className="flex justify-between text-3xs text-fg-faint font-mono mt-1 pl-5">
        <span>{shortDay(data[0]?.day ?? '')}</span>
        <span className="text-fg-faint/70">reports per day</span>
        <span>{shortDay(data[data.length - 1]?.day ?? '')}</span>
      </div>
      <div className="flex flex-wrap gap-2 mt-2 text-3xs text-fg-muted">
        <LegendDot color="bg-danger" label="Critical" />
        <LegendDot color="bg-warn" label="High" />
        <LegendDot color="bg-info" label="Medium" />
        <LegendDot color="bg-ok" label="Low" />
        {data.some((d) => d.unscored != null) && (
          <LegendDot color="bg-fg-faint/40" label="Unscored" />
        )}
      </div>
    </div>
  )
}

function SeverityBarColumn({
  day,
  totalH,
  seg,
}: {
  day: SeverityDay
  totalH: number
  seg: (n: number) => number
}) {
  // Hover surfaces a rich breakdown popover so users can answer "what's in
  // that spike?" without leaving the chart. Round 2 polish — replaces the
  // plain `title` attribute that only worked after a long browser delay.
  // The popover is purely presentational; assistive tech reads the column's
  // aria-label below for the same content in one synchronous announcement.
  const ariaSummary = `${shortDay(day.day)}: ${day.total} reports — ${day.critical} critical, ${day.high} high, ${day.medium} medium, ${day.low} low${
    day.unscored != null ? `, ${day.unscored} unscored` : ''
  }`
  return (
    <div
      className="group relative flex-1 h-full"
      role="img"
      aria-label={ariaSummary}
    >
      {day.total > 0 && (
        <span
          className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-0.5 -translate-x-1/2 text-3xs font-mono font-medium tabular-nums text-fg-muted"
          aria-hidden="true"
        >
          {day.total}
        </span>
      )}
      {day.total > 0 && (
        <div
          className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 -translate-y-1 z-20 mb-4 min-w-[10rem] rounded-md bg-surface-overlay border border-edge-subtle px-2 py-1.5 text-3xs text-fg shadow-card opacity-0 motion-safe:transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          aria-hidden="true"
        >
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="font-medium">{shortDay(day.day)}</span>
            <span className="font-mono text-fg-muted">{day.total} total</span>
          </div>
          <ul className="space-y-0.5 font-mono">
            {day.critical > 0 && (
              <li className="flex justify-between"><span className="text-danger">● critical</span><span>{day.critical}</span></li>
            )}
            {day.high > 0 && (
              <li className="flex justify-between"><span className="text-warn">● high</span><span>{day.high}</span></li>
            )}
            {day.medium > 0 && (
              <li className="flex justify-between"><span className="text-info">● medium</span><span>{day.medium}</span></li>
            )}
            {day.low > 0 && (
              <li className="flex justify-between"><span className="text-ok">● low</span><span>{day.low}</span></li>
            )}
            {day.unscored != null && day.unscored > 0 && (
              <li className="flex justify-between"><span className="text-fg-faint">● unscored</span><span>{day.unscored}</span></li>
            )}
            {day.total === 0 && <li className="text-fg-faint">No reports</li>}
          </ul>
        </div>
      )}
      <button
        type="button"
        tabIndex={day.total > 0 ? 0 : -1}
        aria-label={ariaSummary}
        className="absolute inset-x-0 bottom-0 flex flex-col-reverse items-stretch gap-px focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded-sm cursor-default"
        style={{ height: `${Math.max(2, totalH)}%` }}
      >
        <span aria-hidden="true" className="block bg-danger motion-safe:transition-opacity group-hover:opacity-90" style={{ height: `${seg(day.critical)}%` }} />
        <span aria-hidden="true" className="block bg-warn motion-safe:transition-opacity group-hover:opacity-90" style={{ height: `${seg(day.high)}%` }} />
        <span aria-hidden="true" className="block bg-info motion-safe:transition-opacity group-hover:opacity-90" style={{ height: `${seg(day.medium)}%` }} />
        <span aria-hidden="true" className="block bg-ok motion-safe:transition-opacity group-hover:opacity-90" style={{ height: `${seg(day.low)}%` }} />
        {day.unscored != null && (
          <span aria-hidden="true" className="block bg-fg-faint/40" style={{ height: `${seg(day.unscored)}%` }} />
        )}
      </button>
    </div>
  )
}

/* ── HealthPill ─────────────────────────────────────────────────────────── */

export function HealthPill({ status }: { status: string | null | undefined }) {
  if (status === 'ok')
    return (
      <Badge className="bg-ok/15 text-ok border border-ok/30">Healthy</Badge>
    )
  if (status === 'degraded')
    return (
      <Badge className="bg-warn/15 text-warn border border-warn/30">
        Degraded
      </Badge>
    )
  if (status === 'down')
    return (
      <Badge className="bg-danger/15 text-danger border border-danger/30">
        Down
      </Badge>
    )
  return (
    <Badge className="bg-fg-faint/15 text-fg-muted border border-edge-subtle">
      Unknown
    </Badge>
  )
}

/* ── StatusPill ─────────────────────────────────────────────────────────── */

const STATUS_CLASS: Record<string, string> = {
  new: 'bg-warn/15 text-warn border-warn/30',
  pending: 'bg-warn/15 text-warn border-warn/30',
  queued: 'bg-info/15 text-info border-info/30',
  running: 'bg-info/15 text-info border-info/30',
  classified: 'bg-ok/15 text-ok border-ok/30',
  completed: 'bg-ok/15 text-ok border-ok/30',
  fixing: 'bg-brand/15 text-brand border-brand/30',
  fixed: 'bg-info/15 text-info border-info/30',
  failed: 'bg-danger/15 text-danger border-danger/30',
  dead_letter: 'bg-danger/15 text-danger border-danger/30',
  rejected: 'bg-danger/15 text-danger border-danger/30',
  dismissed: 'bg-fg-faint/15 text-fg-muted border-edge-subtle',
}

export function StatusPill({ status }: { status: string | null | undefined }) {
  const cls =
    STATUS_CLASS[status ?? ''] ??
    'bg-fg-faint/15 text-fg-muted border-edge-subtle'
  return (
    <Badge className={`border ${cls} text-3xs`}>{status ?? 'unknown'}</Badge>
  )
}

/* ── Histogram (bucketed values, e.g. judge score distribution) ─────────── */

export function Histogram({
  buckets,
  labels,
  accent = 'bg-brand',
  height = 80,
  showAxes = true,
  valueFormat = 'count',
  yAxisCaption,
  xAxisCaption = 'Score bucket',
}: {
  buckets: number[]
  labels?: string[]
  accent?: string
  height?: number
  showAxes?: boolean
  valueFormat?: ChartValueFormat
  yAxisCaption?: string
  xAxisCaption?: string
}) {
  if (buckets.length === 0) return null
  const peak = Math.max(1, ...buckets)
  const chartMax = peak * 1.12
  const yTicks = buildYTickValues(peak, 0, 4).map((v) => formatChartValue(v, valueFormat))
  const xLabs = labels ?? buckets.map((_, i) => String(i))

  const bars = (
    <div className="flex h-full items-end gap-1 w-full">
      {buckets.map((v, i) => {
        const label = labels?.[i] ?? String(i)
        const summary = `${label}: ${formatChartValue(v, valueFormat)}`
        return (
          <div key={i} className="group relative flex h-full flex-1 flex-col justify-end">
            {v > 0 && showAxes && (
              <span
                className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-0.5 -translate-x-1/2 text-3xs font-mono text-fg-faint tabular-nums"
                aria-hidden="true"
              >
                {formatChartValue(v, valueFormat)}
              </span>
            )}
            {v > 0 && !showAxes && (
              <div
                className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 -translate-y-1 z-20 mb-1 whitespace-nowrap rounded-md bg-surface-overlay border border-edge-subtle px-2 py-1 text-3xs text-fg shadow-card opacity-0 motion-safe:transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                aria-hidden="true"
              >
                <span className="font-medium">{label}</span>
                <span className="ml-2 font-mono text-fg-muted">{v}</span>
              </div>
            )}
            <button
              type="button"
              tabIndex={v > 0 ? 0 : -1}
              aria-label={summary}
              className={`w-full ${accent} rounded-t-sm motion-safe:transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 cursor-default`}
              style={{
                height: `${(v / chartMax) * 100}%`,
                minHeight: v > 0 ? '2px' : '0',
              }}
            />
          </div>
        )
      })}
    </div>
  )

  if (!showAxes) {
    return (
      <div>
        <div style={{ height: `${height}px` }}>{bars}</div>
        {labels && (
          <div className="mt-1 flex justify-between text-3xs font-mono text-fg-faint">
            {labels.map((l, i) => (
              <span key={i}>{l}</span>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <ChartFrame
      height={height}
      yTickLabels={yTicks}
      xLabels={xLabs}
      yAxisCaption={yAxisCaption ?? 'Count'}
      xAxisCaption={xAxisCaption}
    >
      {bars}
    </ChartFrame>
  )
}

/* ── KpiRow (responsive grid wrapper) ───────────────────────────────────── */

export function KpiRow({
  children,
  cols = 4,
}: {
  children: ReactNode
  cols?: 3 | 4 | 5 | 6 | 7
}) {
  const colsCls =
    cols === 7
      ? 'grid-cols-2 md:grid-cols-4 lg:grid-cols-7'
      : cols === 6
        ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6'
        : cols === 5
          ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5'
          : cols === 3
            ? 'grid-cols-2 md:grid-cols-3'
            : 'grid-cols-2 md:grid-cols-4'
  return <div className={`grid ${colsCls} gap-2`}>{children}</div>
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function formatPct(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(0)}%`
}
