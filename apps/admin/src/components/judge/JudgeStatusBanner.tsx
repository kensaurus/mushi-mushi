/**
 * FILE: apps/admin/src/components/judge/JudgeStatusBanner.tsx
 * PURPOSE: Judge posture — no evals, low score, drift, disagreements, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { usePageCopy } from '../../lib/copy'
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
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {plainBanner ? 'Create a project before the judge can run' : 'No projects — judge idle'}
            </p>
            <p className="text-2xs text-fg-muted">
              {plainBanner
                ? 'Classify a few bugs first — then the judge grades whether triage was right.'
                : 'Create a project and classify reports before running judge.'}
            </p>
          </div>
        </div>
        <Link to="/onboarding">
          <Btn size="sm" variant="ghost">{actions.setup ?? 'Go to Setup'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'no_evals') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">
              {plainBanner
                ? `No grades yet on ${projectLabel}`
                : `No judge evaluations on ${projectLabel}`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {onRunJudge ? (
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
        )}
      </div>
    )
  }

  if (stats.topPriority === 'low_score' || stats.topPriority === 'drifting') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {plainBanner
                ? stats.topPriority === 'low_score'
                  ? 'Classifier scores below 60% — triage may be wrong'
                  : 'Scores dropped week-over-week'
                : stats.topPriority === 'low_score'
                  ? 'Classifier score below 60%'
                  : 'Score drifting week-over-week'}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.investigate ?? 'Investigate'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('evaluations')}>
            {actions.investigate ?? 'Investigate'}
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'disagreements') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner
                ? `${stats.disagreementRatePct ?? 0}% of grades disagree with the classifier`
                : `${stats.disagreementRatePct ?? 0}% disagreement rate`}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">{actions.disagreements ?? 'View disagreements'}</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('evaluations')}>
            {actions.disagreements ?? 'View disagreements'}
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'stale') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner ? 'Judge grades are out of date' : 'Judge scores stale'}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {onRunJudge ? (
          <Btn size="sm" variant="ghost" onClick={onRunJudge} loading={running} disabled={running}>
            {actions.run ?? 'Run judge now'}
          </Btn>
        ) : (
          <Link to="/judge?action=run">
            <Btn size="sm" variant="ghost">{actions.run ?? 'Run judge now'}</Btn>
          </Link>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">
            {plainBanner ? `Classifier grades look healthy on ${projectLabel}` : `Judge healthy on ${projectLabel}`}
          </p>
          <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
        </div>
      </div>
      {onRefresh ? (
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
      ) : null}
    </div>
  )
}
