/**
 * FILE: apps/admin/src/components/ops/OpsFeed.tsx
 * PURPOSE: The Ops feed: one row per event, newest first, replies nested
 *          under the event that opened their thread (a failed deploy, then
 *          the next good one). Each row: app icon and name, emoji and
 *          title, body, facts, time, severity as a glyph and a word, the
 *          Slack state (✓ posted / ✕ with the error on hover / – stored
 *          only) and Acknowledge for anything still open.
 */

import type { OpsApp, OpsEvent } from '../../lib/opsTypes'
import { Btn } from '../ui'
import { CHIP_TONE } from '../../lib/chipTone'
import { SEVERITY_META, agoText, eventEmoji, formatMoney, isRefund, needsAck, nestThreads, opsAppName, slackState } from '../../lib/opsView'
import { OpsAppIcon } from './OpsCoverage'

interface FeedProps {
  events: OpsEvent[]
  apps: OpsApp[]
  now: number
  canAck: boolean
  acking: ReadonlySet<string>
  onAck: (id: string) => void
  /** Highlight one event (?event= from a Slack link). */
  focusId?: string | null
}

function EventRow({ e, app, now, canAck, acking, onAck, reply, focused }: { e: OpsEvent; app: OpsApp | undefined; now: number; canAck: boolean; acking: boolean; onAck: (id: string) => void; reply?: boolean; focused?: boolean }) {
  const sev = SEVERITY_META[e.severity]
  const slack = slackState(e)
  const amount = e.amount_minor != null && e.currency ? `${isRefund(e.kind) ? '−' : ''}${formatMoney(Math.abs(e.amount_minor), e.currency)}` : null
  return (
    <div
      className={`flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 ${reply ? 'border-l-2 border-edge-subtle pl-4' : ''} ${focused ? 'outline-2 outline-accent -outline-offset-2' : ''}`}
      data-testid={`ops-event-${e.id}`}
    >
      <span className="flex w-28 shrink-0 items-center gap-1.5 text-xs font-semibold text-fg" title={opsAppName(app)}>
        <OpsAppIcon app={app} />
        <span className="truncate">{e.project_id ? opsAppName(app) : 'team'}</span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-fg">
          <span aria-hidden="true">{eventEmoji(e)}</span> {e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">{e.title}</a> : e.title}
        </p>
        {e.body && <p className="max-w-prose text-xs text-fg-secondary">{e.body}</p>}
        {(amount || e.facts.length > 0) && (
          <p className="text-2xs text-fg-secondary">
            {[amount ? `Amount: ${amount}` : null, ...e.facts.map((f) => `${f.label}: ${f.value}`)].filter(Boolean).join('  ·  ')}
          </p>
        )}
      </div>
      <span className="flex shrink-0 flex-wrap items-center gap-1.5">
        <span className={`inline-flex items-center gap-1 rounded-xs px-1 py-px text-2xs font-semibold ${CHIP_TONE[sev.tone]}`}>
          <span aria-hidden="true">{sev.glyph}</span> {sev.label}
        </span>
        <span className={`inline-flex items-center gap-1 rounded-xs px-1 py-px text-2xs font-semibold ${CHIP_TONE[slack.tone === 'ok' ? 'ok' : slack.tone === 'danger' ? 'danger' : 'neutral']}`} title={slack.detail ?? undefined} data-testid={`ops-slack-${e.id}`}>
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

export function OpsFeed({ events, apps, now, canAck, acking, onAck, focusId }: FeedProps) {
  const byId = new Map(apps.map((a) => [a.id, a]))
  const threads = nestThreads(events)
  return (
    <ol className="divide-y divide-edge-subtle rounded-md border border-edge-subtle bg-surface-raised" data-testid="ops-feed">
      {threads.map(({ event, replies }) => (
        <li key={event.id} className="ci-rise">
          <EventRow e={event} app={byId.get(event.project_id ?? '')} now={now} canAck={canAck} acking={acking.has(event.id)} onAck={onAck} focused={focusId === event.id} />
          {replies.length > 0 && (
            <ol className="ml-8 pb-1" aria-label={`Replies to ${event.title}`}>
              {replies.map((r) => (
                <li key={r.id}>
                  <EventRow e={r} app={byId.get(r.project_id ?? '')} now={now} canAck={canAck} acking={acking.has(r.id)} onAck={onAck} reply focused={focusId === r.id} />
                </li>
              ))}
            </ol>
          )}
        </li>
      ))}
    </ol>
  )
}
