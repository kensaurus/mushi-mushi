/**
 * FILE: apps/admin/src/components/charts/chartAxis.ts
 * PURPOSE: Shared axis tick math and label formatters for admin charts.
 */

/** Admin console copy is English — keep chart dates off system locale (e.g. 5月7日). */
export const CHART_LOCALE = 'en-US'

export function shortDay(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso.includes('T') ? iso : `${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(CHART_LOCALE, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** Sparse x-axis captions: start, optional midpoint, end. */
export function sparseXLabels(
  labels: string[],
  maxTicks = 3,
): Array<{ text: string; index: number }> {
  if (labels.length === 0) return []
  if (labels.length === 1) return [{ text: labels[0], index: 0 }]
  if (labels.length <= maxTicks) {
    return labels.map((text, index) => ({ text, index }))
  }
  const mid = Math.floor(labels.length / 2)
  return [
    { text: labels[0], index: 0 },
    { text: labels[mid], index: mid },
    { text: labels[labels.length - 1], index: labels.length - 1 },
  ]
}

export function formatChartCount(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(1)
}

export function formatChartUsd(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(3)}`
  if (n >= 0.0001) return `$${n.toFixed(4)}`
  if (n === 0) return '$0'
  return `$${n.toFixed(6)}`
}

/** Y-axis tick values from top (max) to bottom (min). */
export function buildYTickValues(
  max: number,
  min = 0,
  tickCount = 4,
  headroomRatio = 0.12,
): number[] {
  const rawPeak = Math.max(max, min)
  const floor = Math.min(min, max)
  const peak = rawPeak > 0 ? rawPeak * (1 + headroomRatio) : rawPeak
  if (tickCount <= 1) return [peak]
  if (peak === floor) return [peak, floor]
  const steps = tickCount - 1
  const out: number[] = []
  for (let i = 0; i <= steps; i++) {
    out.push(peak - ((peak - floor) * i) / steps)
  }
  return out
}

export function resolveChartMax(
  values: number[],
  scaleToData: boolean,
  headroomRatio = 0.12,
): number {
  const peak = values.length ? Math.max(...values) : 0
  if (!scaleToData) return Math.max(1, peak)
  if (peak <= 0) return 0.001
  return peak * (1 + headroomRatio)
}
