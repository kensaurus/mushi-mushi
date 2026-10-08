/**
 * FILE: apps/admin/src/components/inbox/InboxOverviewBody.tsx
 * PURPOSE: Overview tab — the ordered action list itself, or setup / inbox-zero
 *          when there is nothing to act on.
 */

import type { InboxCard, InboxCardGroup } from '../../lib/actionInboxFromDashboard'
import type { InboxStats, InboxTabId } from './types'
import { ClearChip, OpenInboxCard } from './inbox-card-parts'
import { EmptySectionMessage } from '../report-detail/ReportClassification'
import { ActionPill, ActionPillRow } from '../report-detail/ReportSurface'
import { scopedHref } from '../../lib/humanPageHints'

export type InboxOverviewMode = 'setup' | 'actions' | 'clear'

export function resolveInboxOverviewMode(stats: InboxStats, openCardCount: number): InboxOverviewMode {
  if (!stats.setupDone || stats.topPriority === 'setup') return 'setup'
  if (openCardCount > 0) return 'actions'
  return 'clear'
}

interface Props {
  stats: InboxStats
  openCards: InboxCard[]
  clearCards: InboxCard[]
  onTab: (tab: InboxTabId) => void
  copy?: {
    actionLabels?: {
      setup?: string
    }
  }
  activityAtByGroup: Partial<Record<InboxCardGroup, string>>
}

export function InboxOverviewBody({
  stats,
  openCards,
  clearCards,
  onTab,
  copy,
  activityAtByGroup,
}: Props) {
  const mode = resolveInboxOverviewMode(stats, openCards.length)
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

      {mode === 'actions' ? (
        <section aria-labelledby="inbox-open">
          <header className="mb-2 flex items-center gap-2">
            <h2 id="inbox-open" className="text-sm font-semibold text-fg">
              Awaiting action
            </h2>
            {openCards.length > 1 ? (
              <span className="ml-auto text-2xs text-fg-muted">Work top to bottom</span>
            ) : null}
          </header>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {openCards.map((card, index) => (
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

      {mode === 'clear' ? (
        <>
          <EmptySectionMessage
            // The banner counts from /inbox/stats and the list from the
            // dashboard payload; while they disagree, don't claim inbox zero.
            text={stats.openActions > 0 ? 'Nothing to list yet' : 'Inbox zero'}
            hint={
              stats.openActions > 0
                ? 'The status above still counts open work; the list catches up on the next refresh.'
                : stats.topPriorityLabel ??
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
            {/* The label promises a test report, so go where one is sent.
                In this state the server's nextStepTo is the inbox itself. */}
            <ActionPill to={scopedHref('/onboarding?tab=verify', stats.projectId)} tone="brand">
              Send test report →
            </ActionPill>
          </ActionPillRow>
        </>
      ) : null}
    </div>
  )
}
