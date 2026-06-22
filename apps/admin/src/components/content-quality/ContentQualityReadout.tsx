/**
 * FILE: ContentQualityReadout.tsx
 * PURPOSE: Content quality provenance — stats API ref and minimal list issue signals.
 *
 * OVERVIEW:
 * - Connect-style readout for content-quality routes with open/regen/user-flag counts
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 * - ContentQualityStats from ./ContentQualityStatsTypes
 *
 * USAGE:
 * - Mount on content-quality page with stats from GET /v1/admin/content-quality/stats
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { ContentQualityStats } from './ContentQualityStatsTypes'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: ContentQualityStats
  fetchedAt: string | null
  isValidating?: boolean
}

export function ContentQualityReadout({ stats, fetchedAt, isValidating }: Props) {
  if (!stats.projectId) return null

  const statsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/content-quality/stats`

  const rows: DetailRowItem[] = [
    {
      label: 'Open issues',
      value: String(stats.openCount),
      tone: stats.openCount > 0 ? 'warn' : 'ok',
    },
    {
      label: 'In review',
      value: String(stats.inReviewCount),
      tone: stats.inReviewCount > 0 ? 'info' : 'muted',
    },
    {
      label: 'Regenerating',
      value: String(stats.regeneratingCount),
      tone: stats.regeneratingCount > 0 ? 'info' : 'muted',
    },
    {
      label: 'User flags',
      value: String(stats.userFlagOpenCount),
      tone: stats.userFlagOpenCount > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Failed regen',
      value: String(stats.failedRegenCount),
      tone: stats.failedRegenCount > 0 ? 'danger' : 'ok',
    },
    {
      label: 'Needs attention',
      value: String(stats.needsAttentionCount),
      tone: stats.needsAttentionCount > 0 ? 'danger' : 'ok',
    },
  ]

  return (
    <Section title="Content quality readout" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Content quality stats API" url={statsApi} />
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
