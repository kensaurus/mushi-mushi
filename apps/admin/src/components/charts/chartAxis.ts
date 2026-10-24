/**
 * FILE: apps/admin/src/components/charts/chartAxis.ts
 * PURPOSE: Shared axis tick math and label formatters for admin charts.
 *
 * OVERVIEW:
 * - Day/X sparse labels and Y-axis tick builders for dashboard sparklines
 * - Count / USD formatters used by ChartFrame tick labels
 * - buildYTickValues uses a nice-step scale so discrete count axes stay
 *   on integers (peak 33 → 40/30/20/10/0) instead of 12.3/24.6/37.0
 *
 * USAGE:
 * - LineSparkline / BarSparkline / Histogram pass integer:true for count
 * - Callers use resolvePlotChartMax(values, yTickValues[0], scaleToData) so
 *   the plot domain top matches the top Y tick on every scaleToData path
 */

/** Admin console copy is English — keep chart dates off system locale (e.g. 5月7日). */
const CHART_LOCALE = 'en-US'

function utcTodayIso(): string {
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
  // Narrow tiles: first and last only. Four ticks in a ~120 px tile ran
  // together ("Sep 2SSep 25Today", 2026-10-04 audit).
  if (cap <= 2) return [tickAt(0), tickAt(labels.length - 1)]
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
  // Float error on the bottom tick printed "-0.0" on the calls axis.
  if (Math.abs(n) < 0.05) return '0'
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

export type BuildYTickOptions = {
  /** Force step ≥ 1 and integer multiples (no 2.5). Use for count charts. */
  integer?: boolean
}

/** Nice step near `rawStep` from {1,2,2.5,5,10}×10^n (drop 2.5 when integer). */
function niceStep(rawStep: number, integer: boolean): number {
  if (!(rawStep > 0) || !Number.isFinite(rawStep)) return 1
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const fracs = integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]
  const candidates = fracs.map((f) => f * magnitude)
  // Prefer the nearest nice value; ties go upward so the domain still covers.
  let best = candidates[0]!
  let bestDist = Math.abs(best - rawStep)
  for (const c of candidates) {
    const dist = Math.abs(c - rawStep)
    if (dist < bestDist || (dist === bestDist && c > best)) {
      best = c
      bestDist = dist
    }
  }
  if (integer) return Math.max(1, best)
  return best
}

/** Y-axis tick values from top (max) to bottom (min). */
export function buildYTickValues(
  max: number,
  min = 0,
  tickCount = 4,
  headroomRatio = 0.12,
  opts?: BuildYTickOptions,
): number[] {
  const integer = opts?.integer === true
  const rawPeak = Math.max(max, min)
  const floor = Math.min(min, max)
  const peakTarget = rawPeak > 0 ? rawPeak * (1 + headroomRatio) : rawPeak
  if (tickCount <= 1) return [integer ? Math.ceil(peakTarget) : peakTarget]
  if (peakTarget === floor) return [peakTarget, floor]

  const steps = tickCount - 1
  // Headroom guides step size; top snaps to a nice multiple of the data max
  // so e.g. max 57 → step 20 → [60,40,20,0] (not 63.8 linear fractions).
  const rawStep = (peakTarget - floor) / steps
  const step = niceStep(rawStep, integer)
  let top = Math.ceil(rawPeak / step) * step
  if (integer) top = Math.round(top)
  if (top <= floor) {
    return integer ? [Math.max(1, Math.ceil(rawPeak) || 1), floor] : [peakTarget, floor]
  }

  const out: number[] = []
  // Walk down by nice step; last tick is the floor exactly (avoids "-0.0").
  for (let v = top; v > floor + step * 0.5; v -= step) {
    const tick = integer ? Math.round(v) : v
    if (out.length === 0 || out[out.length - 1] !== tick) out.push(tick)
  }
  out.push(floor)
  return out
}

/** @internal Exported for tests only; charts use resolvePlotChartMax. */
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

/**
 * Plot domain top for BarSparkline / LineSparkline.
 * Prefer the nice-step tick top so bar/line heights match Y labels whether
 * or not scaleToData is set; fall back to resolveChartMax for empty/zero series.
 */
export function resolvePlotChartMax(
  values: number[],
  yTickTop: number | undefined,
  scaleToData: boolean,
): number {
  const peak = values.length ? Math.max(...values, 0) : 0
  if (peak <= 0) return resolveChartMax(values, scaleToData)
  if (yTickTop != null && yTickTop > 0) return yTickTop
  return resolveChartMax(values, scaleToData)
}
