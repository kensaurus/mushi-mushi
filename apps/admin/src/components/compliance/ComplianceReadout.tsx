/**
 * FILE: ComplianceReadout.tsx
 * PURPOSE: SOC2/compliance provenance — stats API ref and control/DSAR posture signals.
 *
 * OVERVIEW:
 * - Connect-style readout for /compliance with entitlement and evidence freshness
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 * - ComplianceStats from ./types
 *
 * USAGE:
 * - Mount on CompliancePage with stats from GET /v1/admin/compliance/stats
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { ComplianceStats } from './types'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: ComplianceStats
  fetchedAt: string | null
  isValidating?: boolean
}

export function ComplianceReadout({ stats, fetchedAt, isValidating }: Props) {
  if (!stats.projectId) return null

  const statsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/compliance/stats`

  const rows: DetailRowItem[] = [
    {
      label: 'SOC2 entitlement',
      value: stats.soc2Entitlement
        ? `${stats.planDisplayName} — enabled`
        : `${stats.planDisplayName} — upgrade required`,
      tone: stats.soc2Entitlement ? 'ok' : 'warn',
      wrap: true,
    },
    {
      label: 'Controls',
      value: `${stats.controlsPass} pass · ${stats.controlsWarn} warn · ${stats.controlsFail} fail`,
      tone: stats.controlsFail > 0 ? 'danger' : stats.controlsWarn > 0 ? 'warn' : stats.controlsTotal > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Open DSARs',
      value: `${stats.openDsars} open · ${stats.overdueDsars} overdue`,
      tone: stats.overdueDsars > 0 ? 'danger' : stats.openDsars > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Legal holds',
      value: String(stats.legalHoldCount),
      tone: stats.legalHoldCount > 0 ? 'info' : 'muted',
    },
    {
      label: 'Latest evidence',
      value: stats.evidenceNeverGenerated
        ? 'Never generated'
        : (stats.latestEvidenceAt ?? '—'),
      tone: stats.evidenceNeverGenerated ? 'warn' : stats.latestEvidenceAt ? 'ok' : 'muted',
    },
    {
      label: 'Region',
      value: stats.activeProjectRegion ?? stats.currentRegion,
      mono: true,
      tone: 'info',
    },
  ]

  return (
    <Section title="Compliance readout" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Compliance stats API" url={statsApi} />
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
