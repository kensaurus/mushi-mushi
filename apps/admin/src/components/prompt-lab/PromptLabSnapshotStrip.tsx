/**
 * FILE: PromptLabSnapshotStrip.tsx
 * PURPOSE: Prompt Lab KPI strip using MetricStrip — backed by /v1/admin/prompt-lab/stats.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { PromptLabStats } from './PromptLabStatsTypes'

const promptLabLinks = {
  active: '/prompt-lab',
  candidates: '/prompt-lab',
  bestScore: '/prompt-lab',
  dataset: '/prompt-lab',
} as const

interface Props {
  stats: PromptLabStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function PromptLabSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'PROMPT LAB SNAPSHOT',
  hint,
  statLabels,
}: Props) {
  const bestScoreLabel =
    stats.bestScore != null ? `${Math.round(stats.bestScore * 100)}%` : '—'
  const bestScoreDetail =
    stats.bestStage && stats.bestVersion
      ? `${stats.bestStage}/${stats.bestVersion}`
      : 'no scored prompts yet'

  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={4} ariaLabel="Prompt lab snapshot">
        <StatCard
          label={statLabels?.active ?? 'Active prompts'}
          value={stats.activePrompts}
          accent={stats.activePrompts > 0 ? 'text-ok' : undefined}
          hint="Prompts currently serving production traffic — one active per stage."
          detail="serving production traffic"
          to={promptLabLinks.active}
        />
        <StatCard
          label={statLabels?.candidates ?? 'Candidates'}
          value={stats.candidatePrompts}
          accent={stats.candidatePrompts > 0 ? 'text-info' : undefined}
          hint="Cloned prompts collecting evaluations before promotion."
          detail={
            stats.untestedAbCount > 0
              ? `${stats.untestedAbCount} untested A/B`
              : 'awaiting eval'
          }
          to={promptLabLinks.candidates}
        />
        <StatCard
          label={statLabels?.bestScore ?? 'Best score'}
          value={bestScoreLabel}
          accent={stats.bestScore != null ? 'text-ok' : undefined}
          hint="Highest mean judge score across active and candidate prompts."
          detail={bestScoreDetail}
          to={promptLabLinks.bestScore}
        />
        <StatCard
          label={statLabels?.dataset ?? 'Eval dataset'}
          value={stats.datasetLabelled.toLocaleString()}
          accent={stats.datasetTotal > 0 ? 'text-brand' : undefined}
          hint="Reports with human-labelled ground truth for prompt evaluation."
          detail={
            stats.datasetLabelPct != null
              ? `${stats.datasetLabelPct}% labelled · ${stats.datasetTotal.toLocaleString()} total`
              : `${stats.datasetTotal.toLocaleString()} total reports`
          }
          to={promptLabLinks.dataset}
        />
      </MetricStrip>
    </Section>
  )
}
