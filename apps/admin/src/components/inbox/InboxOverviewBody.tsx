/**
 * FILE: apps/admin/src/components/inbox/InboxOverviewBody.tsx
 * PURPOSE: Overview tab — the ordered action list itself, or setup / inbox-zero
 *          when there is nothing to act on. Up to five decisions are ranked
 *          as cards; chores (re-grading recent fixes) sit in a footer, not
 *          ranked beside a decision (console journeys 2026-10-27: "#2 Re-check
 *          the quality of recent auto-fixes" read as a decision).
 */

import type { InboxCard, InboxCardGroup } from '../../lib/actionInboxFromDashboard'
import type { InboxStats, InboxTabId } from './types'
import { ClearChip, OpenInboxCard } from './inbox-card-parts'
import { EmptySectionMessage } from '../report-detail/ReportClassification'
import { ActionPill, ActionPillRow } from '../report-detail/ReportSurface'
import { scopedHref } from '../../lib/humanPageHints'
import { Link } from 'react-router-dom'

export type InboxOverviewMode = 'setup' | 'actions' | 'clear'

/** Cards that keep things tidy rather than decide anything. */
const CHORE_SCOPES: ReadonlySet<string> = new Set(['judge'])
/** Ranked decision cards shown; the rest wait for these. */
export const MAX_DECISIONS = 5

/** @internal Exported for tests only. Decisions in order (at most five) and the chores. */
export function splitInboxCards(cards: InboxCard[]): { decisions: InboxCard[]; more: number; chores: InboxCard[] } {
  const decisions = cards.filter((c) => !CHORE_SCOPES.has(c.scope))
  return { decisions: decisions.slice(0, MAX_DECISIONS), more: Math.max(0, decisions.length - MAX_DECISIONS), chores: cards.filter((c) => CHORE_SCOPES.has(c.scope)) }
}

/** @internal Exported for tests only. */
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
  const { decisions, more, chores } = splitInboxCards(openCards)

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
              {decisions.length > 0 ? 'Awaiting action' : 'Only housekeeping left'}
            </h2>
            {decisions.length > 1 ? (
              <span className="ml-auto text-2xs text-fg-muted">Work top to bottom</span>
            ) : null}
          </header>
          {decisions.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="inbox-decisions">
              {decisions.map((card, index) => (
                <OpenInboxCard
                  key={card.id}
                  card={card}
                  priority={index + 1}
                  isFirst={index === 0}
                  activityAt={activityAtByGroup[card.group]}
                />
              ))}
            </div>
          ) : null}
          {more > 0 ? (
            <p className="mt-2 text-2xs text-fg-muted">{more} more after these; they show here as you clear the top ones.</p>
          ) : null}
          {chores.length > 0 ? (
            <footer className="mt-3 border-t border-edge-subtle pt-2" data-testid="inbox-chores">
              <h3 className="text-2xs font-semibold text-fg-secondary">Housekeeping</h3>
              <ul className="mt-1 space-y-1">
                {chores.map((card) => (
                  <li key={card.id} className="flex flex-wrap items-baseline gap-x-2 text-2xs text-fg-muted">
                    <span>{card.action?.title ?? card.pageLabel}</span>
                    {card.action?.primary && card.action.primary.kind === 'link' ? (
                      <Link to={card.action.primary.to} className="font-medium text-brand hover:underline">
                        {card.action.primary.label} →
                      </Link>
                    ) : (
                      <Link to={card.pageTo} className="font-medium text-brand hover:underline">
                        Open {card.pageLabel} →
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </footer>
          ) : null}
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
