/**
 * FILE: PromptLabSnapshotStrip.tsx
 * PURPOSE: AI prompts status: which prompts are in use, which are being
 *          tested, and the best grade so far (PageStatus, P1).
 */

import { PageStatus } from '../ui'
import type { PromptLabStats } from './PromptLabStatsTypes'
import { bestScoreSource } from './types'

const promptLabLinks = {
  active: '/prompt-lab?tab=prompts',
  candidates: '/prompt-lab?tab=prompts',
  bestScore: '/judge',
} as const

interface Props {
  stats: PromptLabStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  /** The best score belongs to a global default, scored on other projects. */
  bestIsBuiltIn?: boolean
  statLabels?: Record<string, string>
}

export function PromptLabSnapshotStrip({ stats, statsFetchedAt, statsValidating, bestIsBuiltIn = false, statLabels }: Props) {
  const best = stats.bestScore != null ? `${Math.round(stats.bestScore * 100)}%` : '—'
  const source = bestScoreSource(stats) ?? (stats.bestScore != null ? 'grade' : null)
  // Say the state; the numbers sit in the metrics below (2026-11-18: the sentence
  // repeated them, and its "3 with no grades" disagreed with the rows).
  const sentence =
    stats.bestScore != null
      ? `Best grade ${best}${source ? ` (${source}${bestIsBuiltIn ? ', built-in default' : ''})` : ''}.`
      : stats.untestedAbCount > 0
        ? 'Tests are running, waiting for their first grades.'
        : 'No version has grades yet.'
  return (
    <PageStatus
      ariaLabel="AI prompts status"
      tone={stats.bestScore != null ? 'ok' : stats.untestedAbCount > 0 ? 'info' : 'neutral'}
      sentence={sentence}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.active ?? 'In use',
          value: stats.activePrompts,
          hint: 'Prompts diagnosing your reports now, one per step.',
          to: promptLabLinks.active,
        },
        {
          label: statLabels?.candidates ?? 'Steps with a test',
          value: stats.candidatePrompts,
          hint: 'Steps with a copy of their prompt collecting grades before it replaces the one in use.',
          to: promptLabLinks.candidates,
        },
        {
          label: statLabels?.bestScore ?? 'Best grade',
          value: best,
          hint: 'Highest average grade across prompts in use and being tested. Opens Triage grading.',
          to: promptLabLinks.bestScore,
        },
      ]}
    />
  )
}
