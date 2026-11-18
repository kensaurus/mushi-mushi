/**
 * FILE: apps/admin/src/components/ops/OpsFeed.tsx
 * PURPOSE: The Ops feed. Unacknowledged urgent and warning rows are pinned on top (worst
 *          first); below them, newest first, info rows from one app and kind collapse into one
 *          group with a bulk Acknowledge, and the same event sent twice shows once. Replies nest
 *          under the event that opened their thread (a failed deploy, then
 *          the next good one). Each row: app icon and name, emoji and
 *          title, body, facts, time, severity as a glyph and a word, the
 *          Slack state (✓ posted / ✕ with the error on hover / – stored
 *          only) and Acknowledge for anything still open.
 */

import { useState } from 'react'
import type { OpsApp, OpsEvent } from '../../lib/opsTypes'
import { Btn } from '../ui'
import { CHIP_TONE } from '../../lib/chipTone'
import {
  SEVERITY_META,
  agoText,
  arrangeFeed,
  categoryCount,
  eventEmoji,
  formatMoney,
  isRefund,
  needsAck,
  opsAppName,
  slackState,
  unackedIds,
  type FeedGroupItem,
  type FeedThreadItem,
} from '../../lib/opsView'
import { OpsAppIcon } from './OpsCoverage'

interface FeedProps {
  events: OpsEvent[]
  apps: OpsApp[]
  now: number
  canAck: boolean
  acking: ReadonlySet<string>
  onAck: (id: string) => void
  /** Acknowledge several at once (a folded duplicate, or a group's bulk button). */
  onAckMany: (ids: string[]) => void
  /** Highlight one event (?event= from a Slack link). */
  focusId?: string | null
}

function EventRow({
  e,
  app,
  now,
  canAck,
  acking,
  onAck,
  reply,
  focused,
  copies = 1,
  inGroup = false,
}: {
  e: OpsEvent
  app: OpsApp | undefined
  now: number
  canAck: boolean
  acking: boolean
  onAck: (id: string) => void
  reply?: boolean
  focused?: boolean
  /** The same event arrived this many times; shown once with xn. */
  copies?: number
  /** Inside an app's info group: the group already names the app and the severity. */
  inGroup?: boolean
}) {
  const sev = SEVERITY_META[e.severity]
  const slack = slackState(e)
  const amount = e.amount_minor != null && e.currency ? `${isRefund(e.kind) ? '−' : ''}${formatMoney(Math.abs(e.amount_minor), e.currency)}` : null
  return (
    <div
      className={`flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 ${reply ? 'border-l-2 border-edge-subtle pl-4' : ''} ${focused ? 'outline-2 outline-accent -outline-offset-2' : ''}`}
      data-testid={`ops-event-${e.id}`}
    >
      {!inGroup && (
        <span className="flex w-full shrink-0 items-center gap-1.5 text-xs font-semibold text-fg sm:w-28" title={opsAppName(app)}>
          <OpsAppIcon app={app} />
          <span className="truncate">{e.project_id ? opsAppName(app) : 'team'}</span>
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-fg">
          <span aria-hidden="true">{eventEmoji(e)}</span> {e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">{e.title}</a> : e.title}
          {copies > 1 && (
            <span className="ml-1 font-mono text-2xs font-semibold text-fg-secondary" title={`Sent ${copies} times`} data-testid={`ops-copies-${e.id}`}>
              ×{copies}
            </span>
          )}
        </p>
        {e.body && <p className="line-clamp-2 max-w-prose text-xs text-fg-secondary sm:line-clamp-none">{e.body}</p>}
        {(amount || e.facts.length > 0) && (
          <p className="line-clamp-1 text-2xs text-fg-secondary sm:line-clamp-none">
            {[amount ? `Amount: ${amount}` : null, ...e.facts.map((f) => `${f.label}: ${f.value}`)].filter(Boolean).join('  ·  ')}
          </p>
        )}
      </div>
      <span className="flex shrink-0 flex-wrap items-center gap-1.5">
        {!inGroup && (
          <span className={`inline-flex items-center gap-1 rounded-xs px-1 py-px text-2xs font-semibold whitespace-nowrap ${CHIP_TONE[sev.tone]}`}>
            <span aria-hidden="true">{sev.glyph}</span> {sev.label}
          </span>
        )}
        <span className={`inline-flex items-center gap-1 rounded-xs px-1 py-px text-2xs font-semibold whitespace-nowrap ${CHIP_TONE[slack.tone === 'ok' ? 'ok' : slack.tone === 'danger' ? 'danger' : 'neutral']}`} title={slack.detail ?? undefined} data-testid={`ops-slack-${e.id}`}>
          <span aria-hidden="true">{slack.glyph}</span> {slack.label}
        </span>
        <time dateTime={e.occurred_at} title={new Date(e.occurred_at).toLocaleString()} className="font-mono text-2xs text-fg-secondary tabular-nums">
          {agoText(e.occurred_at, now)}
        </time>
        {e.acked_at ? (
          <span className="text-2xs font-semibold text-ok-foreground" title={`Acknowledged ${new Date(e.acked_at).toLocaleString()}`}>
            ✓ Seen
          </span>
        ) : (
          canAck &&
          needsAck(e) && (
            <Btn size="sm" variant="ghost" loading={acking} onClick={() => onAck(e.id)} aria-label={`Acknowledge: ${e.title}`} title="Mark as seen here and in Slack">
              Acknowledge
            </Btn>
          )
        )}
      </span>
    </div>
  )
}

type RowCtx = Omit<FeedProps, 'events' | 'apps'> & { byId: Map<string, OpsApp> }

function ThreadItem({ item, ctx, inGroup = false }: { item: FeedThreadItem; ctx: RowCtx; inGroup?: boolean }) {
  const { event, replies } = item.thread
  const { byId, now, canAck, acking, onAck, onAckMany, focusId } = ctx
  // A folded duplicate acknowledges every copy, so none of them comes back as open.
  const ackThis = item.ids.length > 1 ? () => onAckMany(item.ids) : onAck
  return (
    <>
      <EventRow e={event} app={byId.get(event.project_id ?? '')} now={now} canAck={canAck} acking={acking.has(event.id)} onAck={ackThis} focused={focusId === event.id} copies={item.ids.length} inGroup={inGroup} />
      {replies.length > 0 && (
        <ol className="ml-8 pb-1" aria-label={`Replies to ${event.title}`}>
          {replies.map((r) => (
            <li key={r.id}>
              <EventRow e={r} app={byId.get(r.project_id ?? '')} now={now} canAck={canAck} acking={acking.has(r.id)} onAck={onAck} reply focused={focusId === r.id} />
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

function GroupItem({ group, events, ctx }: { group: FeedGroupItem; events: OpsEvent[]; ctx: RowCtx }) {
  const focused = group.items.some((i) => i.ids.includes(ctx.focusId ?? ''))
  const [open, setOpen] = useState(focused)
  const app = ctx.byId.get(group.projectId ?? '')
  const newest = group.items[0].thread.event
  const openIds = unackedIds(group.items, events)
  const busy = openIds.some((id) => ctx.acking.has(id))
  const count = group.items.reduce((n, i) => n + i.ids.length, 0)
  const label = `${group.projectId ? opsAppName(app) : 'team'} · ${categoryCount(group.category, count)}`
  return (
    <div data-testid={`ops-group-${group.key}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-semibold text-fg"
          data-testid={`ops-group-toggle-${group.key}`}
        >
          <span aria-hidden="true" className="w-3 text-fg-secondary">
            {open ? '▾' : '▸'}
          </span>
          <OpsAppIcon app={app} />
          <span className="truncate">{label}</span>
        </button>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-xs px-1 py-px text-2xs font-semibold whitespace-nowrap ${CHIP_TONE[SEVERITY_META.info.tone]}`}>
            <span aria-hidden="true">{SEVERITY_META.info.glyph}</span> {SEVERITY_META.info.label}
          </span>
          <time dateTime={newest.occurred_at} title={new Date(newest.occurred_at).toLocaleString()} className="font-mono text-2xs text-fg-secondary tabular-nums">
            {agoText(newest.occurred_at, ctx.now)}
          </time>
          {ctx.canAck && openIds.length > 0 && (
            <Btn size="sm" variant="ghost" className="whitespace-nowrap" loading={busy} onClick={() => ctx.onAckMany(openIds)} aria-label={`Acknowledge all: ${label}`} title="Mark every row in this group as seen here and in Slack">
              Acknowledge all
            </Btn>
          )}
        </span>
      </div>
      {open && (
        <ol className="ml-8 divide-y divide-edge-subtle border-l-2 border-edge-subtle pb-1" aria-label={label}>
          {group.items.map((item) => (
            <li key={item.thread.event.id}>
              <ThreadItem item={item} ctx={ctx} inGroup />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export function OpsFeed({ events, apps, ...rest }: FeedProps) {
  const ctx: RowCtx = { ...rest, byId: new Map(apps.map((a) => [a.id, a])) }
  const { pinned, items } = arrangeFeed(events)
  return (
    <div className="space-y-2">
      {pinned.length > 0 && (
        <section aria-label="Needs a look" id="ops-needs-look" data-testid="ops-needs-look">
          <h3 className="mb-1 text-2xs font-bold tracking-wider text-danger-foreground uppercase">Needs a look</h3>
          <ol className="divide-y divide-edge-subtle rounded-md border border-danger/40 bg-surface-raised">
            {pinned.map((item) => (
              <li key={item.thread.event.id} className="ci-rise">
                <ThreadItem item={item} ctx={ctx} />
              </li>
            ))}
          </ol>
        </section>
      )}
      {items.length > 0 && (
        <ol className="divide-y divide-edge-subtle rounded-md border border-edge-subtle bg-surface-raised" data-testid="ops-feed">
          {items.map((item) => (
            <li key={item.kind === 'group' ? `g:${item.key}` : item.thread.event.id} className="ci-rise">
              {item.kind === 'group' ? <GroupItem group={item} events={events} ctx={ctx} /> : <ThreadItem item={item} ctx={ctx} />}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
