/**
 * FILE: apps/admin/src/components/judge/JudgeStatusBanner.tsx
 * PURPOSE: Judge posture — no evals, low score, drift, disagreements, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { StatusBannerShell } from '../StatusBannerShell'
import type { JudgeStats, JudgeTabId } from './JudgeStatsTypes'

interface Props {
  stats: JudgeStats
  onTab?: (tab: JudgeTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  onRunJudge?: () => void
  running?: boolean
  plainBanner?: boolean
}

export function JudgeStatusBanner({
  stats,
  onTab,
  onRefresh,
  refreshing,
  onRunJudge,
  running,
  plainBanner = false,
}: Props) {
  const copy = usePageCopy('/judge')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Create a project before the judge can run' : 'No projects — judge idle'}
        subtitle={
          plainBanner
            ? 'Classify a few bugs first — then the judge grades whether triage was right.'
            : 'Create a project and classify reports before running judge.'
        }
        action={
          <Link to="/onboarding">
            <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'no_evals') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? `No grades yet on ${projectLabel}` : `No judge evaluations on ${projectLabel}`}
        subtitle={stats.topPriorityLabel}
        action={
          onRunJudge ? (
            <Btn size="sm" variant="ghost" onClick={onRunJudge} loading={running} disabled={running}>
              {actions.run ?? 'Run judge now'}
            </Btn>
          ) : stats.classifiedReports > 0 ? (
            <Link to="/judge?action=run">
              <Btn size="sm" variant="ghost">{actions.run ?? 'Run judge now'}</Btn>
            </Link>
          ) : (
            <Link to="/reports">
              <Btn size="sm" variant="ghost">{actions.reports ?? 'Open Reports'}</Btn>
            </Link>
          )
        }
      />
    )
  }

  if (stats.topPriority === 'low_score' || stats.topPriority === 'drifting') {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? stats.topPriority === 'low_score'
              ? 'Classifier scores below 60% — triage may be wrong'
              : 'Scores dropped week-over-week'
            : stats.topPriority === 'low_score'
              ? 'Classifier score below 60%'
              : 'Score drifting week-over-week'
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.investigate ?? 'Investigate'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('evaluations')}>
              {actions.investigate ?? 'Investigate'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'disagreements') {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? `${stats.disagreementRatePct ?? 0}% of grades disagree with the classifier`
            : `${stats.disagreementRatePct ?? 0}% disagreement rate`
        }
        subtitle={stats.topPriorityLabel}
        action={
          stats.topPriorityTo ? (
            <Link to={stats.topPriorityTo}>
              <Btn size="sm" variant="ghost">{actions.disagreements ?? 'View disagreements'}</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('evaluations')}>
              {actions.disagreements ?? 'View disagreements'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'stale') {
    return (
      <StatusBannerShell
        tone="warn"
        title={plainBanner ? 'Judge grades are out of date' : 'Judge scores stale'}
        subtitle={stats.topPriorityLabel}
        action={
          onRunJudge ? (
            <Btn size="sm" variant="ghost" onClick={onRunJudge} loading={running} disabled={running}>
              {actions.run ?? 'Run judge now'}
            </Btn>
          ) : (
            <Link to="/judge?action=run">
              <Btn size="sm" variant="ghost">{actions.run ?? 'Run judge now'}</Btn>
            </Link>
          )
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? `Classifier grades look healthy on ${projectLabel}` : `Judge healthy on ${projectLabel}`}
      subtitle={stats.topPriorityLabel}
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            {actions.refresh ?? 'Refresh'}
          </Btn>
        ) : stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.trend ?? 'View trend'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('trend')}>
            {actions.trend ?? 'View trend'}
          </Btn>
        ) : null
      }
    />
  )
}
