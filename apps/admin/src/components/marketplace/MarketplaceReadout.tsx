/**
 * FILE: MarketplaceReadout.tsx
 * PURPOSE: Plugin marketplace provenance — stats API ref and delivery reliability signals.
 *
 * OVERVIEW:
 * - Connect-style readout for /marketplace with install and webhook delivery posture
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 * - MarketplaceStats from ./types
 *
 * USAGE:
 * - Mount on MarketplacePage with stats from GET /v1/admin/marketplace/stats
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { MarketplaceStats } from './types'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: MarketplaceStats
  fetchedAt: string | null
  isValidating?: boolean
}

export function MarketplaceReadout({ stats, fetchedAt, isValidating }: Props) {
  if (!stats.projectId) return null

  const statsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/marketplace/stats`

  const rows: DetailRowItem[] = [
    {
      label: 'Installed',
      value: `${stats.installedActive} active · ${stats.installedPaused} paused`,
      tone: stats.installedActive > 0 ? 'ok' : stats.installedTotal > 0 ? 'warn' : 'muted',
    },
    {
      label: 'Deliveries (7d)',
      value: `${stats.deliveries7d} total · ${stats.deliverySuccessRatePct.toFixed(1)}% ok`,
      tone: stats.deliveriesFailed > 0 ? 'warn' : stats.deliveries7d > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Failed deliveries',
      value: String(stats.deliveriesFailed),
      tone: stats.deliveriesFailed > 0 ? 'danger' : 'ok',
    },
    {
      label: 'Failing plugins',
      value: `${stats.failingPlugins} failing · ${stats.neverDeliveredPlugins} never delivered`,
      tone: stats.failingPlugins > 0 ? 'danger' : stats.neverDeliveredPlugins > 0 ? 'warn' : 'ok',
      wrap: true,
    },
    {
      label: 'Catalog',
      value: `${stats.catalogTotal} plugins`,
      tone: 'info',
    },
    {
      label: 'Last delivery',
      value: stats.lastDeliveryAt ?? 'Never',
      tone: stats.lastDeliveryAt ? 'ok' : 'muted',
    },
  ]

  return (
    <Section title="Marketplace readout" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Marketplace stats API" url={statsApi} />
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
