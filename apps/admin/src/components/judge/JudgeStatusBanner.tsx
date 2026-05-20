/**
 * FILE: apps/admin/src/components/judge/JudgeStatusBanner.tsx
 * PURPOSE: Judge posture — no evals, low score, drift, disagreements, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import type { JudgeStats, JudgeTabId } from './JudgeStatsTypes'

interface Props {
  stats: JudgeStats
  onTab?: (tab: JudgeTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  onRunJudge?: () => void
  running?: boolean
}

export function JudgeStatusBanner({
  stats,
  onTab,
  onRefresh,
  refreshing,
  onRunJudge,
  running,
}: Props) {
  const projectLabel = stats.projectName ?? 'workspace'

  if (!stats.hasAnyProject) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">No projects — judge idle</p>
            <p className="text-2xs text-fg-muted">Create a project and classify reports before running judge.</p>
          </div>
        </div>
        <Link to="/onboarding">
          <Btn size="sm" variant="ghost">Go to Setup</Btn>
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
            <p className="text-xs font-medium text-brand">No judge evaluations on {projectLabel}</p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {onRunJudge ? (
          <Btn size="sm" variant="ghost" onClick={onRunJudge} loading={running} disabled={running}>
            Run judge now
          </Btn>
        ) : stats.classifiedReports > 0 ? (
          <Link to="/judge?action=run">
            <Btn size="sm" variant="ghost">Run judge now</Btn>
          </Link>
        ) : (
          <Link to="/reports">
            <Btn size="sm" variant="ghost">Open Reports</Btn>
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
              {stats.topPriority === 'low_score' ? 'Classifier score below 60%' : 'Score drifting week-over-week'}
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">Investigate</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('evaluations')}>
            Investigate
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
              {stats.disagreementRatePct ?? 0}% disagreement rate
            </p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {stats.topPriorityTo ? (
          <Link to={stats.topPriorityTo}>
            <Btn size="sm" variant="ghost">View disagreements</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('evaluations')}>
            View disagreements
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
            <p className="text-xs font-medium text-warn">Judge scores stale</p>
            <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
          </div>
        </div>
        {onRunJudge ? (
          <Btn size="sm" variant="ghost" onClick={onRunJudge} loading={running} disabled={running}>
            Run judge now
          </Btn>
        ) : (
          <Link to="/judge?action=run">
            <Btn size="sm" variant="ghost">Run judge now</Btn>
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
          <p className="text-xs font-medium text-ok">Judge healthy on {projectLabel}</p>
          <p className="text-2xs text-fg-muted">{stats.topPriorityLabel}</p>
        </div>
      </div>
      {onRefresh ? (
        <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
          Refresh
        </Btn>
      ) : stats.topPriorityTo ? (
        <Link to={stats.topPriorityTo}>
          <Btn size="sm" variant="ghost">View trend</Btn>
        </Link>
      ) : null}
    </div>
  )
}
