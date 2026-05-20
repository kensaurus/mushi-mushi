/**
 * FILE: apps/admin/src/components/members/MembersStatusBanner.tsx
 * PURPOSE: Team roster health — plan gating, seat cap, invites, inactive seats.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
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
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">Teams require Pro or Enterprise</p>
            <p className="text-2xs text-fg-muted">
              You can preview the roster on {stats.planDisplayName ?? stats.planId ?? 'Hobby'}, but inviting teammates needs the teams entitlement.
            </p>
          </div>
        </div>
        <Link to="/billing">
          <Btn size="sm" variant="ghost">View plans</Btn>
        </Link>
      </div>
    )
  }

  if (stats.atSeatCap) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">Seat cap reached</p>
            <p className="text-2xs text-fg-muted">
              {stats.seatsUsed} of {stats.seatLimit} seats used for {orgLabel} ({stats.memberCount} members · {stats.pendingInvites} pending).
              Upgrade or remove a member before inviting more.
            </p>
          </div>
        </div>
        <Link to="/billing">
          <Btn size="sm" variant="ghost">Upgrade</Btn>
        </Link>
      </div>
    )
  }

  if (stats.expiringSoonInvites > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {stats.expiringSoonInvites} invite{stats.expiringSoonInvites === 1 ? '' : 's'} expiring within 24h
            </p>
            <p className="text-2xs text-fg-muted">
              Resend or copy the invite link before it lapses — expired invites stop working and need a fresh send.
            </p>
          </div>
        </div>
        {onInvitesTab ? (
          <Btn size="sm" variant="ghost" onClick={onInvitesTab}>
            Open invites
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.pendingInvites > 0 && stats.memberCount <= 1) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {stats.pendingInvites} invite{stats.pendingInvites === 1 ? '' : 's'} waiting for {orgLabel}
            </p>
            <p className="text-2xs text-fg-muted">
              Pending teammates haven&apos;t accepted yet — resend email or copy the invite link if deliverability is flaky.
            </p>
          </div>
        </div>
        {onInvitesTab ? (
          <Btn size="sm" variant="ghost" onClick={onInvitesTab}>
            Manage invites
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.inactiveCount > 0 && stats.memberCount >= 3) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {stats.inactiveCount} inactive seat{stats.inactiveCount === 1 ? '' : 's'} (&gt;30d or never seen)
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.activeLast7d} active in the last 7 days · toggle &quot;Show inactive only&quot; on the Roster tab to audit coasting seats.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!stats.canManage) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">View-only access</p>
            <p className="text-2xs text-fg-muted">
              Your role is {stats.currentUserRole} — only owners and admins can invite, change roles, or remove teammates.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">Team roster healthy</p>
          <p className="text-2xs text-fg-muted">
            {stats.memberCount} member{stats.memberCount === 1 ? '' : 's'}
            {stats.pendingInvites > 0 ? ` · ${stats.pendingInvites} pending invite${stats.pendingInvites === 1 ? '' : 's'}` : ''}
            {stats.seatLimit !== null ? ` · ${stats.seatsUsed}/${stats.seatLimit} seats` : ''}
            {stats.activeLast7d > 0 ? ` · ${stats.activeLast7d} active this week` : ''}
          </p>
        </div>
      </div>
      {onInvitesTab && stats.canManage ? (
        <Btn size="sm" variant="ghost" onClick={onInvitesTab}>
          Invite teammate
        </Btn>
      ) : null}
    </div>
  )
}
