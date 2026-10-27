/**
 * FILE: apps/admin/src/lib/statTooltips/health.ts
 * PURPOSE: Human-readable StatCard tooltips for the Health HEALTH SNAPSHOT strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { HealthStats } from '../../components/health/HealthStatsTypes'
import { metricTip } from '../metricTooltipBuilder'

export function totalCallsTooltip(stats: HealthStats): MetricTooltipData {
  const takeaway =
    stats.totalCalls > 0
      ? `${stats.totalCalls.toLocaleString()} LLM call${stats.totalCalls === 1 ? '' : 's'} in the last ${stats.window}. Open LLM tab for per-function breakdown and error samples.`
      : stats.hasAnyProject
        ? `No LLM invocations in the last ${stats.window} — normal on a quiet project until agents run classify, fix, or judge.`
        : 'Select a project to see LLM activity.'

  return metricTip(
    `How many edge-function LLM invocations ran in the selected time window (${stats.window}).`,
    'Counts llm_invocations rows for the active project where created_at falls within the window (1h, 24h, or 7d). Capped at 500 most recent rows for rate math.',
    takeaway,
    stats.totalCalls === 0 && stats.hasAnyProject
      ? { tone: 'info', text: 'No LLM activity yet — run classify or fix-worker once to populate health metrics.' }
      : undefined,
  )
}

export function totalCallsDetail(stats: HealthStats): string {
  return `Last ${stats.window}`
}

export function errorRateTooltip(stats: HealthStats): MetricTooltipData {
  const takeaway =
    stats.errorRatePct > 5
      ? `${stats.errorRatePct}% error rate exceeds the 5% critical threshold. Check LLM tab for failing functions and provider outages.`
      : stats.errorRatePct > 0
        ? `${stats.errorRatePct}% of calls failed in ${stats.window} — below critical but worth monitoring.`
        : `Zero errors in ${stats.window} — all logged invocations returned success.`

  return metricTip(
    'Percentage of LLM invocations that did not return success in the window.',
    'errors ÷ totalCalls × 100, where errors are llm_invocations rows with status ≠ success.',
    takeaway,
    stats.errorRatePct > 5
      ? { tone: 'warn', text: 'Error rate above 5% — investigate failing edge functions immediately.' }
      : stats.errorRatePct > 0
        ? { tone: 'info', text: 'Non-zero error rate — watch for retry loops or provider rate limits.' }
        : undefined,
  )
}

export function errorRateDetail(): string {
  return 'Above 5% is critical'
}

export function fallbackRateTooltip(stats: HealthStats): MetricTooltipData {
  const takeaway =
    stats.fallbackRatePct > 10
      ? `${stats.fallbackRatePct}% fallback rate exceeds the 10% degraded threshold — agents are hitting primary model failures and using backup models.`
      : stats.fallbackRatePct > 0
        ? `${stats.fallbackRatePct}% of calls used a fallback model in ${stats.window} — acceptable occasionally, investigate if sustained.`
        : `No fallback models used in ${stats.window} — primary model paths are healthy.`

  return metricTip(
    'Percentage of LLM calls that used a fallback model after the primary failed or was unavailable.',
    'fallback_used = true on llm_invocations rows, divided by totalCalls in the window.',
    takeaway,
    stats.fallbackRatePct > 10
      ? { tone: 'warn', text: 'Fallback rate above 10% — check model availability and BYOK key health.' }
      : stats.fallbackRatePct > 0
        ? { tone: 'info', text: 'Some calls routed to fallback models — review LLM tab if this persists.' }
        : undefined,
  )
}

export function fallbackRateDetail(): string {
  return 'Above 10% is degraded'
}

export function latencyTooltip(stats: HealthStats): MetricTooltipData {
  const takeaway =
    stats.totalCalls > 0
      ? `Average ${stats.avgLatencyMs}ms, 95th percentile ${stats.p95LatencyMs}ms in ${stats.window}${stats.latencyExact === false ? ' (from the newest calls only)' : ''}. Spikes often correlate with large prompts or slow provider tiers.`
      : 'Latency percentiles appear after the first LLM invocation is logged.'

  return metricTip(
    'Average and 95th-percentile LLM response latency in milliseconds.',
    'Computed from latency_ms on every llm_invocations row in the window: the mean and the 95th percentile.',
    takeaway,
    stats.p95LatencyMs > 30000 && stats.totalCalls > 0
      ? { tone: 'warn', text: `p95 latency ${stats.p95LatencyMs}ms is very high — check for timeout retries or oversized prompts.` }
      : undefined,
  )
}

export function latencyDetail(): string {
  return 'Average / 95th percentile'
}
