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
  const members = `${pluralizeWithCount(stats.memberCount, 'member')}`
  const invites = stats.pendingInvites > 0 ? `, ${pluralizeWithCount(stats.pendingInvites, 'invite')} not accepted yet` : ''
  // The Seats tile carries the count; the sentence speaks only when the
  // seats have run out (it said "3 of 5 seats used" beside "3/5").
  const seats = stats.seatLimit !== null && stats.atSeatCap ? `; all ${stats.seatLimit} seats are used` : ''
  return `${members}${invites}${seats}.`
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
