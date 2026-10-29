/**
 * FILE: apps/admin/src/components/feedback/FeedbackStatusBanner.tsx
 * PURPOSE: My feedback posture — replies waiting, active tickets, shipped, empty.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import { StatusBannerShell } from '../StatusBannerShell'
import type { FeedbackStats, FeedbackTabId } from './types'

interface Props {
  stats: FeedbackStats
  onTab?: (tab: FeedbackTabId) => void
  onRefresh?: () => void
  refreshing?: boolean
}

export function FeedbackStatusBanner({
  stats,
  onTab,
  onRefresh,
  refreshing,
}: Props) {
  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title="Create a project before submitting feedback"
        subtitle="Tickets attach to a project so we know which app your bug or feature idea belongs to."
        action={
          <Btn to="/onboarding" size="sm" variant="ghost">Go to Setup</Btn>
        }
      />
    )
  }

  // Nothing sent yet is not a problem: the status line under the header says
  // so once. This banner said it again, in the red brand tone (2026-10-28).
  if (stats.topPriority === 'first_submit') return null

  if (stats.topPriority === 'reply' && stats.awaitingReply > 0) {
    return (
      <StatusBannerShell
        tone="brand"
        pulseDot
        title={`${stats.awaitingReply} team repl${stats.awaitingReply === 1 ? 'y' : 'ies'} waiting`}
        subtitle={
          <>
            {stats.topPriorityLabel}
            {stats.latestReplyAt ? (
              <> · <RelativeTime value={stats.latestReplyAt} /></>
            ) : null}
          </>
        }
        action={
          stats.topTicketId ? (
            <Link to={`/feedback?ticket=${stats.topTicketId}`}>
              <Btn size="sm" variant="ghost">Read reply</Btn>
            </Link>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('active')}>
              View active
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.topPriority === 'active' && stats.activeTickets > 0) {
    return (
      <StatusBannerShell
        tone="warn"
        title={`${stats.activeTickets} active submission${stats.activeTickets === 1 ? '' : 's'} in triage`}
        subtitle={`${stats.topPriorityLabel} — status updates appear here and in email when we respond.`}
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('active')}>
              View active
            </Btn>
          ) : null
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={
        stats.shippedTickets > 0
          ? `${stats.shippedTickets} shipped · inbox clear`
          : 'All submissions resolved'
      }
      subtitle={
        <>
          {stats.topPriorityLabel}
          {stats.lastShippedAt ? (
            <> · last ship <RelativeTime value={stats.lastShippedAt} /></>
          ) : stats.lastSubmittedAt ? (
            <> · last submit <RelativeTime value={stats.lastSubmittedAt} /></>
          ) : null}
        </>
      }
      action={
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
      }
    />
  )
}
