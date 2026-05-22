/**
 * FILE: apps/admin/src/components/members/MembersStatusBanner.tsx
 * PURPOSE: Team roster health — plan gating, seat cap, invites, inactive seats.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { StatusBannerShell } from '../StatusBannerShell'
import type { MembersStats } from './types'

interface Props {
  stats: MembersStats
  teamsEnabled: boolean
  onInvitesTab?: () => void
}

export function MembersStatusBanner({ stats, teamsEnabled, onInvitesTab }: Props) {
  const orgLabel = stats.organizationName ?? 'this team'

  if (!teamsEnabled) {
    return (
      <StatusBannerShell
        tone="warn"
        title="Teams require Pro or Enterprise"
        subtitle={`You can preview the roster on ${stats.planDisplayName ?? stats.planId ?? 'Hobby'}, but inviting teammates needs the teams entitlement.`}
        action={
          <Link to="/billing">
            <Btn size="sm" variant="ghost">View plans</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.atSeatCap) {
    return (
      <StatusBannerShell
        tone="danger"
        title="Seat cap reached"
        subtitle={`${stats.seatsUsed} of ${stats.seatLimit} seats used for ${orgLabel} (${stats.memberCount} members · ${stats.pendingInvites} pending). Upgrade or remove a member before inviting more.`}
        action={
          <Link to="/billing">
            <Btn size="sm" variant="ghost">Upgrade</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.expiringSoonInvites > 0) {
    return (
      <StatusBannerShell
        tone="warn"
        title={`${stats.expiringSoonInvites} invite${stats.expiringSoonInvites === 1 ? '' : 's'} expiring within 24h`}
        subtitle="Resend or copy the invite link before it lapses — expired invites stop working and need a fresh send."
        action={
          onInvitesTab ? (
            <Btn size="sm" variant="ghost" onClick={onInvitesTab}>
              Open invites
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.pendingInvites > 0 && stats.memberCount <= 1) {
    return (
      <StatusBannerShell
        tone="info"
        title={`${stats.pendingInvites} invite${stats.pendingInvites === 1 ? '' : 's'} waiting for ${orgLabel}`}
        subtitle="Pending teammates haven't accepted yet — resend email or copy the invite link if deliverability is flaky."
        action={
          onInvitesTab ? (
            <Btn size="sm" variant="ghost" onClick={onInvitesTab}>
              Manage invites
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.inactiveCount > 0 && stats.memberCount >= 3) {
    return (
      <StatusBannerShell
        tone="info"
        title={`${stats.inactiveCount} inactive seat${stats.inactiveCount === 1 ? '' : 's'} (>30d or never seen)`}
        subtitle={`${stats.activeLast7d} active in the last 7 days · toggle "Show inactive only" on the Roster tab to audit coasting seats.`}
      />
    )
  }

  if (!stats.canManage) {
    return (
      <StatusBannerShell
        tone="info"
        title="View-only access"
        subtitle={`Your role is ${stats.currentUserRole} — only owners and admins can invite, change roles, or remove teammates.`}
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title="Team roster healthy"
      subtitle={`${stats.memberCount} member${stats.memberCount === 1 ? '' : 's'}${stats.pendingInvites > 0 ? ` · ${stats.pendingInvites} pending invite${stats.pendingInvites === 1 ? '' : 's'}` : ''}${stats.seatLimit !== null ? ` · ${stats.seatsUsed}/${stats.seatLimit} seats` : ''}${stats.activeLast7d > 0 ? ` · ${stats.activeLast7d} active this week` : ''}`}
      action={
        onInvitesTab && stats.canManage ? (
          <Btn size="sm" variant="ghost" onClick={onInvitesTab}>
            Invite teammate
          </Btn>
        ) : null
      }
    />
  )
}
