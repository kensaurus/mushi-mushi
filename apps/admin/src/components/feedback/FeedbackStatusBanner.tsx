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
      <StatusBannerShell
        tone="info"
        title="Create a project before submitting feedback"
        subtitle="Tickets attach to a project so we know which app your bug or feature idea belongs to."
        action={
          <Link to="/onboarding">
            <Btn size="sm" variant="ghost">Go to Setup</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'first_submit') {
    return (
      <StatusBannerShell
        tone="brand"
        title={`No submissions yet on ${stats.projectName ?? 'your project'}`}
        subtitle="Report a console bug or request a feature — we read every ticket and link shipped ideas to release versions."
        action={
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
        }
      />
    )
  }

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
