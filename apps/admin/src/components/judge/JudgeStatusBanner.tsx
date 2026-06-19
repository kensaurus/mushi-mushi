/**
 * FILE: apps/admin/src/components/judge/JudgeStatusBanner.tsx
 * PURPOSE: Judge posture — no evals, low score, drift, disagreements, healthy.
 */

import { usePageCopy } from '../../lib/copy'
import { judgeDisagreementHint, scopedHref } from '../../lib/humanPageHints'
import { StatusBannerShell } from '../StatusBannerShell'
import { StatusBannerAction } from '../StatusBannerAction'
import type { JudgeStats, JudgeTabId } from './JudgeStatsTypes'

/** Healthy posture is covered by the page hero + snapshot — skip the banner. */
export function isJudgeStatusBannerCritical(stats: JudgeStats): boolean {
  if (!stats.hasAnyProject) return true
  return stats.topPriority !== 'healthy'
}

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
  const pid = stats.projectId

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
          <StatusBannerAction label={actions.setup ?? 'Go to Setup'} to="/onboarding" tone="info" />
        }
      />
    )
  }

  if (stats.topPriority === 'no_evals') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? `No grades yet on ${projectLabel}` : `No judge evaluations on ${projectLabel}`}
        subtitle={
          stats.topPriorityLabel ??
          (stats.classifiedReports > 0
            ? `${stats.classifiedReports} classified report${stats.classifiedReports === 1 ? '' : 's'} ready to grade.`
            : 'Classify a few bugs in Reports first — then run the judge.')
        }
        action={
          onRunJudge ? (
            <StatusBannerAction
              label={actions.run ?? 'Run judge now'}
              onClick={onRunJudge}
              loading={running}
              disabled={running}
              tone="brand"
            />
          ) : stats.classifiedReports > 0 ? (
            <StatusBannerAction
              label={actions.run ?? 'Run judge now'}
              to={scopedHref('/judge?action=run', pid)}
              tone="brand"
            />
          ) : (
            <StatusBannerAction
              label={actions.reports ?? 'Open Reports'}
              to={scopedHref('/reports?tab=queue', pid)}
              tone="brand"
            />
          )
        }
      />
    )
  }

  if (stats.topPriority === 'low_score' || stats.topPriority === 'drifting') {
    const drifting = stats.topPriority === 'drifting'
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? drifting
              ? 'Classifier scores dropped week-over-week'
              : 'Classifier scores below 60% — triage may be wrong'
            : drifting
              ? 'Score drifting week-over-week'
              : 'Classifier score below 60%'
        }
        subtitle={
          stats.topPriorityLabel ??
          (drifting
            ? 'Recent grades are worse than last week — review mismatches before merging fixes.'
            : 'The judge thinks triage quality is poor — review Prompt Lab or recent evaluations.')
        }
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction
              label={actions.investigate ?? 'Review evaluations'}
              to={stats.topPriorityTo}
              tone="danger"
            />
          ) : onTab ? (
            <StatusBannerAction
              label={actions.investigate ?? 'Review evaluations'}
              onClick={() => onTab('evaluations')}
              tone="danger"
            />
          ) : (
            <StatusBannerAction
              label={actions.investigate ?? 'Review evaluations'}
              to={scopedHref('/judge?tab=evaluations&filter=disagreement', pid)}
              tone="danger"
            />
          )
        }
      />
    )
  }

  if (stats.topPriority === 'disagreements') {
    const rate = stats.disagreementRatePct ?? 0
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? `${rate}% of grades disagree with the classifier`
            : `${rate}% disagreement rate`
        }
        subtitle={stats.topPriorityLabel ?? judgeDisagreementHint(rate)}
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction
              label={actions.disagreements ?? 'Review disagreements'}
              to={stats.topPriorityTo}
              tone="warn"
            />
          ) : onTab ? (
            <StatusBannerAction
              label={actions.disagreements ?? 'Review disagreements'}
              onClick={() => onTab('evaluations')}
              tone="warn"
            />
          ) : (
            <StatusBannerAction
              label={actions.disagreements ?? 'Review disagreements'}
              to={scopedHref('/judge?tab=evaluations&filter=disagreement', pid)}
              tone="warn"
            />
          )
        }
      />
    )
  }

  if (stats.topPriority === 'stale') {
    return (
      <StatusBannerShell
        tone="warn"
        title={plainBanner ? 'Judge grades are out of date' : 'Judge scores stale'}
        subtitle={
          stats.topPriorityLabel ??
          'Run the judge again so you know whether triage quality still holds.'
        }
        action={
          onRunJudge ? (
            <StatusBannerAction
              label={actions.run ?? 'Run judge now'}
              onClick={onRunJudge}
              loading={running}
              disabled={running}
              tone="warn"
            />
          ) : (
            <StatusBannerAction
              label={actions.run ?? 'Run judge now'}
              to={scopedHref('/judge?action=run', pid)}
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
      title={plainBanner ? `Classifier grades look healthy on ${projectLabel}` : `Judge healthy on ${projectLabel}`}
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
          <StatusBannerAction label={actions.trend ?? 'View trend'} to={stats.topPriorityTo} tone="ok" />
        ) : onTab ? (
          <StatusBannerAction label={actions.trend ?? 'View trend'} onClick={() => onTab('trend')} tone="ok" />
        ) : null
      }
    />
  )
}
