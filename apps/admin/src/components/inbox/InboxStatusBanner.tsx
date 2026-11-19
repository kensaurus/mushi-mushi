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

/**
 * The "N things need you" banner only repeats the list when there is one
 * open card: the same sentence twice and two buttons ("Take action",
 * "Review & fix") for one action (fresh-eyes sweep 2026-11-18). Then the card
 * is the banner.
 */
export function inboxBannerRepeatsCards(stats: InboxStats, openCards: number): boolean {
  return stats.topPriority === 'actions' && openCards <= 1
}

/**
 * The banner counts the cards the page lists, not /inbox/stats: the server said "1 thing needs
 * you" while three cards (a critical, a stuck pipeline group, two worker problems) were open
 * below it (round-3 review, 2026-11-19). Setup and no-project states stay the server's.
 */
export function reconcileInboxStats(
  stats: InboxStats,
  counts: { open: number; settled: number; total: number },
): InboxStats {
  if (stats.topPriority !== 'actions' && stats.topPriority !== 'clear') return stats
  return {
    ...stats,
    openActions: counts.open,
    clearStages: counts.settled,
    totalSurfaces: counts.total,
    topPriority: counts.open > 0 ? 'actions' : 'clear',
  }
}

interface Props {
  stats: InboxStats
  onTab?: (tab: InboxTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
  plainBanner?: boolean
  /**
   * The open cards are on screen below the banner. Then the banner is only the count: its
   * sentence and "Take action" repeated the first card's text and its "Review & fix" button
   * (round-3 review, 2026-11-19).
   */
  cardsShown?: boolean
}

export function InboxStatusBanner({
  stats,
  onTab,
  onRefresh,
  refreshing,
  plainBanner = false,
  cardsShown = false,
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
    // Open work is a to-do, not a failure: amber, never red.
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? `${stats.openActions} thing${stats.openActions === 1 ? ' needs' : 's need'} you`
            : `${stats.openActions} open action${stats.openActions === 1 ? '' : 's'} — start with: ${stats.topPriorityTitle ?? stats.topPriorityStage ?? 'Plan'}`
        }
        subtitle={
          cardsShown
            ? null
            : (stats.topPriorityLabel ??
              // The advanced title already names the action; don't repeat it.
              (plainBanner ? stats.topPriorityTitle : null) ??
              'Work the queue top to bottom — each item links to the page that clears it.')
        }
        action={
          cardsShown ? null : onTab ? (
            <StatusBannerAction
              label={actions.queue ?? 'View the list'}
              onClick={() => onTab('overview')}
              tone="warn"
            />
          ) : stats.topPriorityTo ? (
            <StatusBannerAction
              label={actions.takeAction ?? 'Take action'}
              to={stats.topPriorityTo}
              tone="warn"
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
