/**
 * FILE: HealthSnapshotStrip.tsx
 * PURPOSE: Dedicated health KPI strip using MetricStrip — replaces hand-rolled grid.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { HealthStats } from './HealthStatsTypes'
import {
  cronDetail,
  cronTooltip,
  errorRateDetail,
  errorRateTooltip,
  fallbackRateDetail,
  fallbackRateTooltip,
  lastCallDetail,
  lastCallTooltip,
  latencyDetail,
  latencyTooltip,
  totalCallsDetail,
  totalCallsTooltip,
} from '../../lib/statTooltips/health'
import { healthLinks } from '../../lib/statCardLinks'

interface Props {
  stats: HealthStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function HealthSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'HEALTH SNAPSHOT',
  hint,
  statLabels,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={6} ariaLabel="Health snapshot">
        <StatCard
          label={statLabels?.calls ?? 'LLM calls'}
          value={stats.totalCalls}
          accent={stats.totalCalls > 0 ? 'text-brand' : undefined}
          tooltip={totalCallsTooltip(stats)}
          detail={totalCallsDetail(stats)}
          to={healthLinks.totalCalls}
        />
        <StatCard
          label={statLabels?.errors ?? 'Error rate'}
          value={`${stats.errorRatePct}%`}
          accent={stats.errorRatePct > 5 ? 'text-danger' : stats.errorRatePct > 0 ? 'text-warn' : 'text-ok'}
          tooltip={errorRateTooltip(stats)}
          detail={errorRateDetail()}
          to={healthLinks.errorRate}
        />
        <StatCard
          label={statLabels?.fallbacks ?? 'Fallback rate'}
          value={`${stats.fallbackRatePct}%`}
          accent={stats.fallbackRatePct > 10 ? 'text-danger' : stats.fallbackRatePct > 0 ? 'text-warn' : 'text-ok'}
          tooltip={fallbackRateTooltip(stats)}
          detail={fallbackRateDetail()}
          to={healthLinks.fallbackRate}
        />
        <StatCard
          label={statLabels?.latency ?? 'Latency p50 / p95'}
          value={`${stats.avgLatencyMs} / ${stats.p95LatencyMs}ms`}
          tooltip={latencyTooltip(stats)}
          detail={latencyDetail()}
          to={healthLinks.latency}
        />
        <StatCard
          label={statLabels?.cron ?? 'Cron OK'}
          value={`${stats.cronHealthyCount}/${stats.cronJobCount}`}
          accent={stats.cronErrorCount > 0 ? 'text-danger' : stats.cronStaleCount > 0 ? 'text-warn' : 'text-ok'}
          tooltip={cronTooltip(stats)}
          detail={cronDetail(stats)}
          to={healthLinks.cron}
        />
        <StatCard
          label={statLabels?.lastCall ?? 'Last LLM call'}
          value={stats.lastLlmCallAt ? 'Recent' : '—'}
          accent={stats.lastLlmCallAt ? 'text-ok' : stats.hasAnyProject ? 'text-brand' : undefined}
          tooltip={lastCallTooltip(stats)}
          detail={lastCallDetail(stats)}
          to={healthLinks.lastCall}
        />
      </MetricStrip>
    </Section>
  )
}
