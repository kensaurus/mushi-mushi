/**
 * FILE: apps/admin/src/components/drift/DriftStatusBanner.tsx
 * PURPOSE: Contract drift posture — never scanned, critical/warn findings, stale, healthy.
 */

import { usePageCopy } from '../../lib/copy'
import {
  driftCriticalHint,
  driftHealthyHint,
  driftNeverScannedHint,
  driftStaleHint,
  driftWarnHint,
  scopedHref,
} from '../../lib/humanPageHints'
import { StatusBannerShell } from '../StatusBannerShell'
import { StatusBannerAction } from '../StatusBannerAction'
import type { DriftStats, DriftTabId } from './DriftStatsTypes'

/** Healthy posture is covered by the page hero + snapshot — skip the banner. */
export function isDriftStatusBannerCritical(stats: DriftStats): boolean {
  if (!stats.hasAnyProject) return true
  return stats.topPriority !== 'healthy'
}

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
  const pid = stats.projectId

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Pick a project first' : 'No project selected'}
        subtitle={
          plainBanner
            ? 'Contract checks are per app — choose one in the header.'
            : 'Pick a project to compare your API docs, routes, and database schema.'
        }
        action={
          <StatusBannerAction label={actions.setup ?? 'Go to Setup'} to="/onboarding" tone="info" />
        }
      />
    )
  }

  if (stats.topPriority === 'critical_findings') {
    const n = stats.criticalOpen
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${n} API mismatch${n === 1 ? '' : 'es'} need review`
            : `${n} API mismatch${n === 1 ? '' : 'es'} on ${projectLabel}`
        }
        subtitle={stats.topPriorityLabel ?? driftCriticalHint(n)}
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction
              label={actions.findings ?? 'Review findings'}
              to={stats.topPriorityTo}
              tone="danger"
            />
          ) : onTab ? (
            <StatusBannerAction
              label={actions.findings ?? 'Review findings'}
              onClick={() => onTab('findings')}
              tone="danger"
            />
          ) : (
            <StatusBannerAction
              label={actions.findings ?? 'Review findings'}
              to={scopedHref('/drift?tab=findings', pid)}
              tone="danger"
            />
          )
        }
      />
    )
  }

  if (stats.topPriority === 'warn_findings') {
    const n = stats.warnOpen
    return (
      <StatusBannerShell
        tone="warn"
        title={`${n} warning${n === 1 ? '' : 's'} need review`}
        subtitle={stats.topPriorityLabel ?? driftWarnHint(n)}
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction
              label={actions.review ?? 'Review findings'}
              to={stats.topPriorityTo}
              tone="warn"
            />
          ) : onTab ? (
            <StatusBannerAction
              label={actions.review ?? 'Review findings'}
              onClick={() => onTab('findings')}
              tone="warn"
            />
          ) : (
            <StatusBannerAction
              label={actions.review ?? 'Review findings'}
              to={scopedHref('/drift?tab=findings', pid)}
              tone="warn"
            />
          )
        }
      />
    )
  }

  if (stats.topPriority === 'never_scanned') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'No baseline scan yet' : `No baseline scan on ${projectLabel}`}
        subtitle={stats.topPriorityLabel ?? driftNeverScannedHint()}
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction
              label={actions.firstScan ?? 'Run first scan'}
              to={stats.topPriorityTo}
              tone="brand"
              emphasis="primary"
            />
          ) : onTab ? (
            <StatusBannerAction
              label={actions.firstScan ?? 'Run first scan'}
              onClick={() => onTab('scanner')}
              tone="brand"
              emphasis="primary"
            />
          ) : (
            <StatusBannerAction
              label={actions.firstScan ?? 'Run first scan'}
              to={scopedHref('/drift?tab=scanner', pid)}
              tone="brand"
              emphasis="primary"
            />
          )
        }
      />
    )
  }

  if (stats.topPriority === 'stale_scan') {
    return (
      <StatusBannerShell
        tone="warn"
        title={plainBanner ? 'Baseline scan is stale' : `Baseline scan is stale on ${projectLabel}`}
        subtitle={stats.topPriorityLabel ?? driftStaleHint()}
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction
              label={actions.scan ?? 'Run scan'}
              to={stats.topPriorityTo}
              tone="warn"
            />
          ) : onTab ? (
            <StatusBannerAction
              label={actions.scan ?? 'Run scan'}
              onClick={() => onTab('scanner')}
              tone="warn"
            />
          ) : (
            <StatusBannerAction
              label={actions.scan ?? 'Run scan'}
              to={scopedHref('/drift?tab=scanner', pid)}
              tone="warn"
            />
          )
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? 'API contracts in sync' : `API contracts in sync on ${projectLabel}`}
      subtitle={stats.topPriorityLabel ?? driftHealthyHint()}
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
            label={actions.snapshots ?? 'View snapshots'}
            to={stats.topPriorityTo}
            tone="ok"
          />
        ) : null
      }
    />
  )
}
