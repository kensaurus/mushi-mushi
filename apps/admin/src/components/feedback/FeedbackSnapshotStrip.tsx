/**
 * FILE: FeedbackSnapshotStrip.tsx
 * PURPOSE: Help & support status: what you asked the Mushi team and what is
 *          waiting on whom (PageStatus, P1).
 */

import { PageStatus } from '../ui'
import type { FeedbackStats } from './types'
import { pluralizeWithCount } from '../../lib/format'
import { feedbackLinks } from '../../lib/statCardLinks'

interface Props {
  stats: FeedbackStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
}

function feedbackSentence(stats: FeedbackStats): string {
  if (stats.totalTickets === 0) return 'You have not sent the Mushi team a bug or a request yet.'
  const open = `${pluralizeWithCount(stats.activeTickets, 'ticket')} open`
  const reply = stats.awaitingReply > 0 ? `, ${stats.awaitingReply} waiting for your reply` : ''
  const shipped = stats.shippedTickets > 0 ? `; ${stats.shippedTickets} shipped` : ''
  return `${open}${reply}${shipped}.`
}

export function FeedbackSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels }: Props) {
  return (
    <PageStatus
      ariaLabel="Help and support status"
      tone={stats.awaitingReply > 0 ? 'warn' : stats.activeTickets > 0 ? 'info' : 'neutral'}
      sentence={feedbackSentence(stats)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.active ?? 'Open',
          value: stats.activeTickets,
          hint: 'Bugs and requests you sent that the team has not closed.',
          to: feedbackLinks.active,
        },
        {
          label: 'Waiting for you',
          value: stats.awaitingReply,
          tone: stats.awaitingReply > 0 ? 'warn' : 'neutral',
          hint: 'Tickets where the team replied and asked you something.',
          to: feedbackLinks.active,
        },
        {
          label: statLabels?.shipped ?? 'Shipped',
          value: stats.shippedTickets,
          hint: 'Requests the team built and shipped.',
          to: feedbackLinks.shipped,
        },
      ]}
    />
  )
}
