/**
 * FILE: apps/admin/src/components/charts/ChartSeriesInteraction.tsx
 * PURPOSE: Hover index tracking + popover for time-series charts.
 */

import { useCallback, useState, type CSSProperties, type ReactNode } from 'react'
import { brushIndexFromClient } from '../../lib/useBrushSelection'
import { formatChartDayLabel } from './chartAxis'
import { clampPlotTopPercent } from './ChartSeriesSummary'

export function useSeriesHover(dataLength: number, enabled: boolean) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (!enabled || dataLength < 1) return
      const rect = e.currentTarget.getBoundingClientRect()
      setHoverIdx(brushIndexFromClient(e.clientX, rect, dataLength))
    },
    [enabled, dataLength],
  )

  const onMouseLeave = useCallback(() => setHoverIdx(null), [])

  return { hoverIdx, onMouseMove, onMouseLeave, clearHover: () => setHoverIdx(null) }
}

export function ChartHoverPopover({
  dayLabel,
  valueLabel,
  visible,
  style,
  children,
}: {
  dayLabel: string
  valueLabel: string
  visible: boolean
  style?: CSSProperties
  children?: ReactNode
}) {
  if (!visible) return null
  const top = style?.top
  const topNum =
    typeof top === 'string' && top.endsWith('%')
      ? clampPlotTopPercent(parseFloat(top))
      : undefined
  const clampedStyle =
    topNum != null && !Number.isNaN(topNum) ? { ...style, top: `${topNum}%` } : style
  return (
    <div
      className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-edge-subtle bg-surface-overlay px-2 py-1 text-2xs text-fg shadow-card"
      style={clampedStyle}
      aria-hidden="true"
    >
      <div>
        <span className="font-medium">{dayLabel}</span>
        <span className="ml-2 font-mono tabular-nums text-fg-muted">{valueLabel}</span>
      </div>
      {children}
    </div>
  )
}

export function seriesXPercent(index: number, length: number, pad = 0): number {
  if (length <= 1) return 50
  return pad + (index / (length - 1)) * (100 - pad * 2)
}

export function seriesYPercent(
  value: number,
  min: number,
  max: number,
  pad = 2,
): number {
  const range = max - min || 1
  const ratio = (value - min) / range
  return pad + (1 - ratio) * (100 - pad * 2)
}

export function dayLabelAt(
  index: number,
  timestamps?: string[],
  xLabels?: string[],
): string {
  const iso = timestamps?.[index]?.slice(0, 10) ?? xLabels?.[index] ?? ''
  return iso ? formatChartDayLabel(iso) : `Day ${index + 1}`
}
