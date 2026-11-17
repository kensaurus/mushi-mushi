/**
 * FILE: apps/admin/src/lib/ciWeek.ts
 * PURPOSE: The CI page's week at a glance (2026-11-17): jobs per hour as a day × hour heatmap
 *          and the pass rate per day against a target, from `stats.hourly` (UTC hours) put
 *          into the viewer's own days and hours.
 *
 * Hours the data does not cover (before the window, before `hourlyFrom`, after now) are null,
 * so the page hatches them instead of drawing them as quiet. Pure: the page passes `now`.
 */

import type { CiHourly } from './ciTypes'

const HOUR_MS = 3_600_000
/** Below this the day's pass rate is flagged (ciStatus's "failing" uses the same 80%). */
export const PASS_TARGET = 0.8

interface WeekDay {
  /** "Mon" */
  label: string
  /** Local midnight, ms. */
  start: number
  /** Jobs started per local hour 0–23; null where the data does not cover the hour. */
  hours: Array<number | null>
  jobs: number
  passed: number
  codeFailures: number
  infraFailures: number
  /** passed ÷ (passed + code failures); null when nothing finished testing. */
  passRate: number | null
}

export interface WeekGrid {
  days: WeekDay[]
  /** The busiest hour's jobs (the top of the colour scale). */
  max: number
}

function localMidnight(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** The last `dayCount` local days ending today, oldest first. Null without hourly data. */
export function buildWeekGrid(hourly: CiHourly[] | undefined, hourlyFrom: string | undefined, now: number, dayCount = 7): WeekGrid | null {
  if (!hourly || hourly.length === 0) return null
  const firstHour = Date.parse(hourly[0]!.at)
  const covered = Math.max(firstHour, hourlyFrom ? Date.parse(hourlyFrom) : firstHour)
  const byHour = new Map<number, CiHourly>()
  for (const h of hourly) byHour.set(Date.parse(h.at), h)

  const today = localMidnight(now)
  const days: WeekDay[] = []
  for (let i = dayCount - 1; i >= 0; i--) {
    // Step back by calendar day, not 24 h, so a DST change does not shift the rows.
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const start = d.getTime()
    const day: WeekDay = {
      label: d.toLocaleDateString(undefined, { weekday: 'short' }),
      start,
      hours: [],
      jobs: 0,
      passed: 0,
      codeFailures: 0,
      infraFailures: 0,
      passRate: null,
    }
    for (let hr = 0; hr < 24; hr++) {
      const h = new Date(start)
      h.setHours(hr, 0, 0, 0)
      const t = h.getTime()
      // A local hour is one UTC hour except in half-hour zones; take the UTC hour it starts in.
      const utcHour = Math.floor(t / HOUR_MS) * HOUR_MS
      const point = byHour.get(utcHour)
      if (!point || utcHour < covered || t > now) {
        day.hours.push(null)
        continue
      }
      day.hours.push(point.jobs)
      day.jobs += point.jobs
      day.passed += point.passed
      day.codeFailures += point.codeFailures
      day.infraFailures += point.infraFailures
    }
    const tested = day.passed + day.codeFailures
    day.passRate = tested > 0 ? day.passed / tested : null
    days.push(day)
  }
  const max = Math.max(0, ...days.flatMap((d) => d.hours.map((h) => h ?? 0)))
  return { days, max }
}

/** The heat class for a count on a 0..max scale: `ci-cell-0` for none, `ci-heat-1..6` above. */
export function heatClass(value: number | null, max: number, steps = 6, prefix = 'ci-heat'): string {
  if (value == null) return 'ci-nodata'
  if (value <= 0 || max <= 0) return 'ci-cell-0'
  return `${prefix}-${Math.min(steps, Math.max(1, Math.ceil((value / max) * steps)))}`
}

/** The diverging class for a rate against `target`: grey within 1.5 points, then 5-point steps. */
export function divergeClass(rate: number | null, target = PASS_TARGET): string {
  if (rate == null) return 'ci-nodata'
  const d = (rate - target) * 100
  if (Math.abs(d) < 1.5) return 'ci-mid'
  const step = Math.min(4, Math.floor(Math.abs(d) / 5) + 1)
  return `${d > 0 ? 'ci-divb' : 'ci-divr'}-${step}`
}

/** The failure-rate class: none for 0, then five steps up to `top` (default 40%). */
export function failClass(rate: number | null, top = 0.4): string {
  if (rate == null) return ''
  if (rate <= 0) return 'ci-cell-0'
  return `ci-fail-${Math.min(5, Math.max(1, Math.ceil((rate / top) * 5)))}`
}
