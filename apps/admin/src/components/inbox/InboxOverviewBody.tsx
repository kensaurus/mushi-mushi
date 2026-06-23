/**
 * FILE: apps/admin/src/components/inbox/InboxOverviewBody.tsx
 * PURPOSE: Overview tab primary work zone — never blank; modes derived from live stats + cards.
 * Uses the same compact primitives as Actions/Activity tabs (EmptySectionMessage, ActionPill).
 */

import { HelpBanner } from '../ui/layout'
import type { InboxCard, InboxCardGroup } from '../../lib/actionInboxFromDashboard'
import type { InboxStats, InboxTabId } from './types'
import { isInboxStatusBannerCritical } from './InboxStatusBanner'
import { ClearChip, GROUP_LABEL, OpenInboxCard } from './inbox-card-parts'
import { EmptySectionMessage } from '../report-detail/ReportClassification'
import { ActionPill, ActionPillRow } from '../report-detail/ReportSurface'

export type InboxOverviewMode = 'setup' | 'handoff' | 'preview' | 'clear'

export function resolveInboxOverviewMode(
  stats: InboxStats,
  hideOverviewChrome: boolean,
  snapshotVisible = false,
): InboxOverviewMode {
  if (!stats.setupDone || stats.topPriority === 'setup') return 'setup'
  if (stats.openActions > 0 && isInboxStatusBannerCritical(stats)) return 'handoff'
  if (
    snapshotVisible &&
    stats.openActions > 0 &&
    stats.topPriorityTo
  ) {
    return 'handoff'
  }
  if (
    !hideOverviewChrome &&
    stats.openActions > 0 &&
    stats.topPriorityTitle &&
    stats.topPriorityTo &&
    !isInboxStatusBannerCritical(stats)
  ) {
    return 'preview'
  }
  return 'clear'
}

interface Props {
  stats: InboxStats
  openCards: InboxCard[]
  clearCards: InboxCard[]
  hideOverviewChrome: boolean
  /** When the posture snapshot strip is visible, avoid duplicating metrics in overview. */
  snapshotVisible?: boolean
  onTab: (tab: InboxTabId) => void
  copy?: {
    actionLabels?: {
      takeAction?: string
      queue?: string
      setup?: string
    }
  }
  activityAtByGroup: Partial<Record<InboxCardGroup, string>>
}

export function InboxOverviewBody({
  stats,
  openCards,
  clearCards,
  hideOverviewChrome,
  snapshotVisible = false,
  onTab,
  copy,
  activityAtByGroup,
}: Props) {
  const mode = resolveInboxOverviewMode(stats, hideOverviewChrome, snapshotVisible)
  const actions = copy?.actionLabels ?? {}

  return (
    <div data-inbox-overview-state={mode} className="space-y-3">
      {mode === 'setup' ? (
        <>
          <EmptySectionMessage
            text="Setup incomplete"
            hint={
              stats.topPriorityLabel ??
              `${stats.requiredComplete} of ${stats.requiredTotal} setup steps done — finish ingest before the inbox can surface triage and fix actions.`
            }
          />
          <ActionPillRow>
            <ActionPill to={stats.nextStepTo ?? '/onboarding?tab=steps'} tone="brand">
              {actions.setup ?? 'Continue setup'} →
            </ActionPill>
          </ActionPillRow>
        </>
      ) : null}

      {mode === 'handoff' ? (
        <>
          <EmptySectionMessage
            text={`${stats.openActions} open action${stats.openActions === 1 ? '' : 's'}`}
            hint="Summarized in the status banner above — use the Actions tab for the full priority queue."
          />
          <ActionPillRow>
            <ActionPill tone="brand" onClick={() => onTab('actions')}>
              {actions.queue ?? 'View full queue'} →
            </ActionPill>
            {stats.topPriorityTo ? (
              <ActionPill to={stats.topPriorityTo} tone="neutral">
                {actions.takeAction ?? 'Take top action'}
              </ActionPill>
            ) : null}
          </ActionPillRow>
          {openCards.length > 0 ? (
            <section aria-label="Open actions preview" className="space-y-2 pt-1">
              <h2 className="text-sm font-semibold text-fg-secondary">Next in queue</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {openCards.slice(0, 2).map((card, index) => (
                  <OpenInboxCard
                    key={card.id}
                    card={card}
                    priority={index + 1}
                    isFirst={index === 0}
                    activityAt={activityAtByGroup[card.group]}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {mode === 'preview' ? (
        <>
          <HelpBanner
            tone="warn"
            title={stats.topPriorityTitle ?? 'Top priority'}
            role="status"
          >
            {stats.topPriorityLabel ??
              (stats.topPriorityStage
                ? `${GROUP_LABEL[stats.topPriorityStage as InboxCardGroup] ?? stats.topPriorityStage} stage needs attention.`
                : 'Highest-severity open action on this project.')}
          </HelpBanner>
          <ActionPillRow>
            <ActionPill to={stats.topPriorityTo!} tone="brand">
              {actions.takeAction ?? 'Take action'} →
            </ActionPill>
            <ActionPill tone="neutral" onClick={() => onTab('actions')}>
              {actions.queue ?? 'View full queue'}
            </ActionPill>
          </ActionPillRow>
        </>
      ) : null}

      {mode === 'clear' ? (
        <>
          <EmptySectionMessage
            text="Inbox zero"
            hint={
              stats.topPriorityLabel ??
              `All ${stats.totalSurfaces} PDCA stages clear — new bugs and failed fixes will appear here automatically.`
            }
          />
          {clearCards.length > 0 ? (
            <section aria-label="Cleared stages">
              <ul className="flex flex-wrap gap-1.5">
                {clearCards.map((card) => (
                  <li key={card.id}>
                    <ClearChip card={card} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <ActionPillRow>
            <ActionPill tone="neutral" onClick={() => onTab('activity')}>
              View activity
            </ActionPill>
            <ActionPill
              to={stats.nextStepTo ?? '/onboarding?tab=verify'}
              tone="brand"
            >
              Send test report →
            </ActionPill>
          </ActionPillRow>
        </>
      ) : null}
    </div>
  )
}
