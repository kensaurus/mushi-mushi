/**
 * FILE: MembersSnapshotStrip.tsx
 * PURPOSE: Team status: who is on the team, open invites and seats left
 *          (PageStatus, P1). Mounted via PagePosture on OrganizationSettingsPage.
 */

import { PageStatus } from '../ui'
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

export function MembersSnapshotStrip({ stats, fetchedAt, isValidating }: Props) {
  return (
    <PageStatus
      ariaLabel="Team status"
      tone={stats.atSeatCap ? 'warn' : stats.expiringSoonInvites > 0 ? 'info' : 'ok'}
      sentence={membersSentence(stats)}
      freshness={{ at: fetchedAt, isValidating }}
      metrics={[
        { label: 'Members', value: stats.memberCount, hint: 'People with access to this team’s apps.' },
        {
          label: 'Invites waiting',
          value: stats.pendingInvites,
          tone: stats.expiringSoonInvites > 0 ? 'warn' : 'neutral',
          hint: stats.expiringSoonInvites > 0 ? `${stats.expiringSoonInvites} expire soon.` : 'Invites sent but not accepted yet.',
        },
        {
          label: stats.seatLimit !== null ? 'Seats used' : 'Seats',
          value: stats.seatLimit !== null ? `${stats.seatsUsed}/${stats.seatLimit}` : 'Unlimited',
          tone: stats.atSeatCap ? 'warn' : 'neutral',
          hint: 'Seats your plan includes and how many are taken.',
        },
      ]}
    />
  )
}
