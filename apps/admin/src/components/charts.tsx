/**
 * FILE: apps/admin/src/components/charts.tsx
 * PURPOSE: Shared visual primitives used across Dashboard, Judge, Queue,
 *          Fixes, and Prompt Lab. Extracted so every page speaks the same
 *          visual language — Kpi tiles, sparklines, stacked bars, status pills.
 */

import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Card, Badge, Tooltip, PANEL_HEADER_SEPARATOR } from './ui'
import { InlineProof, SignalChip } from './report-detail/ReportSurface'
import { useBrushSelection } from '../lib/useBrushSelection'
import { ChartFrame } from './charts/ChartFrame'
import {
  ChartHoverPopover,
  dayLabelAt,
  seriesXPercent,
  seriesYPercent,
  useSeriesHover,
} from './charts/ChartSeriesInteraction'
import {
  clampPlotTopPercent,
  summarizeSeriesValues,
} from './charts/ChartSeriesSummary'
import { ChartInlineDataLabels, buildInlineLabelPoints, formatInlineLabelValue, INLINE_LABEL_CLASS, INLINE_LABEL_KIND_ACCENT } from './charts/ChartInlineDataLabels'
import { SeverityColorLegend } from './charts/SeverityColorLegend'
import { SEVERITY_TRAFFIC } from '../lib/severityTraffic'
import {
  buildYTickValues,
  formatChartCount,
  formatChartDayLabel,
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
  /** ISO day strings aligned 1:1 with `series` — enables labeled axes. */
  seriesDays?: string[]
  /** Optional Y-axis caption for the sparkline (e.g. "runs / day"). */
  seriesYAxisCaption?: string
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
  seriesDays,
}: KpiTileProps) {
  const hasSeries = Array.isArray(series) && series.length >= 2
  const showSparkAxes = hasSeries && Array.isArray(seriesDays) && seriesDays.length === series!.length
  const showSpark = hasSeries && (series!.some((v) => v > 0) || showSparkAxes)
  const sparkColour = seriesAccent ?? (accent ? TONE_SPARK_ACCENT[accent] : 'text-fg-faint')
  const inner = (
    <div className="px-3 py-2.5">
      <div className={`pb-1.5 ${PANEL_HEADER_SEPARATOR}`}>
        <div className="flex items-center gap-1 truncate">
          <div className="text-2xs text-fg-muted uppercase tracking-wider truncate">{label}</div>
          {meaning && (
            <Tooltip content={meaning} side="auto" portal nowrap={false}>
              <span
                aria-label={meaning}
                className="inline-flex h-3 w-3 items-center justify-center rounded-full border border-edge text-3xs text-fg-faint hover:text-fg-muted hover:border-fg-faint cursor-help"
              >
                <span aria-hidden="true" className="leading-none italic font-serif">i</span>
              </span>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-1 min-w-0">
        <div
          className={`flex-1 min-w-0 text-lg font-semibold font-mono truncate ${
            accent ? TONE_TEXT[accent] : 'text-fg'
          }`}
        >
          {value}
        </div>
        {delta && (
          <span className="ml-auto shrink-0" title="vs prior period">
            <SignalChip tone={delta.tone === 'muted' ? 'neutral' : delta.tone} className="font-mono">
              {ARROW[delta.direction]}
              {delta.value}
            </SignalChip>
          </span>
        )}
      </div>
      {sublabel && (
        <InlineProof className="mt-0.5 truncate border-0 bg-transparent px-0 py-0">
          {sublabel}
        </InlineProof>
      )}
      {showSpark && (
        <div className="-mx-1 mt-1.5 w-full min-w-0 overflow-visible" aria-hidden={seriesAriaLabel ? undefined : true}>
          <LineSparkline
            values={series!}
            timestamps={showSparkAxes ? seriesDays : undefined}
            accent={sparkColour}
            ariaLabel={seriesAriaLabel ?? `${label} trend`}
            showAxes={showSparkAxes}
            scaleToData={showSparkAxes}
            valueFormat="count"
            showRangeSummary={showSparkAxes}
            seriesLabel={label}
            height={showSparkAxes ? 52 : 18}
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
  showRangeSummary = false,
  seriesLabel: _seriesLabel,
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
  /** @deprecated Prefer `showRangeSummary` — inline plot labels replace chip row. */
  showPeakLabel?: boolean
  /** Peak / today / low as inline labels on the plot (not chips above). */
  showRangeSummary?: boolean
  /** Label for summary chips + aria (e.g. "Tokens"). */
  seriesLabel?: string
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
  const { hoverIdx, onMouseMove, onMouseLeave } = useSeriesHover(
    values.length,
    showAxes && values.length > 0,
  )

  if (values.length === 0) return null

  const min = Math.min(0, ...values)
  const chartMax = resolveChartMax(values, scaleToData)
  const plotHeight = showAxes ? Math.max(height, 56) : height
  const xAt = (i: number) => seriesXPercent(i, values.length, showAxes ? 0 : 2)
  const yAt = (v: number) => seriesYPercent(v, min, chartMax, showAxes ? 2 : 2)
  const points = values
    .map((v, i) => `${xAt(i).toFixed(2)},${yAt(v).toFixed(2)}`)
    .join(' ')

  const rawPeak = Math.max(...values, 0)
  // Tick floor must match the plot floor (`min = Math.min(0, ...values)`) so
  // grid-line labels stay aligned with actual data-point positions on the SVG.
  const yTicks = buildYTickValues(rawPeak, min, 4).map((v) => formatChartValue(v, valueFormat))
  const axisXIso =
    timestamps?.map((t) => t.slice(0, 10)) ?? (xLabels ?? [])
  const useRangeSummary = showRangeSummary || showPeakLabel
  const summary = useRangeSummary ? summarizeSeriesValues(values) : null
  const labelIndices = new Set<number>()
  if (summary) {
    labelIndices.add(summary.peakIdx)
    labelIndices.add(summary.currentIdx)
    if (summary.minIdx !== summary.peakIdx) labelIndices.add(summary.minIdx)
  }

  const interactive = showAxes && values.length > 0
  const activeIdx =
    brush.isDragging || hoverIdx == null ? null : hoverIdx

  const preview =
    brush.isDragging && brush.previewStart != null && brush.previewEnd != null
      ? {
          left: seriesXPercent(Math.min(brush.previewStart, brush.previewEnd), values.length),
          width:
            seriesXPercent(Math.max(brush.previewStart, brush.previewEnd), values.length) -
            seriesXPercent(Math.min(brush.previewStart, brush.previewEnd), values.length),
        }
      : null

  const brushable = Boolean(onRangeSelect)
  const plotShell = (
    <div
      className={`relative h-full w-full ${brushable ? 'cursor-crosshair touch-none select-none' : interactive ? 'cursor-crosshair' : ''}`}
      role="img"
      aria-label={ariaLabel}
      onMouseMove={(e) => {
        if (!brush.isDragging) onMouseMove(e)
      }}
      onMouseLeave={onMouseLeave}
      onPointerDown={brush.onPointerDown}
      onPointerMove={brush.onPointerMove}
      onPointerUp={brush.onPointerUp}
      onPointerCancel={() => brush.cancel()}
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className={`pointer-events-none absolute inset-0 h-full w-full ${accent}`}
        aria-hidden="true"
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
          vectorEffect="non-scaling-stroke"
        />
        {values.map((v, i) => {
          if (v <= 0 && !labelIndices.has(i)) return null
          const isActive = activeIdx === i
          const isLabelPoint = labelIndices.has(i)
          if (!isActive && !isLabelPoint && !showAxes) return null
          return (
            <circle
              key={i}
              cx={xAt(i)}
              cy={yAt(v)}
              r={isActive ? 2.2 : isLabelPoint || showAxes ? 1.8 : 0}
              fill="currentColor"
              className={isActive || isLabelPoint || showAxes ? 'opacity-90' : 'opacity-0'}
            />
          )
        })}
      </svg>

      {useRangeSummary && (
        <ChartInlineDataLabels
          mode="line"
          values={values}
          timestamps={timestamps}
          valueFormat={valueFormat}
          xAt={xAt}
          yAt={yAt}
          activeIdx={activeIdx}
        />
      )}

      {activeIdx != null && values[activeIdx] != null && (
        <>
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-current opacity-25"
            style={{ left: `${xAt(activeIdx)}%` }}
            aria-hidden="true"
          />
          <div
            className={`pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-current bg-surface ${accent}`}
            style={{
              left: `${xAt(activeIdx)}%`,
              top: `${yAt(values[activeIdx])}%`,
            }}
            aria-hidden="true"
          />
          <ChartHoverPopover
            dayLabel={dayLabelAt(activeIdx, timestamps, xLabels)}
            valueLabel={formatChartValue(values[activeIdx], valueFormat)}
            visible
            style={{
              left: `${xAt(activeIdx)}%`,
              top: `${clampPlotTopPercent(yAt(values[activeIdx]) - 8)}%`,
            }}
          />
        </>
      )}

      {preview && (
        <div
          className="pointer-events-none absolute inset-y-0 bg-current opacity-15"
          style={{ left: `${preview.left}%`, width: `${Math.max(preview.width, 0.5)}%` }}
          aria-hidden="true"
        />
      )}
    </div>
  )

  if (!showAxes) {
    return (
      <div className="w-full min-w-0">
        <div className="h-full w-full" style={{ height: `${height}px` }}>
          {plotShell}
        </div>
      </div>
    )
  }

  return (
    <div className="w-full min-w-0">
      <ChartFrame
        height={plotHeight}
        yTickLabels={yTicks}
        xLabels={axisXIso.length > 0 ? axisXIso : undefined}
        yAxisCaption={yAxisCaption}
        xAxisCaption={xAxisCaption}
      >
        {plotShell}
      </ChartFrame>
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
  const { hoverIdx, onMouseMove, onMouseLeave } = useSeriesHover(
    values.length,
    showAxes && values.length > 0,
  )

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
  const axisXIso =
    timestamps?.map((t) => t.slice(0, 10)) ?? (xLabels ?? [])
  const axisXDisplay = axisXIso.map((iso) => formatChartDayLabel(iso))

  const bars = (
    <div
      className={`relative flex h-full w-full items-end gap-px ${onRangeSelect ? 'cursor-crosshair touch-none select-none' : showAxes ? 'cursor-crosshair' : ''}`}
      role="img"
      aria-label={ariaLabel}
      onMouseMove={(e) => {
        if (!brush.isDragging) onMouseMove(e)
      }}
      onMouseLeave={onMouseLeave}
      onPointerDown={brush.onPointerDown}
      onPointerMove={brush.onPointerMove}
      onPointerUp={brush.onPointerUp}
      onPointerCancel={() => brush.cancel()}
    >
      {values.map((v, i) => {
        const isPeak = i === peakIdx && v > 0
        const isHovered = !brush.isDragging && hoverIdx === i
        const isToday = i === values.length - 1
        const label =
          v > 0 &&
          ((showBarLabels && (activeCount > 2 || isPeak)) || (showPeakLabel && isPeak))
            ? formatChartValue(v, valueFormat)
            : null
        const isIdle = v <= 0
        const dayLabel = axisXDisplay[i] ?? `Day ${i + 1}`
        const valueLabel = isIdle
          ? '0'
          : formatChartValue(v, valueFormat)
        return (
          <div
            key={i}
            title={barTitles?.[i]}
            className={`group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end ${isHovered ? 'z-10' : ''}`}
          >
            {label && !isHovered && (
              <span
                className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-sm bg-surface-overlay/90 px-1 py-px text-3xs font-mono tabular-nums shadow-sm ${
                  isPeak ? 'text-brand font-semibold' : 'text-fg-muted'
                }`}
                aria-hidden="true"
              >
                {label}
              </span>
            )}
            <ChartHoverPopover
              dayLabel={dayLabel}
              valueLabel={valueLabel}
              visible={isHovered}
              style={{ left: '50%', bottom: '100%', marginBottom: '4px' }}
            />
            {isIdle && showIdleBaseline ? (
              <div
                className={`h-1 w-full max-w-[6px] rounded-full bg-fg-faint/30 motion-safe:transition-colors group-hover:bg-fg-faint/50 ${
                  isToday ? 'ring-1 ring-edge-subtle ring-offset-1 ring-offset-transparent' : ''
                } ${isHovered ? 'bg-fg-faint/60' : ''}`}
              />
            ) : (
              <div
                className={`w-full min-w-[3px] max-w-none ${accent} rounded-t-sm motion-safe:transition-all ${
                  isPeak || isHovered
                    ? 'opacity-100 shadow-sm shadow-brand/40'
                    : 'opacity-80 group-hover:opacity-100'
                } ${isToday && v > 0 ? 'ring-1 ring-brand/40 ring-offset-1 ring-offset-transparent' : ''}`}
                style={{
                  height: `${(v / chartMax) * 100}%`,
                  minHeight: v > 0 ? '4px' : 0,
                }}
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

  if (!showAxes) {
    return (
      <div className="w-full min-w-0">
        <div className="w-full" style={{ height: `${height}px` }}>
          {bars}
        </div>
      </div>
    )
  }

  return (
    <div className="w-full min-w-0">
      <ChartFrame
        height={plotHeight}
        yTickLabels={yTicks}
        xLabels={axisXIso.length > 0 ? axisXIso : undefined}
        yAxisCaption={yAxisCaption}
        xAxisCaption={xAxisCaption}
      >
        {bars}
      </ChartFrame>
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
  /* plotHeight is intentionally tall so the Report Intake card fills the
     same grid-row height as the LLM Activity card (which stacks two 72px
     sparklines + subheaders ≈ 256px of chart content). */
  const plotHeight = 196
  const yTicks = buildYTickValues(max, 0, 4).map((v) => formatChartCount(v))
  const showUnscored = data.some((d) => d.unscored != null)
  const leadingQuiet = (() => {
    const firstActive = data.findIndex((d) => d.total > 0)
    return firstActive > 0 ? firstActive : 0
  })()
  const chartDays = leadingQuiet > 2 ? data.slice(leadingQuiet - 1) : data
  const quietOmitted = leadingQuiet > 2 ? leadingQuiet - 1 : 0

  const { hoverIdx, onMouseMove, onMouseLeave } = useSeriesHover(chartDays.length, chartDays.length > 0)
  const inlineLabels = buildInlineLabelPoints(
    chartDays.map((d) => d.total),
    hoverIdx,
  )
  const inlineByIdx = new Map(inlineLabels.map((p) => [p.idx, p]))

  return (
    <div className="w-full min-w-0">
      <ChartFrame
        height={plotHeight}
        yTickLabels={yTicks}
        xLabels={chartDays.map((d) => d.day)}
        xBucketCount={chartDays.length}
      >
        <div
          className="relative h-full w-full min-w-0"
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
        >
          <div
            className="grid h-full w-full items-stretch gap-0.5"
            style={{ gridTemplateColumns: `repeat(${chartDays.length}, minmax(0, 1fr))` }}
            role="group"
            aria-label={`Daily severity breakdown · ${totalReports} reports across ${chartDays.length} days`}
          >
            {chartDays.map((d, i) => {
              const totalH = (d.total / max) * 100
              const inline = inlineByIdx.get(i)
              return (
                <SeverityBarColumn
                  key={d.day}
                  day={d}
                  plotHeight={plotHeight}
                  totalH={totalH}
                  isHovered={hoverIdx === i}
                  inlineLabel={inline}
                />
              )
            })}
          </div>
        </div>
      </ChartFrame>

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SeverityColorLegend showUnscored={showUnscored} />
          {quietOmitted > 0 && (
            <span className="text-3xs text-fg-faint">
              {quietOmitted} earlier {quietOmitted === 1 ? 'day' : 'days'} with 0 reports hidden
            </span>
          )}
        </div>
        <span className="shrink-0 text-2xs tabular-nums text-fg-faint/70">{totalReports} total · 14d</span>
      </div>
    </div>
  )
}

function SeverityBarColumn({
  day,
  plotHeight,
  totalH,
  isHovered,
  inlineLabel,
}: {
  day: SeverityDay
  plotHeight: number
  totalH: number
  isHovered: boolean
  inlineLabel?: { value: number; kind: 'peak' | 'today' | 'low' }
}) {
  const ariaSummary = `${shortDay(day.day)}: ${day.total} reports — ${day.critical} critical, ${day.high} high, ${day.medium} medium, ${day.low} low${
    day.unscored != null ? `, ${day.unscored} unscored` : ''
  }`
  const barPx = day.total > 0 ? Math.max(4, Math.round((totalH / 100) * plotHeight)) : 0
  const segPx = (n: number) =>
    day.total > 0 && n > 0 ? Math.max(2, Math.round((n / day.total) * barPx)) : 0

  return (
    <div className="relative h-full min-w-0">
      <button
        type="button"
        tabIndex={0}
        aria-label={ariaSummary}
        className={[
          // overflow-hidden is load-bearing: each non-zero severity segment
          // floors at 2px (segPx) while the bar itself floors at 4px (barPx),
          // so on a low-volume day with several severities present the stacked
          // segments can sum taller than the bar. With `justify-end` the excess
          // would otherwise spill past the TOP edge into the inline label and
          // the neighbouring column; clipping keeps the most-severe (bottom)
          // segments visible within the bar boundary.
          'absolute inset-x-0 bottom-0 flex flex-col justify-end overflow-hidden rounded-sm',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60',
          'motion-safe:transition-[filter,background-color] duration-150',
          /* Zero-day: keep full-height for hover target but NO visual fill —
             only the 6px baseline stub signals "day with 0 reports", avoiding
             the tall grey box that makes bars appear clustered to the right. */
          day.total === 0
            ? 'h-full cursor-default'
            : isHovered
              ? 'brightness-110 z-10'
              : '',
        ].join(' ')}
        style={day.total > 0 ? { height: `${barPx}px` } : undefined}
      >
        {day.total === 0 ? (
          <span
            className="mx-auto mb-0.5 block w-[60%] rounded-full bg-edge-subtle/70"
            style={{ height: '4px' }}
            aria-hidden="true"
          />
        ) : (
          <>
            <span aria-hidden="true" className={`block w-full rounded-t-sm ${SEVERITY_TRAFFIC.low.bg}`} style={{ height: `${segPx(day.low)}px` }} />
            <span aria-hidden="true" className={`block w-full ${SEVERITY_TRAFFIC.medium.bg}`} style={{ height: `${segPx(day.medium)}px` }} />
            <span aria-hidden="true" className={`block w-full ${SEVERITY_TRAFFIC.high.bg}`} style={{ height: `${segPx(day.high)}px` }} />
            <span
              aria-hidden="true"
              className={`block w-full ${day.unscored == null || day.unscored <= 0 ? 'rounded-b-sm' : ''} ${SEVERITY_TRAFFIC.critical.bg}`}
              style={{ height: `${segPx(day.critical)}px` }}
            />
            {day.unscored != null && day.unscored > 0 && (
              <span aria-hidden="true" className={`block w-full rounded-b-sm ${SEVERITY_TRAFFIC.unscored.bg}`} style={{ height: `${segPx(day.unscored)}px` }} />
            )}
          </>
        )}
      </button>

      {inlineLabel && day.total > 0 && !isHovered && (
        <span
          className={`${INLINE_LABEL_CLASS} ${INLINE_LABEL_KIND_ACCENT[inlineLabel.kind]}`}
          style={{ bottom: `${barPx + 4}px`, transform: 'translate(-50%, 0)' }}
          title={inlineLabel.kind}
          aria-hidden="true"
        >
          {formatInlineLabelValue(inlineLabel.value, 'count')}
        </span>
      )}
      <ChartHoverPopover
        dayLabel={shortDay(day.day)}
        valueLabel={day.total > 0 ? `${day.total} total` : '0'}
        visible={isHovered}
        style={{ left: '50%', bottom: `${Math.max(8, barPx + 4)}px` }}
      >
        {day.total > 0 ? (
          <ul className="mt-1 space-y-0.5 font-mono text-3xs">
            {day.critical > 0 && (
              <li className="flex justify-between gap-3"><span className={SEVERITY_TRAFFIC.critical.text}>●</span><span>{day.critical}</span></li>
            )}
            {day.high > 0 && (
              <li className="flex justify-between gap-3"><span className={SEVERITY_TRAFFIC.high.text}>●</span><span>{day.high}</span></li>
            )}
            {day.medium > 0 && (
              <li className="flex justify-between gap-3"><span className={SEVERITY_TRAFFIC.medium.text}>●</span><span>{day.medium}</span></li>
            )}
            {day.low > 0 && (
              <li className="flex justify-between gap-3"><span className={SEVERITY_TRAFFIC.low.text}>●</span><span>{day.low}</span></li>
            )}
            {day.unscored != null && day.unscored > 0 && (
              <li className="flex justify-between gap-3"><span className={SEVERITY_TRAFFIC.unscored.text}>●</span><span>{day.unscored}</span></li>
            )}
          </ul>
        ) : null}
      </ChartHoverPopover>
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
      <Badge className="bg-warn-muted/50 text-warning-foreground border border-warn/30">
        Degraded
      </Badge>
    )
  if (status === 'down')
    return (
      <Badge className="bg-danger-muted/50 text-danger-foreground border border-danger/30">
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
  new: 'bg-warn-muted/50 text-warning-foreground border-warn/30',
  pending: 'bg-warn-muted/50 text-warning-foreground border-warn/30',
  queued: 'bg-info/15 text-info border-info/30',
  running: 'bg-info/15 text-info border-info/30',
  classified: 'bg-ok/15 text-ok border-ok/30',
  completed: 'bg-ok/15 text-ok border-ok/30',
  fixing: 'bg-brand/15 text-brand border-brand/30',
  fixed: 'bg-info/15 text-info border-info/30',
  failed: 'bg-danger-muted/50 text-danger-foreground border-danger/30',
  dead_letter: 'bg-danger-muted/50 text-danger-foreground border-danger/30',
  rejected: 'bg-danger-muted/50 text-danger-foreground border-danger/30',
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
