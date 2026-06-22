/**
 * FILE: UsersReadout.tsx
 * PURPOSE: Super-admin signup directory provenance — metrics API ref and platform KPIs.
 *
 * OVERVIEW:
 * - Connect-style readout for /users (super-admin only) with MRR and signup/churn signals
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 * - UsersStats from ./UsersStatsTypes
 *
 * USAGE:
 * - Mount on UsersPage when isSuperAdmin with metrics from GET /v1/super-admin/metrics
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { UsersStats } from './UsersStatsTypes'
import { IconBilling, IconGlobe } from '../icons'

function fmtMrr(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`
  return `$${n.toFixed(4)}`
}

interface Props {
  stats: UsersStats
  fetchedAt: string | null
  isValidating?: boolean
}

export function UsersReadout({ stats, fetchedAt, isValidating }: Props) {
  const metricsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/super-admin/metrics`
  const usersApi = `${RESOLVED_EXTERNAL_API_URL}/v1/super-admin/users`

  const rows: DetailRowItem[] = [
    {
      label: 'Total signups',
      value: String(stats.total_users),
      tone: stats.total_users > 0 ? 'info' : 'muted',
    },
    {
      label: 'Paid users',
      value: String(stats.paid_users),
      tone: stats.paid_users > 0 ? 'ok' : 'muted',
    },
    {
      label: 'MRR',
      value: fmtMrr(stats.mrr_usd),
      tone: stats.mrr_usd > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Signups (7d / 30d)',
      value: `${stats.signups_last_7d} · ${stats.signups_last_30d}`,
      tone: stats.signups_last_7d > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Churn (30d)',
      value: String(stats.churn_last_30d),
      tone: stats.churn_last_30d > 0 ? 'warn' : 'ok',
    },
  ]

  return (
    <Section title="Users readout" freshness={{ at: fetchedAt, isValidating }}>
      <p className="mb-4 text-xs leading-relaxed text-fg-muted">
        Super-admin operator metrics. Gated by <code className="font-mono text-2xs">requireSuperAdmin</code> in the API gateway.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Platform metrics API" url={metricsApi} />
          <div className="mt-2">
            <EndpointCodeRow label="Signup directory API" url={usersApi} />
          </div>
          <div className="mt-2">
            <EndpointCodeRow label="Admin API base" url={RESOLVED_EXTERNAL_API_URL} />
          </div>
        </ReadoutSection>
        <ReadoutSection title="Platform signals" icon={<IconBilling size={14} aria-hidden />}>
          <DetailRows items={rows} dense />
        </ReadoutSection>
      </div>
    </Section>
  )
}
