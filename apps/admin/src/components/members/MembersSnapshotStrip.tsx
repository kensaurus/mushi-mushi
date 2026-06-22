/**
 * FILE: MembersSnapshotStrip.tsx
 * PURPOSE: Team roster KPI strip — MetricStrip layout for OrganizationSettingsPage.
 *
 * OVERVIEW:
 * - Four StatCards for member count, invites, inactive seats, and seat usage
 *
 * DEPENDENCIES:
 * - MetricStrip, Section, StatCard, SnapshotSectionHint
 * - MembersStats from ./types
 *
 * USAGE:
 * - Mount via PagePosture on OrganizationSettingsPage with stats from members API
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { MembersStats } from './types'

interface Props {
  stats: MembersStats
  fetchedAt: string | null
  isValidating?: boolean
  sectionTitle?: string
  hint?: string
}

export function MembersSnapshotStrip({
  stats,
  fetchedAt,
  isValidating,
  sectionTitle = 'Team snapshot',
  hint,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: fetchedAt, isValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={4} ariaLabel="Team snapshot">
        <StatCard
          label="Members"
          value={stats.memberCount}
          accent="text-brand"
          hint={`${stats.activeLast7d} active in the last 7 days`}
        />
        <StatCard
          label="Pending invites"
          value={stats.pendingInvites}
          accent={stats.pendingInvites > 0 ? 'text-warn' : undefined}
          hint={
            stats.expiringSoonInvites > 0
              ? `${stats.expiringSoonInvites} expiring within 24h`
              : 'Open invites not yet accepted'
          }
        />
        <StatCard
          label="Inactive seats"
          value={stats.inactiveCount}
          accent={stats.inactiveCount > 0 && stats.memberCount >= 3 ? 'text-warn' : undefined}
          hint="No activity in 30d or never seen"
        />
        <StatCard
          label={stats.seatLimit !== null ? 'Seats used' : 'Plan seats'}
          value={stats.seatLimit !== null ? `${stats.seatsUsed}/${stats.seatLimit}` : 'Unlimited'}
          accent={stats.atSeatCap ? 'text-danger' : stats.seatLimit !== null ? 'text-ok' : undefined}
          hint={
            stats.seatLimit !== null
              ? `${stats.seatsRemaining ?? 0} remaining on ${stats.planDisplayName ?? stats.planId ?? 'plan'}`
              : `${stats.planDisplayName ?? stats.planId ?? 'Pro'} — no seat cap`
          }
        />
      </MetricStrip>
    </Section>
  )
}
