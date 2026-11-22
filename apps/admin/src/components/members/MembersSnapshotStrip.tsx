/**
 * FILE: MembersSnapshotStrip.tsx
 * PURPOSE: Team status: who is on the team, open invites and seats left
 *          (PageStatus, P1). Mounted via PagePosture on OrganizationSettingsPage.
 */

import { PageStatus, type PageStatusMetric, type PageStatusMetrics } from '../ui'
import type { MembersStats } from './types'
import { pluralizeWithCount } from '../../lib/format'

interface Props {
  stats: MembersStats
  fetchedAt: string | null
  isValidating?: boolean
}

function membersSentence(stats: MembersStats): string {
  // The tiles carry the counts. "3 members." beside the "3 Members" tile (and
  // the Roster tab's 3) said it again, so the sentence speaks only of what
  // needs a look: invites not accepted, or no seats left.
  const parts: string[] = []
  if (stats.pendingInvites > 0) parts.push(`${pluralizeWithCount(stats.pendingInvites, 'invite')} not accepted yet`)
  if (stats.seatLimit !== null && stats.atSeatCap) parts.push(`all ${stats.seatLimit} seats are used`)
  if (parts.length === 0) {
    if (stats.memberCount <= 1) return 'Just you so far. Invite a teammate to share the bugs and fixes.'
    return 'Everyone you invited has joined.'
  }
  const text = parts.join('; ')
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
}

/**
 * @internal Exported for tests. One number per fact (round-2 review
 * 2026-11-18): "3 Members", "Roster 3" and "Seats 3/5" said the same thing,
 * so only Seats stays; open invites show only when there are some (the
 * sentence already says "Everyone you invited has joined").
 */
export function membersMetrics(stats: MembersStats): PageStatusMetrics {
  const seats: PageStatusMetric = {
    label: stats.seatLimit !== null ? 'Seats used' : 'Seats',
    value: stats.seatLimit !== null ? `${stats.seatsUsed}/${stats.seatLimit}` : 'Unlimited',
    tone: stats.atSeatCap ? 'warn' : 'neutral',
    hint: 'Seats your plan includes and how many are taken.',
  }
  if (stats.pendingInvites <= 0) return [seats]
  return [
    {
      label: 'Open invites',
      value: stats.pendingInvites,
      tone: stats.expiringSoonInvites > 0 ? 'warn' : 'neutral',
      hint: stats.expiringSoonInvites > 0 ? `${stats.expiringSoonInvites} expire soon.` : 'Invites sent but not accepted yet.',
    },
    seats,
  ]
}

export function MembersSnapshotStrip({ stats, fetchedAt, isValidating }: Props) {
  return (
    <PageStatus
      ariaLabel="Team status"
      tone={stats.atSeatCap ? 'warn' : stats.expiringSoonInvites > 0 ? 'info' : 'ok'}
      sentence={membersSentence(stats)}
      freshness={{ at: fetchedAt, isValidating }}
      metrics={membersMetrics(stats)}
    />
  )
}
