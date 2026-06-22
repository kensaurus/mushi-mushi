/**
 * FILE: ResearchReadout.tsx
 * PURPOSE: Firecrawl research provenance — stats API ref and session/snippet signals.
 *
 * OVERVIEW:
 * - Connect-style readout for /research with BYOK readiness and attachment posture
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 * - ResearchStats from ./ResearchStatsTypes
 *
 * USAGE:
 * - Mount on ResearchPage with stats from GET /v1/admin/research/stats
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { ResearchStats } from './ResearchStatsTypes'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: ResearchStats
  fetchedAt: string | null
  isValidating?: boolean
}

export function ResearchReadout({ stats, fetchedAt, isValidating }: Props) {
  if (!stats.projectId) return null

  const statsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/research/stats`

  const rows: DetailRowItem[] = [
    {
      label: 'Firecrawl BYOK',
      value: stats.firecrawlReady
        ? `Ready${stats.firecrawlKeyHint ? ` · ${stats.firecrawlKeyHint}` : ''}`
        : stats.firecrawlConfigured
          ? `Not ready (${stats.firecrawlTestStatus ?? 'untested'})`
          : 'Not configured',
      tone: stats.firecrawlReady ? 'ok' : stats.firecrawlConfigured ? 'warn' : 'muted',
      wrap: true,
    },
    {
      label: 'Sessions',
      value: `${stats.sessions} sessions · ${stats.snippets} snippets`,
      tone: stats.sessions > 0 ? 'info' : 'muted',
    },
    {
      label: 'Attached',
      value: `${stats.attached} attached · ${stats.unattachedSnippets} loose`,
      tone: stats.unattachedSnippets > 0 ? 'warn' : stats.attached > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Allowed domains',
      value: String(stats.allowedDomainsCount),
      tone: stats.allowedDomainsCount > 0 ? 'info' : 'muted',
    },
    {
      label: 'Last session',
      value: stats.lastSessionAt ?? 'Never',
      tone: stats.lastSessionAt ? 'ok' : 'muted',
    },
    {
      label: 'Priority',
      value: stats.topPriorityLabel ?? stats.topPriority,
      tone: stats.topPriority === 'healthy' ? 'ok' : 'warn',
      wrap: true,
    },
  ]

  return (
    <Section title="Research readout" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Research stats API" url={statsApi} />
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
