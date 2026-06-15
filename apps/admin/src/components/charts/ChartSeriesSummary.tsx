/**
 * FILE: apps/admin/src/components/charts/ChartSeriesSummary.tsx
 * PURPOSE: Shared series summary math + plot clamp helpers for inline labels.
 */

export type ChartValueFormat = 'count' | 'usd' | 'percent' | 'raw'

export interface SeriesSummary {
  peak: number
  min: number
  current: number
  peakIdx: number
  minIdx: number
  currentIdx: number
}

export function summarizeSeriesValues(values: number[]): SeriesSummary | null {
  if (values.length === 0) return null
  let peakIdx = 0
  let minIdx = 0
  values.forEach((v, i) => {
    if (v > values[peakIdx]) peakIdx = i
    if (v < values[minIdx]) minIdx = i
  })
  return {
    peak: values[peakIdx] ?? 0,
    min: values[minIdx] ?? 0,
    current: values[values.length - 1] ?? 0,
    peakIdx,
    minIdx,
    currentIdx: values.length - 1,
  }
}

/** Clamp hover/tooltip Y so it stays inside the plot (percent 0–100). */
export function clampPlotTopPercent(yPercent: number, min = 14, max = 88): number {
  return Math.max(min, Math.min(max, yPercent))
}
