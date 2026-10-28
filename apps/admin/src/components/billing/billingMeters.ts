/**
 * FILE: apps/admin/src/components/billing/billingMeters.ts
 * PURPOSE: Team → Billing answers "what am I paying, and how close am I to my
 *          limits?" with one meter per limit (console journeys 2026-10-27),
 *          instead of four tiles of raw ratios.
 *
 *          Fixes are counted as merged fix PRs. The old tile showed
 *          "Fixes · period 4/0": fixes_succeeded is written when any Mushi fix
 *          PR merges, fixes_attempted only by the server fix agent, so local
 *          `mushi work` and editor fixes were merged but never "attempted"
 *          (report 1c802df2). No meter ever shows a numerator larger than its
 *          denominator.
 */

import type { BillingStats } from './types'

export type MeterTone = 'ok' | 'warn' | 'danger' | 'neutral'

export interface UsageMeter {
  id: 'diagnoses' | 'reports' | 'seats' | 'fixes' | 'spend'
  label: string
  value: string
  /** 0–100 when the meter has a limit; null for a plain count. */
  pct: number | null
  tone: MeterTone
  detail: string
  to?: string
}

export interface SeatUsage {
  used: number
  limit: number | null
}

const DAY_MS = 24 * 60 * 60 * 1000

function pctOf(used: number, limit: number): number {
  if (limit <= 0) return 100
  return Math.min(100, Math.round((used / limit) * 100))
}

function toneFor(pct: number, over?: boolean, approaching?: boolean): MeterTone {
  if (over || pct >= 100) return 'danger'
  if (approaching || pct >= 80) return 'warn'
  return 'ok'
}

/** @internal Exported for tests. "resets in 5 days" from the period end, or null when unknown. */
export function resetsIn(periodEnd: string | null, now: number = Date.now()): string | null {
  if (!periodEnd) return null
  const end = Date.parse(periodEnd)
  if (!Number.isFinite(end)) return null
  const days = Math.max(0, Math.ceil((end - now) / DAY_MS))
  if (days === 0) return 'resets today'
  return `resets in ${days} day${days === 1 ? '' : 's'}`
}

/** @internal Exported for tests. The fixes line: merged this period, never a ratio. */
export function fixesMeter(stats: Pick<BillingStats, 'fixesSucceeded' | 'fixesAttempted'>): UsageMeter {
  const merged = Math.max(0, stats.fixesSucceeded)
  const byServer = Math.max(0, stats.fixesAttempted)
  return {
    id: 'fixes',
    label: 'Fixes merged',
    value: merged.toLocaleString(),
    pct: null,
    tone: 'neutral',
    detail:
      byServer > 0
        ? `${byServer.toLocaleString()} started by Mushi's server agent this period`
        : 'Fix PRs from Mushi merged this period, from any agent',
    to: '/fixes',
  }
}

export function billingMeters(stats: BillingStats, seats: SeatUsage | null = null, now: number = Date.now()): UsageMeter[] {
  const meters: UsageMeter[] = []
  const reset = resetsIn(stats.periodEnd, now)

  if (stats.diagnosesLimit != null && stats.diagnosesUsed != null) {
    const pct = stats.diagnosesUsagePct ?? pctOf(stats.diagnosesUsed, stats.diagnosesLimit)
    meters.push({
      id: 'diagnoses',
      label: 'Diagnoses',
      value: `${stats.diagnosesUsed.toLocaleString()} / ${stats.diagnosesLimit.toLocaleString()}`,
      pct: Math.min(100, pct),
      tone: toneFor(pct, stats.overDiagnosisQuota, stats.approachingDiagnosisQuota),
      detail: [`${pct}% used`, reset].filter(Boolean).join(' · '),
    })
  } else if (stats.reportsLimit != null) {
    const pct = stats.usagePct ?? pctOf(stats.reportsUsed, stats.reportsLimit)
    meters.push({
      id: 'reports',
      label: 'Reports',
      value: `${stats.reportsUsed.toLocaleString()} / ${stats.reportsLimit.toLocaleString()}`,
      pct: Math.min(100, pct),
      tone: toneFor(pct, stats.overQuota, stats.approachingQuota),
      detail: [`${pct}% used`, reset].filter(Boolean).join(' · '),
    })
  } else {
    meters.push({
      id: 'reports',
      label: 'Reports',
      value: stats.reportsUsed.toLocaleString(),
      pct: null,
      tone: 'neutral',
      detail: 'No report limit on this plan',
    })
  }

  if (seats && seats.limit != null) {
    const pct = pctOf(seats.used, seats.limit)
    meters.push({
      id: 'seats',
      label: 'Seats',
      value: `${seats.used} / ${seats.limit}`,
      pct,
      tone: toneFor(pct),
      detail: seats.used >= seats.limit ? 'Full: upgrade to invite more' : `${seats.limit - seats.used} left`,
    })
  }

  meters.push(fixesMeter(stats))

  meters.push(
    stats.isComplimentary
      ? { id: 'spend', label: 'Charges', value: 'None', pct: null, tone: 'neutral', detail: 'Admin account: limits apply, nothing is billed' }
      : stats.monthlySpendCapUsd != null
        ? {
            id: 'spend',
            label: 'Spend cap',
            value: `$${stats.monthlySpendCapUsd.toLocaleString()} / month`,
            pct: null,
            tone: 'neutral',
            detail: 'Diagnoses pause before extra usage passes this',
          }
        : {
            id: 'spend',
            label: 'Spend cap',
            value: 'Not set',
            pct: null,
            tone: 'neutral',
            detail: 'Set one so extra usage can never surprise you',
          },
  )

  return meters
}
