/**
 * FILE: apps/admin/src/components/drift/DriftStatusBanner.tsx
 * PURPOSE: Contract drift posture — never scanned, critical/warn findings, stale, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import type { DriftStats, DriftTabId } from './DriftStatsTypes'

interface Props {
  stats: DriftStats
  onTab?: (tab: DriftTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function DriftStatusBanner({ stats, onTab, onRefresh, refreshing, plainBanner = false }: Props) {
  const copy = usePageCopy('/drift')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Pick a project first' : 'No project selected'}
        subtitle={
          plainBanner
            ? 'Contract checks are per app — choose one in the header.'
            : 'Pick a project to compare OpenAPI, inventory, and DB schema contracts.'
        }
        action={
          <Link to="/onboarding">
            <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'critical_findings') {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${stats.criticalOpen} critical contract gap${stats.criticalOpen === 1 ? '' : 's'}`
            : `${stats.criticalOpen} critical contract gap${stats.criticalOpen === 1 ? '' : 's'} on ${projectLabel}`
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.findings ?? 'Triage findings'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('findings')}>{actions.findings ?? 'Triage findings'}</Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'warn_findings') {
    return (
      <StatusBannerShell
        tone="warn"
        title={`${stats.warnOpen} warning-level drift${stats.warnOpen === 1 ? '' : 's'} open`}
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.review ?? 'Review findings'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('findings')}>{actions.review ?? 'Review findings'}</Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'never_scanned') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'No contract snapshot yet' : `No contract snapshot on ${projectLabel}`}
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.firstScan ?? 'Run first scan'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('scanner')}>{actions.firstScan ?? 'Run first scan'}</Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'stale_scan') {
    return (
      <StatusBannerShell
        tone="warn"
        title={plainBanner ? 'Contract snapshot is stale' : `Contract snapshot is stale on ${projectLabel}`}
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.scan ?? 'Run scan'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('scanner')}>{actions.scan ?? 'Run scan'}</Btn>
          ) : null
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? 'Contracts in sync' : `Contracts in sync on ${projectLabel}`}
      subtitle={stats.topPriorityLabel}
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            {actions.refresh ?? 'Refresh'}
          </Btn>
        ) : stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.snapshots ?? 'View snapshots'}</Btn>
          </Link>
        ) : null
      }
    />
  )
}
