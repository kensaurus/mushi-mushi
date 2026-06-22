/**
 * FILE: MembersReadout.tsx
 * PURPOSE: Organization members provenance — org stats API ref and seat/roster signals.
 *
 * OVERVIEW:
 * - Connect-style readout for org settings with seat cap and invite posture
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 * - MembersStats from ./types
 *
 * USAGE:
 * - Mount on OrganizationSettingsPage with stats from GET /v1/org/:orgId/members/stats
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { MembersStats } from './types'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: MembersStats
  orgId: string | null
  fetchedAt: string | null
  isValidating?: boolean
}

export function MembersReadout({ stats, orgId, fetchedAt, isValidating }: Props) {
  if (!orgId) return null

  const statsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/org/${encodeURIComponent(orgId)}/members/stats`

  const rows: DetailRowItem[] = [
    {
      label: 'Members',
      value: `${stats.memberCount} members · ${stats.activeLast7d} active (7d)`,
      tone: stats.memberCount > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Seats',
      value: stats.seatLimit != null
        ? `${stats.seatsUsed}/${stats.seatLimit} used${stats.seatsRemaining != null ? ` · ${stats.seatsRemaining} left` : ''}`
        : `${stats.seatsUsed} used · unlimited`,
      tone: stats.atSeatCap ? 'danger' : 'ok',
      wrap: true,
    },
    {
      label: 'Pending invites',
      value: `${stats.pendingInvites} pending · ${stats.expiringSoonInvites} expiring soon`,
      tone: stats.pendingInvites > 0 ? 'info' : 'muted',
    },
    {
      label: 'Inactive',
      value: String(stats.inactiveCount),
      tone: stats.inactiveCount > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Plan',
      value: stats.planDisplayName ?? stats.planId ?? '—',
      tone: stats.planId ? 'info' : 'muted',
    },
    {
      label: 'Your role',
      value: stats.currentUserRole,
      tone: stats.canManage ? 'ok' : 'muted',
    },
  ]

  return (
    <Section title="Members readout" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Org members stats API" url={statsApi} />
          <div className="mt-2">
            <EndpointCodeRow label="Admin API base" url={RESOLVED_EXTERNAL_API_URL} />
          </div>
        </ReadoutSection>
        <ReadoutSection title="Live signals" icon={<IconHealth size={14} aria-hidden />}>
          <DetailRows items={rows} dense />
        </ReadoutSection>
      </div>
    </Section>
  )
}
