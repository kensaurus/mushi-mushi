/**
 * FILE: apps/admin/src/components/inbox/InboxStatusBanner.tsx
 * PURPOSE: Action inbox posture — open work, setup gaps, all-clear state.
 */

import { RelativeTime } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { scopedHref } from '../../lib/humanPageHints'
import { StatusBannerShell } from '../StatusBannerShell'
import { StatusBannerAction } from '../StatusBannerAction'
import type { InboxStats, InboxTabId } from './types'

/** Nominal inbox-zero posture is covered by the page hero + snapshot. */
export function isInboxStatusBannerCritical(stats: InboxStats): boolean {
  if (!stats.hasAnyProject || stats.topPriority === 'no_project') return true
  if (stats.topPriority === 'setup') return true
  if (stats.topPriority === 'actions') return true
  return false
}

interface Props {
  stats: InboxStats
  onTab?: (tab: InboxTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
}

export function InboxStatusBanner({
  stats,
  onTab,
  onRefresh,
  refreshing,
  plainBanner = false,
}: Props) {
  const copy = usePageCopy('/inbox')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'workspace'
  const pid = stats.projectId

  if (stats.topPriority === 'no_project' || !stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Create your first app to see your to-do list' : 'No projects — inbox is empty'}
        subtitle={
          stats.topPriorityLabel ??
          (plainBanner
            ? 'Once setup is done, bugs and fixes show up here automatically.'
            : 'Create a project on Setup first. Actions appear here once reports and integrations are wired.')
        }
        action={
          <StatusBannerAction
            label={actions.setup ?? 'Go to Setup'}
            to={stats.nextStepTo ?? '/onboarding'}
            tone="info"
          />
        }
      />
    )
  }

  if (stats.topPriority === 'setup') {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? `Setup ${stats.requiredComplete} of ${stats.requiredTotal} done on ${projectLabel}`
            : `Setup incomplete on ${projectLabel} (${stats.requiredComplete}/${stats.requiredTotal})`
        }
        subtitle={
          stats.topPriorityLabel ??
          (plainBanner
            ? 'Finish setup — the inbox stays empty until bugs can arrive.'
            : 'Finish ingest before the inbox can surface real triage and fix actions.')
        }
        action={
          <StatusBannerAction
            label={actions.setup ?? 'Continue setup'}
            to={stats.nextStepTo ?? scopedHref('/onboarding?tab=steps', pid)}
            tone="warn"
          />
        }
      />
    )
  }

  if (stats.topPriority === 'actions') {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${stats.openActions} thing${stats.openActions === 1 ? ' needs' : 's need'} you`
            : `${stats.openActions} open action${stats.openActions === 1 ? '' : 's'} — start with ${stats.topPriorityStage ?? 'Plan'}`
        }
        subtitle={
          stats.topPriorityLabel ??
          stats.topPriorityTitle ??
          'Work the queue top to bottom — each item links to the page that clears it.'
        }
        action={
          stats.topPriorityTo ? (
            <StatusBannerAction
              label={actions.takeAction ?? 'Take action'}
              to={stats.topPriorityTo}
              tone="danger"
            />
          ) : onTab ? (
            <StatusBannerAction
              label={actions.queue ?? 'View queue'}
              onClick={() => onTab('actions')}
              tone="danger"
            />
          ) : null
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={
        plainBanner
          ? 'Nothing waiting — you are caught up'
          : `Inbox zero — ${stats.clearStages}/${stats.totalSurfaces} stages clear`
      }
      subtitle={
        stats.topPriorityLabel ?? (
          <>
            {plainBanner
              ? 'New bugs and failed fixes will appear here automatically.'
              : 'No open actions across Plan, Do, Check, Act, or Ops'}
            {stats.lastActivityAt ? (
              <>
                {' '}
                · last activity <RelativeTime value={stats.lastActivityAt} />
              </>
            ) : null}
          </>
        )
      }
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
        ) : onTab ? (
          <StatusBannerAction label={actions.stages ?? 'View stages'} onClick={() => onTab('stages')} tone="ok" />
        ) : null
      }
    />
  )
}
