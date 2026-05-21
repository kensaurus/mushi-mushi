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
      ? `Median ${stats.avgLatencyMs}ms, 95th percentile ${stats.p95LatencyMs}ms in ${stats.window}. Spikes often correlate with large prompts or slow provider tiers.`
      : 'Latency percentiles appear after the first LLM invocation is logged.'

  return metricTip(
    'Median (p50) and 95th-percentile LLM response latency in milliseconds.',
    'Computed from latency_ms on llm_invocations rows in the window. avgLatencyMs is the mean; p95LatencyMs is the 95th percentile of sorted latencies.',
    takeaway,
    stats.p95LatencyMs > 30000 && stats.totalCalls > 0
      ? { tone: 'warn', text: `p95 latency ${stats.p95LatencyMs}ms is very high — check for timeout retries or oversized prompts.` }
      : undefined,
  )
}

export function latencyDetail(): string {
  return 'Median / 95th percentile'
}

export function cronTooltip(stats: HealthStats): MetricTooltipData {
  const takeaway =
    stats.cronErrorCount > 0
      ? `${stats.cronErrorCount} of ${stats.cronJobCount} known cron jobs last failed. Open Cron tab for job history and stack traces.`
      : stats.cronStaleCount > 0
        ? `${stats.cronStaleCount} job${stats.cronStaleCount === 1 ? '' : 's'} missed expected cadence — scheduler may be delayed.`
        : stats.cronWarnCount > 0
          ? `${stats.cronWarnCount} job${stats.cronWarnCount === 1 ? '' : 's'} in warn state — review before they go stale.`
          : `${stats.cronHealthyCount}/${stats.cronJobCount} cron jobs healthy (judge-batch, intelligence-report, data-retention).`

  let callout: MetricTooltipData['callout']
  if (stats.cronErrorCount > 0) {
    callout = {
      tone: 'warn',
      text: `${stats.cronErrorCount} cron job${stats.cronErrorCount === 1 ? '' : 's'} failing — background automation may be stuck.`,
    }
  } else if (stats.cronStaleCount > 0) {
    callout = {
      tone: 'warn',
      text: `${stats.cronStaleCount} stale cron job${stats.cronStaleCount === 1 ? '' : 's'} — missed expected run window.`,
    }
  }

  return metricTip(
    'How many monitored background cron jobs are healthy vs failing or stale.',
    'Tracks judge-batch, intelligence-report, and data-retention via cron_runs. Healthy = last run succeeded within expected cadence; error = last status error; stale = no recent run.',
    takeaway,
    callout,
  )
}

export function cronDetail(stats: HealthStats): string {
  return `${stats.cronErrorCount} failing · ${stats.cronStaleCount} stale`
}

export function lastCallTooltip(stats: HealthStats): MetricTooltipData {
  const takeaway = stats.lastLlmCallAt
    ? 'An LLM invocation ran recently — agents are active. Exact timestamp is in the LLM activity tab.'
    : stats.hasAnyProject
      ? 'No LLM calls logged yet for this project — run classify, fix-worker, or another agent once.'
      : 'Select a project to track LLM activity.'

  return metricTip(
    'Whether any LLM invocation has been logged for the active project (shows Recent when the latest call exists).',
    'Reads the most recent created_at from llm_invocations for the active project, regardless of the stats window.',
    takeaway,
    !stats.lastLlmCallAt && stats.hasAnyProject
      ? { tone: 'info', text: 'No LLM activity yet — dispatch a classify or fix to confirm the pipeline.' }
      : undefined,
  )
}

export function lastCallDetail(stats: HealthStats): string | undefined {
  return stats.lastLlmCallAt ? undefined : 'No activity yet'
}
