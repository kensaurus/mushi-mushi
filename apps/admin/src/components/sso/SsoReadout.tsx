/**
 * FILE: SsoReadout.tsx
 * PURPOSE: Enterprise SSO provenance — stats API ref, ACS URL, and registration signals.
 *
 * OVERVIEW:
 * - Connect-style readout for /sso with copyable ACS URL from SsoStats.defaultAcsUrl
 * - Surfaces plan entitlement and provider registration posture
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 * - SsoStats from ./types
 *
 * USAGE:
 * - Mount on SsoPage with stats from GET /v1/admin/sso/stats
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { SsoStats } from './types'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: SsoStats
  fetchedAt: string | null
  isValidating?: boolean
}

export function SsoReadout({ stats, fetchedAt, isValidating }: Props) {
  if (!stats.projectId) return null

  const statsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/sso/stats`
  const configsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/sso`

  const rows: DetailRowItem[] = [
    {
      label: 'SSO entitlement',
      value: stats.ssoEntitlement
        ? `${stats.planDisplayName} — enabled`
        : `${stats.planDisplayName} — upgrade required`,
      tone: stats.ssoEntitlement ? 'ok' : 'warn',
      wrap: true,
    },
    {
      label: 'Providers',
      value: `${stats.registeredCount} registered · ${stats.pendingCount} pending · ${stats.failedCount} failed`,
      tone: stats.failedCount > 0 ? 'danger' : stats.pendingCount > 0 ? 'warn' : stats.registeredCount > 0 ? 'ok' : 'muted',
      wrap: true,
    },
    {
      label: 'Active / domains',
      value: `${stats.activeCount} active · ${stats.domainCount} domains`,
      tone: stats.activeCount > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Latest provider',
      value: stats.latestProviderName ?? '—',
      tone: stats.latestProviderName ? 'info' : 'muted',
    },
    {
      label: 'Last registered',
      value: stats.lastRegisteredAt ?? 'Never',
      tone: stats.lastRegisteredAt ? 'ok' : 'muted',
    },
    {
      label: 'Latest failure',
      value: stats.latestFailure ?? 'None',
      tone: stats.latestFailure ? 'danger' : 'ok',
      wrap: true,
    },
  ]

  return (
    <Section title="SSO readout" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="SSO stats API" url={statsApi} />
          <div className="mt-2">
            <EndpointCodeRow label="SSO configs API" url={configsApi} />
          </div>
          {stats.defaultAcsUrl ? (
            <div className="mt-2">
              <EndpointCodeRow label="Default ACS URL" url={stats.defaultAcsUrl} />
            </div>
          ) : null}
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
