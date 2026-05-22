/**
 * FILE: apps/admin/src/components/lessons/LessonsStatusBanner.tsx
 * PURPOSE: Lessons posture — no data, candidates ready, critical rules, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import type { LessonsStats, LessonsTabId } from './LessonsStatsTypes'

interface Props {
  stats: LessonsStats
  onTab?: (tab: LessonsTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function LessonsStatusBanner({ stats, onTab, onRefresh, refreshing, plainBanner = false }: Props) {
  const copy = usePageCopy('/lessons')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Pick a project first' : 'No project selected'}
        subtitle={
          plainBanner
            ? 'Mistake memory is per app — choose one in the header.'
            : 'Pick a project to view mistake clusters and promoted lessons.'
        }
        action={
          <Link to="/onboarding">
            <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'no_data') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'No lesson memory yet' : `No lesson memory on ${projectLabel}`}
        subtitle={stats.topPriorityLabel}
        action={
          <Link to="/reports">
            <Btn size="sm" variant="ghost">{actions.reports ?? 'Open Reports'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'candidates_ready' || stats.topPriority === 'no_lessons') {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          stats.topPriority === 'candidates_ready'
            ? `${stats.readyToPromote} cluster${stats.readyToPromote === 1 ? '' : 's'} ready to promote`
            : `${stats.candidateClusters} cluster${stats.candidateClusters === 1 ? '' : 's'} forming`
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.clusters ?? 'Review clusters'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('clusters')}>{actions.clusters ?? 'Review clusters'}</Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'critical_lessons') {
    return (
      <StatusBannerShell
        tone="danger"
        title={`${stats.criticalLessons} critical lesson${stats.criticalLessons === 1 ? '' : 's'}`}
        subtitle={stats.topPriorityLabel}
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('lessons')}>{actions.lessons ?? 'Review lessons'}</Btn>
          ) : (
            <Link to="/lessons?tab=lessons">
              <Btn size="sm" variant="ghost">{actions.lessons ?? 'Review lessons'}</Btn>
            </Link>
          )
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? 'Lesson memory active' : `Lesson memory active on ${projectLabel}`}
      subtitle={stats.topPriorityLabel}
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            {actions.refresh ?? 'Refresh'}
          </Btn>
        ) : stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.query ?? 'Try query sim'}</Btn>
          </Link>
        ) : null
      }
    />
  )
}
