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
import { divergeClass as divergeScale } from '../components/signal/scale'

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

/** The colour scales moved to the shared signal kit (2026-11-18); re-exported for the CI page. */
export { heatClass, failClass } from '../components/signal/scale'

/** The diverging class for a pass rate against the CI target. */
export function divergeClass(rate: number | null, target = PASS_TARGET): string {
  return divergeScale(rate, target)
}
