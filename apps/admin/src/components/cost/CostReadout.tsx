/**
 * FILE: CostReadout.tsx
 * PURPOSE: LLM cost provenance — telemetry API ref and spend signals on /cost.
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { CostStats } from './types'
import { IconBilling, IconGlobe } from '../icons'

function fmtSpend(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(6)}`
}

interface Props {
  stats: CostStats
  projectId: string | null
  fetchedAt: string | null
  isValidating?: boolean
}

export function CostReadout({ stats, projectId, fetchedAt, isValidating }: Props) {
  if (!projectId) return null

  const costApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/costs/stats?project_id=${encodeURIComponent(projectId)}`

  const rows: DetailRowItem[] = [
    {
      label: '24h spend',
      value: fmtSpend(stats.spend24hUsd),
      tone: stats.spendSpike24h ? 'warn' : stats.spend24hUsd > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Month to date',
      value: fmtSpend(stats.spendMonthUsd),
      tone: stats.spendMonthUsd > 0 ? 'info' : 'muted',
    },
    {
      label: 'Top operation',
      value: stats.topOperation ?? '—',
      mono: true,
      wrap: true,
      tone: stats.topOperation ? 'info' : 'muted',
    },
    {
      label: 'Key source (24h)',
      value: stats.byokCalls24h > 0 ? `${stats.byokCalls24h} BYOK calls` : `${stats.platformKeyCalls24h} platform calls`,
      tone: stats.byokAnthropicConfigured ? 'ok' : 'warn',
    },
    {
      label: 'Last LLM call',
      value: stats.lastCallAt ?? 'No telemetry yet',
      tone: stats.lastCallAt ? 'ok' : 'muted',
    },
  ]

  return (
    <Section title="Cost readout" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Cost stats API" url={costApi} />
          <div className="mt-2">
            <EndpointCodeRow label="Admin API base" url={RESOLVED_EXTERNAL_API_URL} />
          </div>
        </ReadoutSection>
        <ReadoutSection title="Spend signals" icon={<IconBilling size={14} aria-hidden />}>
          <DetailRows items={rows} dense />
        </ReadoutSection>
      </div>
    </Section>
  )
}
