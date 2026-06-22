/**
 * FILE: PromptLabReadout.tsx
 * PURPOSE: Prompt lab provenance — stats API ref and dataset/prompt posture signals.
 *
 * OVERVIEW:
 * - Connect-style readout for /prompt-lab with A/B and fine-tune readiness signals
 *
 * DEPENDENCIES:
 * - ReadoutSection, EndpointCodeRow, DetailRows, Section, RESOLVED_EXTERNAL_API_URL
 * - PromptLabStats from ./PromptLabStatsTypes
 *
 * USAGE:
 * - Mount on PromptLabPage with stats from GET /v1/admin/prompt-lab/stats
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import type { PromptLabStats } from './PromptLabStatsTypes'
import { IconGlobe, IconHealth } from '../icons'

interface Props {
  stats: PromptLabStats
  fetchedAt: string | null
  isValidating?: boolean
}

export function PromptLabReadout({ stats, fetchedAt, isValidating }: Props) {
  if (!stats.projectId) return null

  const statsApi = `${RESOLVED_EXTERNAL_API_URL}/v1/admin/prompt-lab/stats`

  const rows: DetailRowItem[] = [
    {
      label: 'Prompts',
      value: `${stats.activePrompts} active · ${stats.candidatePrompts} candidates`,
      tone: stats.activePrompts > 0 ? 'ok' : 'muted',
    },
    {
      label: 'A/B testing',
      value: `${stats.abTestingCount} running · ${stats.untestedAbCount} untested`,
      tone: stats.untestedAbCount > 0 ? 'warn' : stats.abTestingCount > 0 ? 'ok' : 'muted',
    },
    {
      label: 'Promote ready',
      value: String(stats.promoteReadyCount),
      tone: stats.promoteReadyCount > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Best score',
      value: stats.bestScore != null
        ? `${stats.bestScore.toFixed(3)} · ${stats.bestStage ?? '?'} v${stats.bestVersion ?? '?'}`
        : '—',
      tone: stats.bestScore != null ? 'info' : 'muted',
      wrap: true,
    },
    {
      label: 'Dataset labelled',
      value: stats.datasetTotal > 0
        ? `${stats.datasetLabelled}/${stats.datasetTotal}${stats.datasetLabelPct != null ? ` (${stats.datasetLabelPct.toFixed(0)}%)` : ''}`
        : 'No dataset',
      tone: stats.datasetTotal === 0 ? 'warn' : stats.datasetLabelPct != null && stats.datasetLabelPct >= 80 ? 'ok' : 'info',
    },
    {
      label: 'Fine-tune pending',
      value: String(stats.fineTuningPending),
      tone: stats.fineTuningPending > 0 ? 'info' : 'muted',
    },
  ]

  return (
    <Section title="Prompt lab readout" freshness={{ at: fetchedAt, isValidating }}>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Prompt lab stats API" url={statsApi} />
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
