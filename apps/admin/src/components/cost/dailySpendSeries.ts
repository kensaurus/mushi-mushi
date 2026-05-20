/**
 * FILE: apps/admin/src/components/cost/dailySpendSeries.ts
 * PURPOSE: Pad sparse llm_invocations daily rollups into a fixed window so the
 *          cost overview chart never collapses to one full-width bar.
 */

import { shortDay } from '../charts/chartAxis'

export const DAILY_SPEND_WINDOW_DAYS = 14

export interface DailySpendSeries {
  /** ISO dates (YYYY-MM-DD), oldest → newest */
  days: string[]
  /** USD spend per day, aligned with `days` */
  values: number[]
  totalUsd: number
  activeDays: number
  peakUsd: number
  peakDayLabel: string | null
  /** Rightmost bucket (today UTC) */
  todayUsd: number
  todayLabel: string
}

export function formatShortDay(yyyyMmDd: string): string | null {
  if (!yyyyMmDd) return null
  const label = shortDay(yyyyMmDd.slice(0, 10))
  return label || null
}

/**
 * Merge per-day USD totals from the summary endpoint into a fixed-length
 * series ending today (UTC). Missing days are zero-filled so flex bar charts
 * always render N narrow columns instead of one stretched slab.
 */
export function buildDailySpendSeries(
  daySpend: Record<string, number>,
  windowDays: number = DAILY_SPEND_WINDOW_DAYS,
): DailySpendSeries {
  const days: string[] = []
  const values: number[] = []
  const now = new Date()
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )

  for (let offset = windowDays - 1; offset >= 0; offset--) {
    const d = new Date(todayUtc)
    d.setUTCDate(d.getUTCDate() - offset)
    const key = d.toISOString().slice(0, 10)
    days.push(key)
    values.push(daySpend[key] ?? 0)
  }

  let totalUsd = 0
  let activeDays = 0
  let peakUsd = 0
  let peakDayLabel: string | null = null

  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    totalUsd += v
    if (v > 0) {
      activeDays += 1
      if (v > peakUsd) {
        peakUsd = v
        peakDayLabel = formatShortDay(days[i])
      }
    }
  }

  const todayKey = days[days.length - 1] ?? ''
  return {
    days,
    values,
    totalUsd,
    activeDays,
    peakUsd,
    peakDayLabel,
    todayUsd: values[values.length - 1] ?? 0,
    todayLabel: formatShortDay(todayKey) ?? todayKey,
  }
}
