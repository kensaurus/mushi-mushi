/**
 * FILE: apps/admin/src/components/health/HealthStatusBanner.tsx
 * PURPOSE: Health posture — LLM errors, fallbacks, cron failures, idle, healthy.
 */

import { usePageCopy } from '../../lib/copy'
import { cronErrorsHint, llmErrorsHint, scopedHref } from '../../lib/humanPageHints'
import { StatusBannerShell } from '../StatusBannerShell'
import { StatusBannerAction } from '../StatusBannerAction'
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
  const pid = stats.projectId

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
          <StatusBannerAction label={actions.setup ?? 'Go to Setup'} to="/onboarding" tone="info" />
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
            : `${stats.errorRatePct}% of AI calls failed recently`
        }
        subtitle={stats.topPriorityLabel ?? llmErrorsHint(stats.errorRatePct)}
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction
              label={actions.llm ?? 'Inspect LLM errors'}
              to={stats.topPriorityTo}
              tone="danger"
            />
          ) : onTab ? (
            <StatusBannerAction
              label={actions.llm ?? 'Inspect LLM errors'}
              onClick={() => onTab('llm')}
              tone="danger"
            />
          ) : (
            <StatusBannerAction
              label={actions.llm ?? 'Inspect LLM errors'}
              to={scopedHref('/health?tab=llm', pid)}
              tone="danger"
            />
          )
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
            : `${stats.cronErrorCount} background job${stats.cronErrorCount === 1 ? '' : 's'} failing`
        }
        subtitle={stats.topPriorityLabel ?? cronErrorsHint(stats.cronErrorCount)}
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction
              label={actions.cron ?? 'Open Cron jobs'}
              to={stats.topPriorityTo}
              tone="danger"
            />
          ) : onTab ? (
            <StatusBannerAction
              label={actions.cron ?? 'Open Cron jobs'}
              onClick={() => onTab('cron')}
              tone="danger"
            />
          ) : (
            <StatusBannerAction
              label={actions.cron ?? 'Open Cron jobs'}
              to={scopedHref('/health?tab=cron', pid)}
              tone="danger"
            />
          )
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
            : `${stats.fallbackRatePct}% of AI calls used the backup model`
        }
        subtitle={
          stats.topPriorityLabel ??
          'Your primary AI provider may be rate-limiting — check API keys or switch models in Settings.'
        }
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction
              label={actions.llm ?? 'Review LLM activity'}
              to={stats.topPriorityTo}
              tone="warn"
            />
          ) : onTab ? (
            <StatusBannerAction
              label={actions.llm ?? 'Review LLM activity'}
              onClick={() => onTab('llm')}
              tone="warn"
            />
          ) : (
            <StatusBannerAction
              label={actions.llm ?? 'Review LLM activity'}
              to={scopedHref('/health?tab=llm', pid)}
              tone="warn"
            />
          )
        }
      />
    )
  }

  if (stats.topPriority === 'cron_stale' || stats.topPriority === 'cron_warn') {
    const late = stats.topPriority === 'cron_stale'
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? late
              ? 'Scheduled jobs have not run on time'
              : 'Scheduled jobs running late'
            : late
              ? `${stats.cronStaleCount} job${stats.cronStaleCount === 1 ? '' : 's'} overdue`
              : `${stats.cronWarnCount} job${stats.cronWarnCount === 1 ? '' : 's'} running late`
        }
        subtitle={
          stats.topPriorityLabel ??
          (late
            ? 'A background job missed its expected schedule — open Cron to see which one and when it last ran.'
            : 'Jobs are slower than usual but not yet blocking the pipeline.')
        }
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction
              label={actions.cron ?? 'Open Cron jobs'}
              to={stats.topPriorityTo}
              tone="warn"
            />
          ) : onTab ? (
            <StatusBannerAction
              label={actions.cron ?? 'Open Cron jobs'}
              onClick={() => onTab('cron')}
              tone="warn"
            />
          ) : (
            <StatusBannerAction
              label={actions.cron ?? 'Open Cron jobs'}
              to={scopedHref('/health?tab=cron', pid)}
              tone="warn"
            />
          )
        }
      />
    )
  }

  if (stats.topPriority === 'idle') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? `No AI activity on ${projectLabel} yet` : `No LLM activity on ${projectLabel}`}
        subtitle={
          stats.topPriorityLabel ??
          'Send a test bug report from Setup — AI routing shows up here once triage runs.'
        }
        action={
          <StatusBannerAction
            label={actions.verify ?? 'Send test report'}
            to={scopedHref('/onboarding?tab=verify', pid)}
            tone="brand"
          />
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
          <StatusBannerAction
            label={actions.refresh ?? 'Refresh'}
            onClick={onRefresh}
            loading={refreshing}
            disabled={refreshing}
            tone="ok"
            emphasis="ghost"
          />
        ) : stats.topPriorityTo ? (
          <StatusBannerAction
            label={actions.activity ?? 'View activity'}
            to={stats.topPriorityTo}
            tone="ok"
          />
        ) : onTab ? (
          <StatusBannerAction
            label={actions.activity ?? 'View activity'}
            onClick={() => onTab('activity')}
            tone="ok"
          />
        ) : null
      }
    />
  )
}
