/**
 * FILE: apps/admin/src/components/feedback/FeedbackStatusBanner.tsx
 * PURPOSE: My feedback posture — replies waiting, active tickets, shipped, empty.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import type { FeedbackStats, FeedbackTabId } from './types'

interface Props {
  stats: FeedbackStats
  onTab?: (tab: FeedbackTabId) => void
  onSubmitBug?: () => void
  onSubmitFeature?: () => void
  onRefresh?: () => void
  refreshing?: boolean
}

export function FeedbackStatusBanner({
  stats,
  onTab,
  onSubmitBug,
  onSubmitFeature,
  onRefresh,
  refreshing,
}: Props) {
  if (!stats.hasAnyProject) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">Create a project before submitting feedback</p>
            <p className="text-2xs text-fg-muted">
              Tickets attach to a project so we know which app your bug or feature idea belongs to.
            </p>
          </div>
        </div>
        <Link to="/onboarding">
          <Btn size="sm" variant="ghost">Go to Setup</Btn>
        </Link>
      </div>
    )
  }

  if (stats.topPriority === 'first_submit') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">No submissions yet on {stats.projectName ?? 'your project'}</p>
            <p className="text-2xs text-fg-muted">
              Report a console bug or request a feature — we read every ticket and link shipped ideas to release versions.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {onSubmitBug ? (
            <Btn size="sm" variant="ghost" onClick={onSubmitBug}>
              Report a bug
            </Btn>
          ) : null}
          {onSubmitFeature ? (
            <Btn size="sm" variant="ghost" onClick={onSubmitFeature}>
              Request feature
            </Btn>
          ) : null}
        </div>
      </div>
    )
  }

  if (stats.topPriority === 'reply' && stats.awaitingReply > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand motion-safe:animate-pulse" aria-hidden />
          <div>
            <p className="text-xs font-medium text-brand">
              {stats.awaitingReply} team repl{stats.awaitingReply === 1 ? 'y' : 'ies'} waiting
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel}
              {stats.latestReplyAt ? (
                <> · <RelativeTime value={stats.latestReplyAt} /></>
              ) : null}
            </p>
          </div>
        </div>
        {stats.topTicketId ? (
          <Link to={`/feedback?ticket=${stats.topTicketId}`}>
            <Btn size="sm" variant="ghost">Read reply</Btn>
          </Link>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('active')}>
            View active
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.topPriority === 'active' && stats.activeTickets > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {stats.activeTickets} active submission{stats.activeTickets === 1 ? '' : 's'} in triage
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.topPriorityLabel} — status updates appear here and in email when we respond.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('active')}>
            View active
          </Btn>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">
            {stats.shippedTickets > 0
              ? `${stats.shippedTickets} shipped · inbox clear`
              : 'All submissions resolved'}
          </p>
          <p className="text-2xs text-fg-muted">
            {stats.topPriorityLabel}
            {stats.lastShippedAt ? (
              <> · last ship <RelativeTime value={stats.lastShippedAt} /></>
            ) : stats.lastSubmittedAt ? (
              <> · last submit <RelativeTime value={stats.lastSubmittedAt} /></>
            ) : null}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {stats.shippedTickets > 0 && onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('shipped')}>
            View shipped
          </Btn>
        ) : null}
        {onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            Refresh
          </Btn>
        ) : null}
      </div>
    </div>
  )
}
