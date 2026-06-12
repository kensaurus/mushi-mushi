/**
 * FILE: apps/admin/src/components/charts/ChartSeriesInteraction.tsx
 * PURPOSE: Hover index tracking + popover for time-series charts.
 */

import { useCallback, useState, type CSSProperties } from 'react'
import { brushIndexFromClient } from '../../lib/useBrushSelection'
import { formatChartDayLabel } from './chartAxis'

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
}: {
  dayLabel: string
  valueLabel: string
  visible: boolean
  style?: CSSProperties
}) {
  if (!visible) return null
  return (
    <div
      className="pointer-events-none absolute z-30 -translate-x-1/2 whitespace-nowrap rounded-md border border-edge-subtle bg-surface-overlay px-2 py-1 text-3xs text-fg shadow-card"
      style={style}
      aria-hidden="true"
    >
      <span className="font-medium">{dayLabel}</span>
      <span className="ml-2 font-mono tabular-nums text-fg-muted">{valueLabel}</span>
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
