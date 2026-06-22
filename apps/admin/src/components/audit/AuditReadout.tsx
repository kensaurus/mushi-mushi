/**
 * FILE: AuditReadout.tsx
 * PURPOSE: Audit log provenance — stats API ref, plan entitlement, and latest event signals.
 *
 * OVERVIEW:
 * - Connect-style readout for /audit with copyable admin endpoints
 * - Highlights auditLogEntitlement and the most recent audit event metadata
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 * - AuditStats from ./types
 *
 * USAGE:
 * - Mount on AuditPage with stats from GET /v1/admin/audit/stats
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { AuditStats } from './types'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: AuditStats
  fetchedAt: string | null
  isValidating?: boolean
}

export function AuditReadout({ stats, fetchedAt, isValidating }: Props) {
  if (!stats.projectId) return null

  const statsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/audit/stats`

  const rows: DetailRowItem[] = [
    {
      label: 'Audit log entitlement',
      value: stats.auditLogEntitlement
        ? `${stats.planDisplayName} — enabled`
        : `${stats.planDisplayName} — upgrade required`,
      tone: stats.auditLogEntitlement ? 'ok' : 'warn',
      wrap: true,
    },
    {
      label: 'Events (24h)',
      value: `${stats.events24h} · ${stats.failCount24h} fail · ${stats.warnCount24h} warn`,
      tone: stats.failCount24h > 0 ? 'danger' : stats.events24h > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Actor mix (24h)',
      value: `${stats.humanCount24h} human · ${stats.agentCount24h} agent · ${stats.systemCount24h} system`,
      tone: stats.events24h > 0 ? 'info' : 'muted',
      wrap: true,
    },
    {
      label: 'Latest event',
      value: stats.latestEventAt
        ? `${stats.latestAction ?? 'unknown'} · ${stats.latestActorEmail ?? 'system'}`
        : 'No events yet',
      tone: stats.latestEventAt ? 'ok' : 'muted',
      wrap: true,
    },
    {
      label: 'Top action (7d)',
      value: stats.topAction7d
        ? `${stats.topAction7d} (${stats.topAction7dCount})`
        : '—',
      mono: true,
      wrap: true,
      tone: stats.topAction7d ? 'info' : 'muted',
    },
  ]

  return (
    <Section title="Audit readout" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Audit stats API" url={statsApi} />
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
