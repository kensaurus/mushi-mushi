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
import { CHIP_TONE, LINK_ACCENT } from '../../lib/chipTone'
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
  slackChipShown,
  slackState,
  splitBodyCta,
  unackedIds,
  type FeedGroupItem,
  type FeedThreadItem,
  type NeedsLookView,
} from '../../lib/opsView'
import { StatusGlyph } from '../signal/StatusGlyph'
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
  /** The team's Slack bot is on: "stored only" is then worth a chip on the row. */
  slackEnabled: boolean
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
  slackEnabled,
  severityHeaded = false,
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
  slackEnabled: boolean
  /** The row sits under a heading that already names its severity ("2 failures"). */
  severityHeaded?: boolean
}) {
  const sev = SEVERITY_META[e.severity]
  const slack = slackState(e)
  const rawBody = splitBodyCta(e.body, e.url)
  // A bare "in /" (the error's location when it is the site root) says nothing (round 3).
  const body = /^\s*in\s*\/?\s*$/i.test(rawBody.text ?? '') ? { ...rawBody, text: '' } : rawBody
  // Under a "1 warning" heading a "Level: error" fact classified the row a second, different way
  // (round 3): the heading's severity is the one shown; the source's level stays on hover.
  const levelFact = e.facts.find((f) => /^level$/i.test(f.label))
  const facts = [amountFact(e), ...e.facts.filter((f) => !(severityHeaded && f === levelFact)).map((f) => `${f.label}: ${f.value}`)].filter(
    (f): f is string => Boolean(f),
  )
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
      {/* Phone: the title takes the full row and the chips wrap under it (never one word per line). */}
      <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
        <p className="text-sm font-bold text-pretty break-words text-fg" title={severityHeaded && levelFact ? `${levelFact.label}: ${levelFact.value}` : undefined}>
          {/* Under a severity heading the heading's mark is the one mark: no second red/amber emoji (round 3). */}
          {!severityHeaded && <span aria-hidden="true">{eventEmoji(e)} </span>}
          {e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">{e.title}</a> : e.title}
          {copies > 1 && (
            <span className="ml-1 text-2xs font-semibold text-fg-secondary tabular-nums" title={`Sent ${copies} times`} data-testid={`ops-copies-${e.id}`}>
              ×{copies}
            </span>
          )}
        </p>
        {(body.text || body.cta) && (
          <p className="max-w-prose text-xs break-words text-fg-secondary">
            {body.text}
            {body.cta && e.url && (
              <>
                {body.text ? ' ' : ''}
                <a href={e.url} target="_blank" rel="noopener noreferrer" className={`font-semibold ${LINK_ACCENT}`} data-testid={`ops-cta-${e.id}`}>
                  {body.cta} ↗
                </a>
              </>
            )}
          </p>
        )}
        {facts.length > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-fg-secondary" data-testid={`ops-facts-${e.id}`}>
            {facts.map((f) => (
              <li key={f} className="break-words">
                {f}
              </li>
            ))}
          </ul>
        )}
      </div>
      <span className="flex shrink-0 flex-wrap items-center gap-1.5">
        {!inGroup && !severityHeaded && (
          <span className={`inline-flex items-center gap-1 rounded-xs px-1 py-px text-2xs font-semibold whitespace-nowrap ${CHIP_TONE[sev.tone]}`}>
            <span aria-hidden="true">{sev.glyph}</span> {sev.label}
          </span>
        )}
        {slackChipShown(slack, slackEnabled) && (
          <span className={`inline-flex items-center gap-1 rounded-xs px-1 py-px text-2xs font-semibold whitespace-nowrap ${CHIP_TONE[slack.tone === 'danger' ? 'danger' : 'neutral']}`} title={slack.detail ?? undefined} data-testid={`ops-slack-${e.id}`}>
            <span aria-hidden="true">{slack.glyph}</span> {slack.label}
          </span>
        )}
        <time dateTime={e.occurred_at} title={new Date(e.occurred_at).toLocaleString()} className="text-2xs whitespace-nowrap text-fg-secondary tabular-nums">
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

function amountFact(e: OpsEvent): string | null {
  if (e.amount_minor == null || !e.currency) return null
  return `Amount: ${isRefund(e.kind) ? '−' : ''}${formatMoney(Math.abs(e.amount_minor), e.currency)}`
}

type RowCtx = Omit<FeedProps, 'events' | 'apps'> & { byId: Map<string, OpsApp>; severityHeaded?: boolean }

function ThreadItem({ item, ctx, inGroup = false }: { item: FeedThreadItem; ctx: RowCtx; inGroup?: boolean }) {
  const { event, replies } = item.thread
  const { byId, now, canAck, acking, onAck, onAckMany, focusId, slackEnabled } = ctx
  // A folded duplicate acknowledges every copy, so none of them comes back as open.
  const ackThis = item.ids.length > 1 ? () => onAckMany(item.ids) : onAck
  return (
    <>
      <EventRow e={event} app={byId.get(event.project_id ?? '')} now={now} canAck={canAck} acking={acking.has(event.id)} onAck={ackThis} focused={focusId === event.id} copies={item.ids.length} inGroup={inGroup} slackEnabled={slackEnabled} severityHeaded={ctx.severityHeaded} />
      {replies.length > 0 && (
        <ol className="ml-8 pb-1" aria-label={`Replies to ${event.title}`}>
          {replies.map((r) => (
            <li key={r.id}>
              <EventRow e={r} app={byId.get(r.project_id ?? '')} now={now} canAck={canAck} acking={acking.has(r.id)} onAck={onAck} reply focused={focusId === r.id} slackEnabled={slackEnabled} />
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
  const name = group.projectId ? opsAppName(app) : 'team'
  const label = `${name} · ${categoryCount(group.category, count)}`
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
          {/* The name may truncate on a phone; the count never does. */}
          <span className="min-w-0 truncate">{name}</span>{' '}
          <span className="shrink-0 font-normal whitespace-nowrap text-fg-secondary">· {categoryCount(group.category, count)}</span>
        </button>
        <span className="flex shrink-0 items-center gap-1.5">
          <time dateTime={newest.occurred_at} title={new Date(newest.occurred_at).toLocaleString()} className="text-2xs whitespace-nowrap text-fg-secondary tabular-nums">
            {agoText(newest.occurred_at, ctx.now)}
          </time>
          {/* Collapsed rows are all info (the feed heading says so once); the bulk button shows with the rows it acts on. */}
          {open && ctx.canAck && openIds.length > 0 && (
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

export function OpsFeed({ events, apps, pinnedAbove, ...rest }: FeedProps & { pinnedAbove: boolean }) {
  const ctx: RowCtx = { ...rest, byId: new Map(apps.map((a) => [a.id, a])) }
  const { pinned, items } = arrangeFeed(events)
  // Unfiltered, the open rows are already listed under "Needs a look" at the top of the page. Under
  // a filter they stay in this list, first, so the filtered view is complete.
  const rows: Array<FeedThreadItem | FeedGroupItem> = pinnedAbove ? items : [...pinned, ...items]
  if (rows.length === 0) return <p className="px-3 py-2 text-xs text-fg-secondary">Every event on this page is listed under Needs a look, above.</p>
  return (
    <ol className="divide-y divide-edge-subtle rounded-md border border-edge-subtle bg-surface-raised" data-testid="ops-feed">
      {rows.map((item) => (
        <li key={item.kind === 'group' ? `g:${item.key}` : item.thread.event.id} className="ci-rise">
          {item.kind === 'group' ? <GroupItem group={item} events={events} ctx={ctx} /> : <ThreadItem item={item} ctx={ctx} />}
        </li>
      ))}
    </ol>
  )
}

/**
 * The top of /ops: what still needs someone, worst first. Failures (red) and warnings (amber) are
 * separate groups, each headed by its own count; together they are the page's one
 * "needs a look" number (lib/opsView needsLookView).
 */
export function OpsNeedsLook({ view, apps, ...rest }: Omit<FeedProps, 'events'> & { view: NeedsLookView }) {
  const ctx: RowCtx = { ...rest, byId: new Map(apps.map((a) => [a.id, a])), severityHeaded: true }
  if (view.count === 0) return null
  const group = (tone: 'danger' | 'warn', items: FeedThreadItem[], noun: [string, string]) =>
    items.length > 0 && (
      <div data-testid={`ops-needs-look-${tone}`}>
        <h3 className={`mb-1 inline-flex items-center gap-1.5 text-xs font-bold ${tone === 'danger' ? 'text-danger-foreground' : 'text-warn-foreground'}`}>
          <StatusGlyph tone={tone} />
          <span className="tabular-nums" data-testid={`ops-needs-look-${tone}-count`}>{items.length}</span> {noun[items.length === 1 ? 0 : 1]}
        </h3>
        <ol className={`divide-y divide-edge-subtle rounded-md border bg-surface-raised ${tone === 'danger' ? 'border-danger/40' : 'border-warn/40'}`}>
          {items.map((item) => (
            <li key={item.thread.event.id} className="ci-rise">
              <ThreadItem item={item} ctx={ctx} />
            </li>
          ))}
        </ol>
      </div>
    )
  return (
    <section aria-label={`Needs a look: ${view.count}`} id="ops-needs-look" data-testid="ops-needs-look" className="space-y-3">
      {group('danger', view.failures, ['failure', 'failures'])}
      {group('warn', view.warnings, ['warning', 'warnings'])}
    </section>
  )
}
