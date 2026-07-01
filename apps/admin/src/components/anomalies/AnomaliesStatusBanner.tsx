/**
 * FILE: apps/admin/src/components/anomalies/AnomaliesStatusBanner.tsx
 * PURPOSE: Anomaly detection posture — no metrics, open spikes, release regression, healthy.
 */

import { usePageCopy } from '../../lib/copy'
import {
  anomaliesCriticalHint,
  anomaliesNoMetricsHint,
  anomaliesOpenHint,
  scopedHref,
} from '../../lib/humanPageHints'
import { StatusBannerShell } from '../StatusBannerShell'
import { StatusBannerAction } from '../StatusBannerAction'
import type { AnomaliesStats, AnomaliesTabId } from './AnomaliesStatsTypes'

/** Healthy posture is covered by the page hero + snapshot — skip the banner. */
export function isAnomaliesStatusBannerCritical(stats: AnomaliesStats): boolean {
  if (!stats.hasAnyProject) return true
  return stats.topPriority !== 'healthy'
}

interface Props {
  stats: AnomaliesStats
  onTab?: (tab: AnomaliesTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function AnomaliesStatusBanner({ stats, onTab, onRefresh, refreshing, plainBanner = false }: Props) {
  const copy = usePageCopy('/anomalies')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'workspace'
  const pid = stats.projectId

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Pick a project first' : 'No project selected'}
        subtitle={
          plainBanner
            ? 'Metric alerts are per app — choose one in the header.'
            : 'Pick a project to ingest metrics and run spike detection.'
        }
        action={
          <StatusBannerAction label={actions.setup ?? 'Go to Setup'} to="/onboarding" tone="info" />
        }
      />
    )
  }

  if (stats.topPriority === 'open_critical') {
    const n = stats.openAnomalies
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${n} metric spike${n === 1 ? '' : 's'} need review`
            : `${n} metric spike${n === 1 ? '' : 's'} on ${projectLabel}${stats.releaseRegressionOpen > 0 ? ' · possible release regression' : ''}`
        }
        subtitle={stats.topPriorityLabel ?? anomaliesCriticalHint(n)}
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction
              label={actions.triage ?? 'Review spikes'}
              to={stats.topPriorityTo}
              tone="danger"
            />
          ) : onTab ? (
            <StatusBannerAction
              label={actions.triage ?? 'Review spikes'}
              onClick={() => onTab('anomalies')}
              tone="danger"
            />
          ) : (
            <StatusBannerAction
              label={actions.triage ?? 'Review spikes'}
              to={scopedHref('/anomalies?tab=anomalies', pid)}
              tone="danger"
            />
          )
        }
      />
    )
  }

  if (stats.topPriority === 'open_anomalies') {
    const n = stats.openAnomalies
    return (
      <StatusBannerShell
        tone="warn"
        title={`${n} metric spike${n === 1 ? '' : 's'} need review`}
        subtitle={stats.topPriorityLabel ?? anomaliesOpenHint(n)}
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction
              label={actions.review ?? 'Review spikes'}
              to={stats.topPriorityTo}
              tone="warn"
            />
          ) : onTab ? (
            <StatusBannerAction
              label={actions.review ?? 'Review spikes'}
              onClick={() => onTab('anomalies')}
              tone="warn"
            />
          ) : (
            <StatusBannerAction
              label={actions.review ?? 'Review spikes'}
              to={scopedHref('/anomalies?tab=anomalies', pid)}
              tone="warn"
            />
          )
        }
      />
    )
  }

  if (stats.topPriority === 'no_metrics') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'No metric data yet' : `No metric data on ${projectLabel}`}
        subtitle={stats.topPriorityLabel ?? anomaliesNoMetricsHint()}
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction
              label={actions.ingest ?? 'Add metrics'}
              to={stats.topPriorityTo}
              tone="brand"
              emphasis="primary"
            />
          ) : onTab ? (
            <StatusBannerAction
              label={actions.ingest ?? 'Add metrics'}
              onClick={() => onTab('metrics')}
              tone="brand"
              emphasis="primary"
            />
          ) : (
            <StatusBannerAction
              label={actions.ingest ?? 'Add metrics'}
              to={scopedHref('/anomalies?tab=metrics', pid)}
              tone="brand"
              emphasis="primary"
            />
          )
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? 'Metrics look normal' : `Metrics look normal on ${projectLabel}`}
      subtitle={stats.topPriorityLabel}
      action={
        onRefresh ? (
          <StatusBannerAction
            label={actions.refresh ?? 'Refresh'}
            onClick={onRefresh}
            loading={refreshing}
            disabled={refreshing}
            tone="ok"
          />
        ) : stats.topPriorityTo ? (
          <StatusBannerAction
            label={actions.detect ?? 'Run detection'}
            to={stats.topPriorityTo}
            tone="ok"
          />
        ) : null
      }
    />
  )
}
