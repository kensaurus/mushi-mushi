/**
 * FILE: apps/admin/src/components/inbox/inbox-card-parts.tsx
 * PURPOSE: Shared inbox card row primitives — open action cards and cleared stage chips.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import type { PageAction } from '../PageActionBar'
import type { InboxCard, InboxCardGroup } from '../../lib/actionInboxFromDashboard'
import {
  ActionPill,
  ActionPillRow,
  MetaChip,
  SignalChip,
} from '../report-detail/ReportSurface'
import { AgeChip } from '../ui'
import { CHIP_TONE } from '../../lib/chipTone'
import { scopedHref } from '../../lib/humanPageHints'
import { useActiveProjectId } from '../ProjectSwitcher'

/** In-app links carry the active project, so they open on the right one. */
function useProjectHref(): (to: string) => string {
  const projectId = useActiveProjectId()
  return (to) => (to.startsWith('/') ? scopedHref(to, projectId) : to)
}

export const GROUP_LABEL: Record<InboxCardGroup, string> = {
  plan: 'Plan',
  do: 'Do',
  check: 'Check',
  act: 'Act',
  ops: 'Ops',
}

export const GROUP_LONG_LABEL: Record<InboxCardGroup, string> = {
  plan: 'Plan — classify + triage',
  do: 'Do — dispatch + land fixes',
  check: 'Check — verify quality',
  act: 'Act — connections + config',
  ops: 'Ops — health + compliance',
}

// A stage is a name, not a state: neutral ink. "Check" was amber and "Act" green, which read as
// a warning and a pass (round-2 review, 2026-11-18).
const GROUP_TONE: Record<InboxCardGroup, { chipClass: string }> = {
  plan: { chipClass: CHIP_TONE.neutral },
  do: { chipClass: CHIP_TONE.neutral },
  check: { chipClass: CHIP_TONE.neutral },
  act: { chipClass: CHIP_TONE.neutral },
  ops: { chipClass: CHIP_TONE.neutral },
}

/** One bordered card per action: the tone shows only on the left edge. */
const TONE_EDGE: Record<PageAction['tone'], string> = {
  plan: 'border-l-info',
  do: 'border-l-brand',
  check: 'border-l-info',
  act: 'border-l-ok',
  idle: 'border-l-edge',
}

/** A card with no open action: ✓ only when it was checked and passed (round-2 review, 2026-11-18). */
const IDLE_MARK: Record<'pass' | 'none' | 'unknown', { mark: string; word: string | null; title: string; extra: string }> = {
  pass: { mark: '✓', word: null, title: 'checked: all clear', extra: '' },
  none: { mark: '○', word: 'nothing yet', title: 'nothing to check yet', extra: '' },
  unknown: { mark: '?', word: 'not checked', title: 'not checked: the read failed or is still loading', extra: ' ci-nodata' },
}

export function ClearChip({ card }: { card: InboxCard }) {
  const groupTone = GROUP_TONE[card.group]
  const href = useProjectHref()
  const idle = IDLE_MARK[card.state === 'open' ? 'pass' : card.state]
  return (
    <Link
      data-inbox-card={card.id}
      data-inbox-state={card.state === 'pass' ? 'clear' : card.state}
      to={href(card.pageTo)}
      className={`group inline-flex items-center gap-1.5 rounded-sm border border-edge-subtle bg-surface-overlay px-2 py-1 text-2xs font-medium whitespace-nowrap text-fg-muted hover:bg-surface-raised hover:text-fg motion-safe:transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50${idle.extra}`}
      title={`${card.pageLabel} — ${idle.title}. Click to open.`}
    >
      {card.state === 'pass' ? <SignalChip tone="ok">{idle.mark}</SignalChip> : <span aria-hidden="true" className="px-1 text-fg-faint">{idle.mark}</span>}
      <span
        className={`rounded-sm px-1 py-0.5 text-3xs font-semibold ${groupTone.chipClass}`}
      >
        {GROUP_LABEL[card.group]}
      </span>
      <span className="text-fg-secondary group-hover:text-fg">{card.pageLabel}</span>
      {idle.word && <span className="text-fg-faint">{idle.word}</span>}
    </Link>
  )
}

export function OpenInboxCard({
  card,
  priority,
  isFirst,
  activityAt,
}: {
  card: InboxCard
  priority: number
  isFirst?: boolean
  activityAt?: string
}) {
  const action = card.action
  const href = useProjectHref()
  if (!action) return null
  return (
    <article
      data-inbox-card={card.id}
      data-inbox-state="open"
      data-inbox-priority={priority}
      data-inbox-group={card.group}
      // mushi-mushi-allowlist: tone-edged action card (border-l-4 per tone); Card has no edge tone
      className={`rounded-lg border border-edge border-l-4 bg-surface-raised p-4 ${TONE_EDGE[action.tone]}${isFirst ? ' md:col-span-2' : ''}`}
    >
      {/* No "#1" or "Plan" chips: the order is the list's own, and the stage named nothing a
          person acts on (round-2 review, 2026-11-18). */}
      <header className="mb-2 flex flex-wrap items-center gap-1.5">
        <MetaChip label="Page">{card.pageLabel}</MetaChip>
        {activityAt ? <AgeChip at={activityAt} title="Last activity in this stage" /> : null}
      </header>
      <p className="text-sm font-medium leading-snug text-fg">{action.title}</p>
      {action.reason ? <p className="mt-1 text-xs leading-snug text-fg-muted">{action.reason}</p> : null}
      <ActionPillRow className="mt-3">
        {action.primary && action.primary.kind === 'link' ? (
          <ActionPill to={href(action.primary.to)} tone="brand" className="px-3 py-1.5 text-xs">
            {action.primary.label} →
          </ActionPill>
        ) : null}
        {action.primary && action.primary.kind === 'button' ? (
          <Btn size="sm" variant="primary" onClick={action.primary.onClick} data-inbox-primary>
            {action.primary.label}
          </Btn>
        ) : null}
        {action.secondary?.slice(0, 1).map((s, i) =>
          s.kind === 'link' ? (
            <ActionPill key={i} to={href(s.to)} tone="neutral">
              {s.label}
            </ActionPill>
          ) : null,
        )}
      </ActionPillRow>
    </article>
  )
}
