/**
 * Code health posture banner — CI ingest, errors, warnings, healthy.
 */

import { usePageCopy } from '../../lib/copy'
import {
  codeHealthErrorsHint,
  codeHealthNoDataHint,
  codeHealthWarningsHint,
  scopedHref,
} from '../../lib/humanPageHints'
import { StatusBannerShell } from '../StatusBannerShell'
import { StatusBannerAction } from '../StatusBannerAction'
import type { CodeHealthStats } from './CodeHealthStatsTypes'

/** Healthy posture is covered by the page hero + readout — skip the banner. */
export function isCodeHealthStatusBannerCritical(stats: CodeHealthStats): boolean {
  if (!stats.hasAnyProject) return true
  return stats.topPriority !== 'healthy'
}

interface Props {
  stats: CodeHealthStats
  onRefresh?: () => void
  refreshing?: boolean
}

export function CodeHealthStatusBanner({ stats, onRefresh, refreshing }: Props) {
  const copy = usePageCopy('/code-health')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'active project'
  const pid = stats.projectId
  const label = stats.topPriorityLabel
  const to = stats.topPriorityTo

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title="Pick a project first"
        subtitle="Code health metrics are per app — choose one in the header switcher."
        action={
          <StatusBannerAction label="Go to Projects" to="/projects" tone="info" />
        }
      />
    )
  }

  if (stats.topPriority === 'no_data') {
    return (
      <StatusBannerShell
        tone="brand"
        title="Waiting for CI data"
        subtitle={label ?? codeHealthNoDataHint(projectLabel)}
        action={
          to ? (
            <StatusBannerAction
              label={actions.setupIngest ?? 'Set up CI ingest'}
              to={to}
              tone="brand"
              emphasis="primary"
            />
          ) : (
            <StatusBannerAction
              label={actions.setupIngest ?? 'Set up CI ingest'}
              to={scopedHref('/connect', pid)}
              tone="brand"
              emphasis="primary"
            />
          )
        }
      />
    )
  }

  if (stats.topPriority === 'errors') {
    const n = stats.errorCount
    return (
      <StatusBannerShell
        tone="danger"
        title={`${n} oversized file${n === 1 ? '' : 's'} on ${projectLabel}`}
        subtitle={label ?? codeHealthErrorsHint(n)}
        action={
          <StatusBannerAction
            label={actions.reviewFiles ?? 'Review oversized files'}
            to={to ?? scopedHref('/code-health#god-files', pid)}
            tone="danger"
          />
        }
      />
    )
  }

  if (stats.topPriority === 'warnings') {
    const n = stats.warnCount
    return (
      <StatusBannerShell
        tone="warn"
        title={`${n} file${n === 1 ? '' : 's'} approaching size budget`}
        subtitle={label ?? codeHealthWarningsHint(n)}
        action={
          <StatusBannerAction
            label={actions.reviewFiles ?? 'Review oversized files'}
            to={to ?? scopedHref('/code-health#god-files', pid)}
            tone="warn"
          />
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={`Code health looks good on ${projectLabel}`}
      subtitle={label}
      action={
        onRefresh ? (
          <StatusBannerAction
            label={actions.refresh ?? 'Refresh'}
            onClick={onRefresh}
            loading={refreshing}
            disabled={refreshing}
            tone="ok"
          />
        ) : null
      }
    />
  )
}
