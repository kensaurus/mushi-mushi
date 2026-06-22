/**
 * FILE: StorageReadout.tsx
 * PURPOSE: Evidence storage provenance — stats API ref and health probe signals.
 *
 * OVERVIEW:
 * - Connect-style readout for /storage with provider health and object counts
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 * - StorageStats from ./types
 *
 * USAGE:
 * - Mount on StoragePage with stats from GET /v1/admin/storage/stats
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { StorageStats } from './types'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: StorageStats
  fetchedAt: string | null
  isValidating?: boolean
}

function healthTone(status: string): DetailRowItem['tone'] {
  if (status === 'healthy') return 'ok'
  if (status === 'degraded') return 'warn'
  if (status === 'failing') return 'danger'
  return 'muted'
}

export function StorageReadout({ stats, fetchedAt, isValidating }: Props) {
  if (!stats.projectId) return null

  const statsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/storage/stats`

  const rows: DetailRowItem[] = [
    {
      label: 'Active project health',
      value: stats.activeProjectConfigured
        ? `${stats.activeProjectHealthStatus} · ${stats.activeProjectProvider}`
        : 'Not configured',
      tone: stats.activeProjectConfigured ? healthTone(String(stats.activeProjectHealthStatus)) : 'warn',
      wrap: true,
    },
    {
      label: 'Objects (active)',
      value: String(stats.activeProjectObjects),
      tone: stats.activeProjectObjects > 0 ? 'info' : 'muted',
    },
    {
      label: 'Fleet posture',
      value: `${stats.healthyCount} healthy · ${stats.degradedCount} degraded · ${stats.failingCount} failing`,
      tone: stats.failingCount > 0 ? 'danger' : stats.degradedCount > 0 ? 'warn' : 'ok',
      wrap: true,
    },
    {
      label: 'Last write',
      value: stats.activeProjectLastWrite ?? 'Never',
      tone: stats.activeProjectLastWrite ? 'ok' : 'muted',
    },
    {
      label: 'Last health check',
      value: stats.lastHealthCheckAt ?? 'Never probed',
      tone: stats.lastHealthCheckAt ? 'info' : 'muted',
    },
    {
      label: 'Latest failure',
      value: stats.latestFailureError ?? 'None',
      tone: stats.latestFailureError ? 'danger' : 'ok',
      wrap: true,
    },
  ]

  return (
    <Section title="Storage readout" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Storage stats API" url={statsApi} />
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
