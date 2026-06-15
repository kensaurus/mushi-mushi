/**
 * FILE: apps/admin/src/components/charts/ChartInlineDataLabels.tsx
 * PURPOSE: Peak / today / low values anchored to data points on the plot —
 *          replaces verbose chip rows above charts (NN/g #8 Minimalist).
 */

import { formatChartCount, formatChartDayLabel, formatChartUsd } from './chartAxis'
import { clampPlotTopPercent, summarizeSeriesValues, type ChartValueFormat } from './ChartSeriesSummary'

export function formatInlineLabelValue(n: number, format: ChartValueFormat = 'count'): string {
  if (format === 'usd') return formatChartUsd(n)
  if (format === 'percent') return `${(n * 100).toFixed(0)}%`
  if (format === 'count') return formatChartCount(n)
  return Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : '—'
}

const KIND_ACCENT: Record<'peak' | 'today' | 'low', string> = {
  peak: 'text-brand border-brand/30',
  today: 'text-info border-info/30',
  low: 'text-fg-muted',
}

const LABEL_CLASS =
  'pointer-events-none absolute z-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-sm border border-edge-subtle/70 bg-surface/95 px-1 py-px text-2xs font-mono font-semibold tabular-nums leading-none shadow-sm'

export const INLINE_LABEL_CLASS = LABEL_CLASS
export const INLINE_LABEL_KIND_ACCENT = KIND_ACCENT

interface LineLabelProps {
  mode: 'line'
  values: number[]
  timestamps?: string[]
  valueFormat?: ChartValueFormat
  xAt: (i: number) => number
  yAt: (v: number) => number
  activeIdx: number | null
}

export type ChartInlineDataLabelsProps = LineLabelProps

export function buildInlineLabelPoints(
  values: number[],
  activeIdx: number | null,
): Array<{ idx: number; value: number; kind: 'peak' | 'today' | 'low' }> {
  const summary = summarizeSeriesValues(values)
  if (!summary) return []

  const candidates: Array<{ idx: number; value: number; kind: 'peak' | 'today' | 'low'; priority: number }> = []

  const push = (idx: number, value: number, kind: 'peak' | 'today' | 'low', priority: number) => {
    if (activeIdx === idx) return
    if (candidates.some((c) => c.idx === idx)) return
    candidates.push({ idx, value, kind, priority })
  }

  push(summary.peakIdx, summary.peak, 'peak', 0)
  if (summary.currentIdx !== summary.peakIdx) {
    push(summary.currentIdx, summary.current, 'today', 1)
  }
  if (summary.minIdx !== summary.peakIdx && summary.minIdx !== summary.currentIdx) {
    push(summary.minIdx, summary.min, 'low', 2)
  } else if (summary.min !== summary.peak && summary.minIdx !== summary.peakIdx) {
    push(summary.minIdx, summary.min, 'low', 2)
  }

  candidates.sort((a, b) => a.priority - b.priority)

  const kept: typeof candidates = []
  for (const c of candidates) {
    const x = values.length <= 1 ? 0 : (c.idx / (values.length - 1)) * 100
    const overlaps = kept.some((k) => {
      const kx = values.length <= 1 ? 0 : (k.idx / (values.length - 1)) * 100
      return Math.abs(x - kx) < 14
    })
    if (!overlaps) kept.push(c)
  }

  return kept.map(({ idx, value, kind }) => ({ idx, value, kind }))
}

export function ChartInlineDataLabels(props: ChartInlineDataLabelsProps) {
  const { values, timestamps, valueFormat = 'count', activeIdx } = props
  const points = buildInlineLabelPoints(values, activeIdx)
  if (points.length === 0) return null

  return (
    <>
      {points.map(({ idx, value, kind }) => {
        const day = timestamps?.[idx]?.slice(0, 10)
        const title = day
          ? `${kind === 'peak' ? 'Peak' : kind === 'today' ? 'Today' : 'Low'} · ${formatChartDayLabel(day)}`
          : kind

        if (props.mode === 'line') {
          const left = props.xAt(idx)
          const top = clampPlotTopPercent(props.yAt(value) - 10)
          return (
            <span
              key={`${kind}-${idx}`}
              className={`${LABEL_CLASS} ${KIND_ACCENT[kind]}`}
              style={{ left: `${left}%`, top: `${top}%`, transform: 'translate(-50%, -100%)' }}
              title={title}
              aria-hidden="true"
            >
              {formatInlineLabelValue(value, valueFormat)}
            </span>
          )
        }

        return null
      })}
    </>
  )
}
