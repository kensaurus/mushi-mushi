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
  ContainedBlock,
  MetaChip,
  SignalChip,
} from '../report-detail/ReportSurface'
import { AgeChip } from '../ui'
import { CHIP_TONE } from '../../lib/chipTone'

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

export const GROUP_TONE: Record<InboxCardGroup, { chipClass: string; ring: string }> = {
  plan: { chipClass: CHIP_TONE.infoSubtle, ring: 'border-info/30' },
  do: { chipClass: CHIP_TONE.brandSubtle, ring: 'border-brand/30' },
  check: { chipClass: CHIP_TONE.warnSubtle, ring: 'border-warn/30' },
  act: { chipClass: CHIP_TONE.okSubtle, ring: 'border-ok/30' },
  ops: { chipClass: CHIP_TONE.neutral, ring: 'border-edge' },
}

export const TONE_RING: Record<PageAction['tone'], string> = {
  plan: 'border-info/40 bg-info-muted',
  do: 'border-brand/40 bg-brand-subtle',
  check: 'border-info/40 bg-info-muted',
  act: 'border-ok/40 bg-ok-muted',
  idle: 'border-edge bg-surface-overlay',
}

export function ClearChip({ card }: { card: InboxCard }) {
  const groupTone = GROUP_TONE[card.group]
  return (
    <Link
      data-inbox-card={card.id}
      data-inbox-state="clear"
      to={card.pageTo}
      className="group inline-flex items-center gap-1.5 rounded-sm border border-edge-subtle bg-surface-overlay px-2 py-1 text-2xs font-medium text-fg-muted hover:border-ok/30 hover:bg-ok-muted hover:text-fg motion-safe:transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      title={`${card.pageLabel} — all clear. Click to open.`}
    >
      <SignalChip tone="ok">✓</SignalChip>
      <span
        className={`rounded-sm px-1 py-0.5 text-3xs font-semibold uppercase tracking-wider ${groupTone.chipClass}`}
      >
        {GROUP_LABEL[card.group]}
      </span>
      <span className="text-fg-secondary group-hover:text-fg">{card.pageLabel}</span>
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
  if (!action) return null
  const groupTone = GROUP_TONE[card.group]
  return (
    <article
      data-inbox-card={card.id}
      data-inbox-state="open"
      className={`rounded-lg border p-4 ${TONE_RING[action.tone]}${isFirst ? ' md:col-span-2' : ''}`}
    >
      <header className="mb-2 flex flex-wrap items-center gap-1.5">
        <SignalChip tone="neutral">#{priority}</SignalChip>
        <span
          className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wider ${groupTone.chipClass}`}
        >
          {GROUP_LABEL[card.group]}
        </span>
        <MetaChip label="Page">{card.pageLabel}</MetaChip>
        {isFirst && !activityAt ? <SignalChip tone="brand">Start here ↑</SignalChip> : null}
        {activityAt ? <AgeChip at={activityAt} title="Last activity in this stage" /> : null}
      </header>
      <ContainedBlock tone="info" label="Action">
        <p className="text-sm font-medium leading-snug text-fg">{action.title}</p>
      </ContainedBlock>
      {action.reason ? (
        <ContainedBlock tone="muted" className="mt-2">
          <p className="text-xs leading-snug text-fg-muted">{action.reason}</p>
        </ContainedBlock>
      ) : null}
      <ActionPillRow className="mt-3">
        {action.primary && action.primary.kind === 'link' ? (
          <ActionPill to={action.primary.to} tone="brand" className="px-3 py-1.5 text-xs">
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
            <ActionPill key={i} to={s.to} tone="neutral">
              {s.label}
            </ActionPill>
          ) : null,
        )}
      </ActionPillRow>
    </article>
  )
}
