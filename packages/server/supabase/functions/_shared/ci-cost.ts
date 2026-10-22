/**
 * FILE: packages/server/supabase/functions/_shared/ci-cost.ts
 * PURPOSE: What CI costs (Plan 022 Phase 7, ADR 0037). Pure money and time
 *          arithmetic for GET /v1/admin/ci/compare:
 *
 *   GitHub-hosted, private repo  billed minutes × the dated rate table
 *                                (ci-minutes.ts), after the plan's included
 *                                minutes, which belong to the repo OWNER's
 *                                account and are shared by its repos
 *   GitHub-hosted, public repo   $0 on standard runners
 *   larger GitHub runners        always billed, never from included minutes;
 *                                Mushi has no SKU price, so "unpriced"
 *   self-hosted                  marginal electricity: busy hours per physical
 *                                machine × (load W − idle W) ÷ 1000 × price
 *                                per kWh, + your wear figure per busy hour, +
 *                                GitHub's self-hosted platform fee (default 0,
 *                                postponed since 2025-12-15)
 *
 * Busy hours are the UNION of a machine's job intervals, so parallel jobs
 * are not counted twice. The machine draws idle power whether or not CI runs,
 * so only the extra draw under load is CI's cost; Mushi assumes full load
 * while any job runs (an upper bound).
 *
 * Included minutes: GitHub's docs (fetched 2026-10-22) do not say how Windows
 * and macOS minutes draw down the allowance; Mushi assumes at their price
 * ratio to Linux (1.67× and 10.3×), i.e. the allowance is worth
 * included × the Linux rate. Every figure here is ESTIMATED.
 *
 * Pure: no I/O.
 */

import { GITHUB_INCLUDED_MINUTES, GITHUB_RUNNER_RATES } from './ci-minutes.ts'
import type { CiCompareSettings } from './ci-compare-types.ts'

export const COST_PLANS = ['free', 'pro', 'team', 'enterprise', 'custom'] as const
export type CostPlan = (typeof COST_PLANS)[number]

/** Bounds for every user figure (the PUT route's zod schema and the console form use these). */
export const COST_BOUNDS = {
  watts: { min: 0, max: 5000 },
  pricePerKwh: { min: 0, max: 10 },
  wearPerHour: { min: 0, max: 100 },
  fxPerUsd: { min: 0.0001, max: 100000 },
  includedMinutes: { min: 0, max: 1_000_000 },
  selfHostedFeePerMinuteUsd: { min: 0, max: 1 },
  machines: 20,
  machineRunners: 20,
} as const

/** Example figures shown until you save your own: a desktop PC drawing 150 W more under load, $0.20/kWh. */
export const DEFAULT_COST_SETTINGS: Omit<CiCompareSettings, 'organizationId' | 'source' | 'updatedAt'> = {
  currency: 'USD',
  fxPerUsd: 1,
  wattsIdle: 30,
  wattsLoad: 180,
  pricePerKwh: 0.2,
  wearPerHour: 0,
  plan: 'free',
  includedMinutes: GITHUB_INCLUDED_MINUTES.free,
  selfHostedFeePerMinuteUsd: 0,
  machines: [],
}

/** GitHub's announced (postponed) self-hosted platform fee, for the "if it starts" line. */
export const ANNOUNCED_SELF_HOSTED_FEE_USD = 0.002

/** The ci_cost_settings row (snake case), as stored. */
export interface CostSettingsRow {
  organization_id: string
  currency?: string | null
  fx_per_usd?: number | string | null
  watts_idle?: number | string | null
  watts_load?: number | string | null
  price_per_kwh?: number | string | null
  wear_per_hour?: number | string | null
  plan?: string | null
  included_minutes?: number | string | null
  self_hosted_fee_per_minute_usd?: number | string | null
  machines?: unknown
  updated_at?: string | null
}

function numOr(v: unknown, fallback: number, bounds?: { min: number; max: number }): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return fallback
  if (bounds && (n < bounds.min || n > bounds.max)) return fallback
  return n
}

/** A saved machine list, cleaned: names and runner prefixes trimmed, duplicates and empties dropped. */
export function cleanMachines(value: unknown): CiCompareSettings['machines'] {
  if (!Array.isArray(value)) return []
  const out: CiCompareSettings['machines'] = []
  const seen = new Set<string>()
  for (const m of value.slice(0, COST_BOUNDS.machines)) {
    if (!m || typeof m !== 'object') continue
    const x = m as Record<string, unknown>
    const name = typeof x.name === 'string' ? x.name.trim().slice(0, 60) : ''
    if (!name || seen.has(name.toLowerCase())) continue
    const runners = Array.isArray(x.runners)
      ? [...new Set(x.runners.filter((r): r is string => typeof r === 'string').map((r) => r.trim()).filter(Boolean).map((r) => r.slice(0, 100)))].slice(0, COST_BOUNDS.machineRunners)
      : []
    if (runners.length === 0) continue
    seen.add(name.toLowerCase())
    const wattsIdle = x.wattsIdle == null ? null : numOr(x.wattsIdle, NaN, COST_BOUNDS.watts)
    const wattsLoad = x.wattsLoad == null ? null : numOr(x.wattsLoad, NaN, COST_BOUNDS.watts)
    out.push({
      name,
      runners,
      wattsIdle: Number.isFinite(wattsIdle as number) ? wattsIdle : null,
      wattsLoad: Number.isFinite(wattsLoad as number) ? wattsLoad : null,
    })
  }
  return out
}

/** Settings for one organization: the saved row, or the example figures marked 'default'. */
export function normalizeCostSettings(organizationId: string, row: CostSettingsRow | null): CiCompareSettings {
  const d = DEFAULT_COST_SETTINGS
  if (!row) return { organizationId, source: 'default', ...d, machines: [], updatedAt: null }
  const plan = (COST_PLANS as readonly string[]).includes(row.plan ?? '') ? (row.plan as CostPlan) : d.plan
  const planMinutes = plan === 'custom' ? d.includedMinutes : GITHUB_INCLUDED_MINUTES[plan]
  const currency = typeof row.currency === 'string' && /^[A-Z]{3}$/.test(row.currency) ? row.currency : d.currency
  const wattsIdle = numOr(row.watts_idle, d.wattsIdle, COST_BOUNDS.watts)
  const wattsLoad = Math.max(wattsIdle, numOr(row.watts_load, d.wattsLoad, COST_BOUNDS.watts))
  return {
    organizationId,
    source: 'yours',
    currency,
    fxPerUsd: currency === 'USD' ? 1 : numOr(row.fx_per_usd, 1, COST_BOUNDS.fxPerUsd),
    wattsIdle,
    wattsLoad,
    pricePerKwh: numOr(row.price_per_kwh, d.pricePerKwh, COST_BOUNDS.pricePerKwh),
    wearPerHour: numOr(row.wear_per_hour, d.wearPerHour, COST_BOUNDS.wearPerHour),
    plan,
    includedMinutes: Math.round(numOr(row.included_minutes, planMinutes, COST_BOUNDS.includedMinutes)),
    selfHostedFeePerMinuteUsd: numOr(row.self_hosted_fee_per_minute_usd, d.selfHostedFeePerMinuteUsd, COST_BOUNDS.selfHostedFeePerMinuteUsd),
    machines: cleanMachines(row.machines),
    updatedAt: row.updated_at ?? null,
  }
}

/** The row to store for validated settings (the route has already bounded every field). */
export function costSettingsRow(organizationId: string, s: Omit<CiCompareSettings, 'organizationId' | 'source' | 'updatedAt'>, userId: string, now: Date) {
  return {
    organization_id: organizationId,
    currency: s.currency,
    fx_per_usd: s.currency === 'USD' ? 1 : s.fxPerUsd,
    watts_idle: s.wattsIdle,
    watts_load: s.wattsLoad,
    price_per_kwh: s.pricePerKwh,
    wear_per_hour: s.wearPerHour,
    plan: s.plan,
    included_minutes: s.includedMinutes,
    self_hosted_fee_per_minute_usd: s.selfHostedFeePerMinuteUsd,
    machines: cleanMachines(s.machines),
    updated_by: userId,
    updated_at: now.toISOString(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Time
// ─────────────────────────────────────────────────────────────────────────────

/** Overlapping or touching [start, end] intervals (ms) merged, sorted. Empty and inverted intervals are dropped. */
export function mergeIntervals(intervals: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const valid = intervals.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a).map(([a, b]) => [a, b] as [number, number]).sort((x, y) => x[0] - y[0])
  const out: Array<[number, number]> = []
  for (const [a, b] of valid) {
    const last = out[out.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

/** Seconds covered by at least one interval: two parallel 10-minute jobs are 10 busy minutes, not 20. */
export function unionSeconds(intervals: ReadonlyArray<readonly [number, number]>): number {
  return Math.round(mergeIntervals(intervals).reduce((s, [a, b]) => s + (b - a), 0) / 1000)
}

/** Scale a window figure to 30 days. `spanDays` is floored at 1 so a few hours of data cannot explode. */
export function toMonth(value: number, spanDays: number): number {
  return (value * 30) / Math.max(1, spanDays)
}

// ─────────────────────────────────────────────────────────────────────────────
// Money
// ─────────────────────────────────────────────────────────────────────────────

/** Round money for display: 2 decimals (1 decimal place is too coarse for $0.45 of electricity). */
export function money(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * One GitHub account's month after included minutes. `listUsd` is the list
 * price of its private repos' standard GitHub-hosted minutes for 30 days.
 * The allowance is worth includedMinutes × the Linux rate.
 */
export function accountMonthCost(listUsd: number, includedMinutes: number): { costUsd: number; includedUsedMinutes: number; includedLeftMinutes: number } {
  const linux = GITHUB_RUNNER_RATES.usdPerMinute.linux
  const linuxEq = Math.max(0, listUsd) / linux
  const used = Math.min(Math.max(0, includedMinutes), linuxEq)
  return {
    // Micro-dollars: 100 macOS minutes minus their allowance must be 0, not 8.9e-16.
    costUsd: Math.max(0, Math.round((listUsd - used * linux) * 1e6) / 1e6),
    includedUsedMinutes: Math.round(used),
    includedLeftMinutes: Math.max(0, Math.round(includedMinutes - used)),
  }
}

/** Split `total` over `weights` in proportion; all-zero weights get nothing. */
export function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0)
  if (sum <= 0) return weights.map(() => 0)
  return weights.map((w) => (total * Math.max(0, w)) / sum)
}

/** A self-hosted machine's cost for `busyHours`, in the settings' currency. */
export function machineCost(input: {
  busyHours: number
  billedMinutes: number
  wattsIdle: number
  wattsLoad: number
  pricePerKwh: number
  wearPerHour: number
  feePerMinuteUsd: number
  fxPerUsd: number
}): { energy: number; wear: number; platformFee: number } {
  const marginalKw = Math.max(0, input.wattsLoad - input.wattsIdle) / 1000
  return {
    energy: Math.max(0, input.busyHours) * marginalKw * Math.max(0, input.pricePerKwh),
    wear: Math.max(0, input.busyHours) * Math.max(0, input.wearPerHour),
    platformFee: Math.max(0, input.billedMinutes) * Math.max(0, input.feePerMinuteUsd) * input.fxPerUsd,
  }
}

/** Machine name for a self-hosted runner base name from your settings: the first machine whose runner prefix matches. */
export function machineFromSettings(runner: string, machines: CiCompareSettings['machines']): CiCompareSettings['machines'][number] | null {
  const r = runner.toLowerCase()
  for (const m of machines) {
    if (m.runners.some((p) => r === p.toLowerCase() || r.startsWith(p.toLowerCase()))) return m
  }
  return null
}
