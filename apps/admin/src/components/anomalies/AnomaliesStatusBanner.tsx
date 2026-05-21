/**
 * FILE: apps/admin/src/components/anomalies/AnomaliesStatusBanner.tsx
 * PURPOSE: Anomaly detection posture — no metrics, open anomalies, release regression, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import type { AnomaliesStats, AnomaliesTabId } from './AnomaliesStatsTypes'

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

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Pick a project first' : 'No project selected'}
        subtitle={
          plainBanner
            ? 'Metric alerts are per app — choose one in the header.'
            : 'Pick a project to ingest metrics and run anomaly detection.'
        }
        action={
          <Link to="/onboarding">
            <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'open_critical') {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${stats.openAnomalies} spike${stats.openAnomalies === 1 ? '' : 's'} need review`
            : `${stats.openAnomalies} open anomal${stats.openAnomalies === 1 ? 'y' : 'ies'} on ${projectLabel}${stats.releaseRegressionOpen > 0 ? ' · release regression' : ''}`
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.triage ?? 'Triage anomalies'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('anomalies')}>{actions.triage ?? 'Triage anomalies'}</Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'open_anomalies') {
    return (
      <StatusBannerShell
        tone="warn"
        title={`${stats.openAnomalies} metric anomal${stats.openAnomalies === 1 ? 'y' : 'ies'} need review`}
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.review ?? 'Review anomalies'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('anomalies')}>{actions.review ?? 'Review anomalies'}</Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'no_metrics') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'No metric data yet' : `No metric data on ${projectLabel}`}
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.ingest ?? 'Ingest metrics'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('metrics')}>{actions.ingest ?? 'Ingest metrics'}</Btn>
          ) : null
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
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            {actions.refresh ?? 'Refresh'}
          </Btn>
        ) : stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.detect ?? 'Run detection'}</Btn>
          </Link>
        ) : null
      }
    />
  )
}
