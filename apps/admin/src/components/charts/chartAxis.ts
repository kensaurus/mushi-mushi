/**
 * FILE: apps/admin/src/components/charts/chartAxis.ts
 * PURPOSE: Shared axis tick math and label formatters for admin charts.
 */

/** Admin console copy is English — keep chart dates off system locale (e.g. 5月7日). */
export const CHART_LOCALE = 'en-US'

export function utcTodayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

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

/** X-axis tick copy — "Today" on the current UTC bucket, else short date. */
export function formatChartDayLabel(iso: string): string {
  const day = iso.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day === utcTodayIso()) return 'Today'
  return shortDay(iso)
}

export interface SparseXTick {
  text: string
  index: number
  isToday: boolean
}

/** Sparse x-axis ticks: start, optional middles, end (4 ticks when ≥10 days). */
export function sparseXLabels(labels: string[], maxTicks?: number): SparseXTick[] {
  if (labels.length === 0) return []
  const cap = maxTicks ?? (labels.length >= 10 ? 4 : labels.length >= 5 ? 3 : labels.length)
  const tickAt = (index: number): SparseXTick => {
    const iso = labels[index] ?? ''
    const text = formatChartDayLabel(iso)
    return { text, index, isToday: text === 'Today' }
  }
  if (labels.length === 1) return [tickAt(0)]
  if (labels.length <= cap) {
    return labels.map((_, index) => tickAt(index))
  }
  if (cap >= 4 && labels.length >= 10) {
    const i1 = Math.floor(labels.length / 3)
    const i2 = Math.floor((labels.length * 2) / 3)
    return [tickAt(0), tickAt(i1), tickAt(i2), tickAt(labels.length - 1)]
  }
  const mid = Math.floor(labels.length / 2)
  return [tickAt(0), tickAt(mid), tickAt(labels.length - 1)]
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
