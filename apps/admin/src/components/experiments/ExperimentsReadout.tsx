/**
 * FILE: ExperimentsReadout.tsx
 * PURPOSE: A/B experiments provenance — stats API ref and experiment lifecycle signals.
 *
 * OVERVIEW:
 * - Connect-style readout for /experiments with running/draft/winner posture
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 * - ExperimentsStats from ./ExperimentsStatsTypes
 *
 * USAGE:
 * - Mount on ExperimentsPage with stats from GET /v1/admin/experiments/stats
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { ExperimentsStats } from './ExperimentsStatsTypes'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: ExperimentsStats
  fetchedAt: string | null
  isValidating?: boolean
}

export function ExperimentsReadout({ stats, fetchedAt, isValidating }: Props) {
  if (!stats.projectId) return null

  const statsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/experiments/stats`

  const rows: DetailRowItem[] = [
    {
      label: 'Running',
      value: `${stats.runningCount} running · ${stats.draftCount} draft`,
      tone: stats.runningCount > 0 ? 'ok' : stats.draftCount > 0 ? 'info' : 'muted',
    },
    {
      label: 'Winners found',
      value: String(stats.winnersFound),
      tone: stats.winnersFound > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Assignments',
      value: `${stats.totalAssignments} · ${stats.totalConversions} conversions (${stats.conversionRatePct.toFixed(1)}%)`,
      tone: stats.totalAssignments > 0 ? 'info' : 'muted',
      wrap: true,
    },
    {
      label: 'Variants',
      value: `${stats.totalVariants} variants · ${stats.banditEnabledCount} bandit`,
      tone: stats.totalVariants > 0 ? 'info' : 'muted',
    },
    {
      label: 'Drafts ready',
      value: String(stats.draftsReadyToLaunch),
      tone: stats.draftsReadyToLaunch > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Last experiment',
      value: stats.lastExperimentAt ?? 'Never',
      tone: stats.lastExperimentAt ? 'ok' : 'muted',
    },
  ]

  return (
    <Section title="Experiments readout" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Experiments stats API" url={statsApi} />
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
