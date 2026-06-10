/**
 * FILE: apps/admin/src/components/health/HealthStatusBanner.tsx
 * PURPOSE: Health posture — LLM errors, fallbacks, cron failures, idle, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import type { HealthStats, HealthTabId } from './HealthStatsTypes'

/** Nominal/idle posture is covered by the page hero + snapshot — skip the banner. */
export function isHealthStatusBannerCritical(stats: HealthStats): boolean {
  if (!stats.hasAnyProject) return true
  return (
    stats.topPriority === 'llm_errors' ||
    stats.topPriority === 'cron_error' ||
    stats.topPriority === 'llm_fallbacks' ||
    stats.topPriority === 'cron_stale' ||
    stats.topPriority === 'cron_warn'
  )
}

interface Props {
  stats: HealthStats
  onTab?: (tab: HealthTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function HealthStatusBanner({
  stats,
  onTab,
  onRefresh,
  refreshing,
  plainBanner = false,
}: Props) {
  const copy = usePageCopy('/health')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Create a project before vitals appear' : 'No projects — health idle'}
        subtitle={
          plainBanner
            ? 'LLM latency and cron job status show up once the pipeline runs.'
            : 'Create a project before LLM and cron telemetry appear.'
        }
        action={
          <Link to="/onboarding">
            <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'llm_errors') {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${stats.errorRatePct}% of AI calls failed on ${projectLabel}`
            : `LLM error rate ${stats.errorRatePct}% on ${projectLabel}`
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.llm ?? 'Inspect LLM'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('llm')}>
              {actions.llm ?? 'Inspect LLM'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'cron_error') {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${stats.cronErrorCount} scheduled job${stats.cronErrorCount === 1 ? '' : 's'} failing`
            : `${stats.cronErrorCount} cron job${stats.cronErrorCount === 1 ? '' : 's'} failing`
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.cron ?? 'Open cron'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('cron')}>
              {actions.cron ?? 'Open cron'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'llm_fallbacks') {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? `${stats.fallbackRatePct}% of calls fell back to backup model`
            : `Fallback rate ${stats.fallbackRatePct}% — primary may be flaky`
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.llm ?? 'Review LLM'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('llm')}>
              {actions.llm ?? 'Review LLM'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'cron_stale' || stats.topPriority === 'cron_warn') {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? stats.topPriority === 'cron_stale'
              ? 'Scheduled jobs have not run on time'
              : 'Scheduled jobs running late'
            : stats.topPriority === 'cron_stale'
              ? 'Cron jobs stale'
              : 'Cron jobs running late'
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.cron ?? 'Open cron'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('cron')}>
              {actions.cron ?? 'Open cron'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'idle') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? `No AI activity on ${projectLabel} yet` : `No LLM activity on ${projectLabel}`}
        subtitle={stats.topPriorityLabel}
        action={
          <Link to="/onboarding">
            <Btn size="sm" variant="ghost">{actions.verify ?? 'Send test report'}</Btn>
          </Link>
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? `AI pipeline healthy on ${projectLabel}` : `All systems nominal on ${projectLabel}`}
      subtitle={stats.topPriorityLabel}
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            {actions.refresh ?? 'Refresh'}
          </Btn>
        ) : stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.activity ?? 'View activity'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('activity')}>
            {actions.activity ?? 'View activity'}
          </Btn>
        ) : null
      }
    />
  )
}
