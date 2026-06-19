/**
 * Skill pipeline posture banner — failed runs, awaiting check-in, catalog empty.
 */

import { usePageCopy } from '../../lib/copy'
import { scopedHref } from '../../lib/humanPageHints'
import { StatusBannerShell } from '../StatusBannerShell'
import { StatusBannerAction } from '../StatusBannerAction'
import type { SkillsStats } from './SkillsStatsTypes'

interface Props {
  stats: SkillsStats
  onTab?: (tab: 'catalog' | 'pipelines' | 'sources') => void
  plainBanner?: boolean
}

export function SkillsStatusBanner({ stats, onTab, plainBanner = false }: Props) {
  const copy = usePageCopy('/skills')
  const actions = copy?.actionLabels ?? {}
  const pid = stats.projectId

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Pick a project first' : 'No project selected'}
        subtitle="Skill pipelines run per app — choose one in the header."
        action={
          <StatusBannerAction label={actions.setup ?? 'Go to Setup'} to="/onboarding" tone="info" />
        }
      />
    )
  }

  if (stats.topPriority === 'empty_catalog') {
    return (
      <StatusBannerShell
        tone="brand"
        title={plainBanner ? 'Skill catalog is empty' : 'No skills synced yet'}
        subtitle={
          stats.topPriorityLabel ??
          'Add a GitHub source (e.g. kensaurus/cursor-kenji) and sync to load 70+ workflows.'
        }
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction label={actions.sources ?? 'Add source'} to={stats.topPriorityTo} tone="brand" />
          ) : onTab ? (
            <StatusBannerAction label={actions.sources ?? 'Add source'} onClick={() => onTab('sources')} tone="brand" />
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'failed_runs') {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${stats.failedRuns} pipeline run${stats.failedRuns === 1 ? '' : 's'} failed`
            : `${stats.failedRuns} failed pipeline run${stats.failedRuns === 1 ? '' : 's'}`
        }
        subtitle={stats.topPriorityLabel ?? 'Open the run to read the step error, then retry or check in manually.'}
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction label={actions.pipelines ?? 'View runs'} to={stats.topPriorityTo} tone="danger" />
          ) : onTab ? (
            <StatusBannerAction label={actions.pipelines ?? 'View runs'} onClick={() => onTab('pipelines')} tone="danger" />
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'awaiting_checkin') {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? `${stats.awaitingCheckin} step${stats.awaitingCheckin === 1 ? '' : 's'} waiting for you`
            : `${stats.awaitingCheckin} pipeline step${stats.awaitingCheckin === 1 ? '' : 's'} awaiting check-in`
        }
        subtitle={
          stats.topPriorityLabel ??
          'Handoff mode pauses until you mark each step passed or failed in the IDE.'
        }
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction label={actions.pipelines ?? 'Open runs'} to={stats.topPriorityTo} tone="warn" />
          ) : onTab ? (
            <StatusBannerAction label={actions.pipelines ?? 'Open runs'} onClick={() => onTab('pipelines')} tone="warn" />
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'active_runs') {
    return (
      <StatusBannerShell
        tone="brand"
        pulseDot
        title={
          plainBanner
            ? `${stats.activeRuns} pipeline${stats.activeRuns === 1 ? '' : 's'} running`
            : `${stats.activeRuns} active pipeline run${stats.activeRuns === 1 ? '' : 's'}`
        }
        subtitle={stats.topPriorityLabel ?? 'Steps update live — open Pipelines to watch progress.'}
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction label={actions.pipelines ?? 'Watch runs'} to={stats.topPriorityTo} tone="brand" />
          ) : onTab ? (
            <StatusBannerAction label={actions.pipelines ?? 'Watch runs'} onClick={() => onTab('pipelines')} tone="brand" />
          ) : null
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? 'Skills ready' : `${stats.catalogTotal} skills in catalog`}
      subtitle={
        stats.topPriorityLabel ??
        `Attach a skill to a report or start a workflow from the catalog.`
      }
      action={
        stats.topPriorityTo ? (
          <StatusBannerAction label={actions.catalog ?? 'Browse catalog'} to={stats.topPriorityTo} tone="ok" />
        ) : onTab ? (
          <StatusBannerAction label={actions.catalog ?? 'Browse catalog'} onClick={() => onTab('catalog')} tone="ok" />
        ) : (
          <StatusBannerAction
            label={actions.catalog ?? 'Browse catalog'}
            to={scopedHref('/skills?tab=catalog', pid)}
            tone="ok"
          />
        )
      }
    />
  )
}

export function isSkillsBannerVisible(stats: SkillsStats): boolean {
  if (!stats.hasAnyProject) return true
  return stats.topPriority !== 'healthy'
}
