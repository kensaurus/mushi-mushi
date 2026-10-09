/**
 * FILE: PromptLabSnapshotStrip.tsx
 * PURPOSE: Prompt Lab KPI strip using MetricStrip — backed by /v1/admin/prompt-lab/stats.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { PromptLabStats } from './PromptLabStatsTypes'
import { bestScoreSource } from './types'

const promptLabLinks = {
  active: '/prompt-lab?tab=prompts',
  candidates: '/prompt-lab?tab=prompts',
  bestScore: '/judge',
  dataset: '/prompt-lab?tab=dataset',
} as const

interface Props {
  stats: PromptLabStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  /** The same classified-report counts the Eval dataset card shows. */
  dataset: { total: number; labelled: number }
  /** The best score belongs to a global default, scored on other projects. */
  bestIsBuiltIn?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function PromptLabSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  dataset,
  bestIsBuiltIn = false,
  sectionTitle = 'PROMPT LAB SNAPSHOT',
  hint,
  statLabels,
}: Props) {
  const bestScoreLabel =
    stats.bestScore != null ? `${Math.round(stats.bestScore * 100)}%` : '—'
  const bestSource = bestScoreSource(stats) ?? (stats.bestScore != null ? 'judge score' : 'no scored prompts yet')
  const bestScoreDetail = bestIsBuiltIn ? `${bestSource} · built-in default` : bestSource

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
          hint="Highest mean judge score across active and candidate prompts. Opens Fix grading."
          detail={bestScoreDetail}
          to={promptLabLinks.bestScore}
        />
        <StatCard
          label={statLabels?.dataset ?? 'Eval dataset'}
          value={dataset.labelled.toLocaleString()}
          hint="Classified reports a prompt experiment can be evaluated on: the list below."
          detail={`labelled · ${dataset.total.toLocaleString()} reports in total`}
          to={promptLabLinks.dataset}
        />
      </MetricStrip>
    </Section>
  )
}
