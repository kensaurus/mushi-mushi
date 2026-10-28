/**
 * FILE: apps/admin/src/lib/billingUsageForecast.ts
 * PURPOSE: Pure helpers for billing quota forecast, period reset countdown,
 *   and projected monthly cost on the Billing page UsageBar.
 *
 * OVERVIEW:
 * - buildUsageForecast — pace-to-quota ETA (diagnoses or reports)
 * - projectPeriodEndCost — dollar projection at current ingest rate
 * - daysUntilPeriodReset — days until Stripe period_end
 * - fmtBillingLimit — diagnoses/reports limit string with optional %
 *
 * USAGE:
 *   Imported by BillingPage UsageBar and unit tests.
 */

export interface UsageForecast {
  etaDays: number
  etaDate: Date
  /**
   * False when, at the current pace, the quota outlasts the billing period.
   * The label then says so instead of naming a far-future date.
   */
  hitsThisPeriod: boolean
  tone: 'danger' | 'warn' | 'muted'
  label: string
  /** Projected total bill at current pace (paid tiers with overage). */
  projectedCostUsd?: number
  projectedCostLabel?: string
}

export interface PeriodCostInputs {
  baseUsd: number
  included: number
  overageRate: number | null
  spendCapUsd: number | null
}

/**
 * Estimate monthly bill for diagnoses count (mirrors docs pricing-estimator).
 * @internal Exported for tests only.
 */
export function estimateDiagnosisBill(
  inputs: PeriodCostInputs,
  diagnoses: number,
): { total: number; capped: boolean } {
  const { baseUsd, included, overageRate, spendCapUsd } = inputs
  const overCount = Math.max(0, diagnoses - included)
  if (overageRate == null || overageRate <= 0) {
    return { total: baseUsd, capped: overCount > 0 }
  }
  const overageCost = overCount * overageRate
  const maxOverage =
    spendCapUsd != null ? Math.max(0, spendCapUsd - baseUsd) : Infinity
  const clamped = Math.min(overageCost, maxOverage)
  return {
    total: baseUsd + clamped,
    capped: overCount > 0 && overageCost >= maxOverage,
  }
}

export function buildUsageForecast(
  used: number,
  limit: number | null,
  periodStart: string | null,
  periodEnd: string | null,
  costInputs?: PeriodCostInputs | null,
): UsageForecast | null {
  if (limit == null || used <= 0) return null
  if (used >= limit) return null
  if (!periodStart) return null

  const startMs = new Date(periodStart).getTime()
  if (Number.isNaN(startMs)) return null

  const endMs = periodEnd ? new Date(periodEnd).getTime() : null
  const nowMs = Date.now()

  const daysElapsed = (nowMs - startMs) / 86_400_000
  if (daysElapsed < 1) return null

  const dailyRate = used / daysElapsed
  if (dailyRate <= 0) return null

  const daysRemaining =
    endMs != null && !Number.isNaN(endMs)
      ? Math.max(0, (endMs - nowMs) / 86_400_000)
      : Math.max(0, 30 - daysElapsed)

  const projectedUsed = Math.round(used + dailyRate * daysRemaining)
  const etaDays = Math.max(0, Math.ceil((limit - used) / dailyRate))
  // The date and the day count come from the same `etaDays`, so they always
  // agree. A quota that outlasts the period is reported as such — a date
  // years out (e.g. "Nov 24 (2227d away)") read as nonsense.
  const hitsThisPeriod = etaDays <= Math.ceil(daysRemaining)
  const etaDate = new Date(nowMs + etaDays * 86_400_000)
  const tone: UsageForecast['tone'] = !hitsThisPeriod
    ? 'muted'
    : etaDays < 3
      ? 'danger'
      : etaDays < 7
        ? 'warn'
        : 'muted'
  const dateStr = etaDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
  const label = !hitsThisPeriod
    ? `You won't hit your limit this period at the current rate`
    : etaDays === 0
      ? `At current rate, you'll hit your limit today`
      : `At current rate, you'll hit your limit on ${dateStr} (${etaDays}d away)`

  let projectedCostUsd: number | undefined
  let projectedCostLabel: string | undefined
  if (costInputs && costInputs.baseUsd >= 0) {
    const { total, capped } = estimateDiagnosisBill(costInputs, projectedUsed)
    projectedCostUsd = total
    projectedCostLabel = capped
      ? `Projected ~$${total.toFixed(2)}/mo at current pace (spend cap)`
      : `Projected ~$${total.toFixed(2)}/mo at current pace`
  }

  return {
    etaDays,
    etaDate,
    hitsThisPeriod,
    tone,
    label,
    projectedCostUsd,
    projectedCostLabel,
  }
}

/**
 * Header chip on the Billing page: the active plan and its monthly quota —
 * "Studio: 5,000 diagnoses / mo", "Free: 100 diagnoses / mo", "Enterprise:
 * unlimited". Diagnoses win over reports when the plan meters both.
 */
export function formatPlanQuotaChip(
  planDisplayName: string | null | undefined,
  diagnosesLimit: number | null | undefined,
  reportsLimit: number | null | undefined,
): string {
  const plan = planDisplayName?.trim() || 'Plan'
  if (diagnosesLimit != null) {
    return `${plan}: ${diagnosesLimit.toLocaleString()} diagnoses / mo`
  }
  if (reportsLimit != null) {
    return `${plan}: ${reportsLimit.toLocaleString()} reports / mo`
  }
  return `${plan}: unlimited`
}

/**
 * End of the calendar-month quota window that starts at `periodStart` (UTC).
 * Annual plans renew yearly, but their included diagnoses reset monthly, so
 * the usage bar counts down to this instead of the subscription period end.
 */
export function monthlyQuotaWindowEnd(periodStart: string | null | undefined): string | null {
  if (!periodStart) return null
  const start = new Date(periodStart)
  if (Number.isNaN(start.getTime())) return null
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).toISOString()
}

export function daysUntilPeriodReset(periodEnd: string | null): number | null {
  if (!periodEnd) return null
  const endMs = new Date(periodEnd).getTime()
  if (Number.isNaN(endMs)) return null
  const diff = endMs - Date.now()
  if (diff <= 0) return 0
  return Math.ceil(diff / 86_400_000)
}

export function formatPeriodResetLabel(days: number | null): string | null {
  if (days == null) return null
  if (days === 0) return 'Quota resets today'
  if (days === 1) return 'Quota resets in 1 day'
  return `Quota resets in ${days} days`
}

export function fmtBillingLimit(
  reportsUsed: number,
  reportsLimit: number | null,
  diagnosesUsed?: number | null,
  diagnosesLimit?: number | null,
  usagePct?: number | null,
): string {
  if (diagnosesLimit != null) {
    const used = diagnosesUsed ?? 0
    const base = `${used.toLocaleString()} / ${diagnosesLimit.toLocaleString()} diagnoses`
    if (usagePct != null && used > 0) {
      return `${base} · ${usagePct}% used`
    }
    return base
  }
  if (reportsLimit == null) {
    return `${reportsUsed.toLocaleString()} reports (unlimited)`
  }
  const base = `${reportsUsed.toLocaleString()} / ${reportsLimit.toLocaleString()} reports`
  if (usagePct != null && reportsUsed > 0) {
    return `${base} · ${usagePct}% used`
  }
  return base
}
