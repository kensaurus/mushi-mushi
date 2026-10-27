/**
 * FILE: PromptLabSnapshotStrip.tsx
 * PURPOSE: AI prompts status: which prompts are in use, which are being
 *          tested, and the best grade so far (PageStatus, P1).
 */

import { PageStatus } from '../ui'
import type { PromptLabStats } from './PromptLabStatsTypes'
import { bestScoreSource } from './types'
import { pluralizeWithCount } from '../../lib/format'

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
  const testing =
    stats.candidatePrompts > 0
      ? `${pluralizeWithCount(stats.candidatePrompts, 'prompt')} being tested${stats.untestedAbCount > 0 ? `, ${stats.untestedAbCount} with no grades yet` : ''}`
      : 'none being tested'
  const bestPart =
    stats.bestScore != null ? `; best grade ${best}${source ? ` (${source}${bestIsBuiltIn ? ', built-in default' : ''})` : ''}` : ''
  return (
    <PageStatus
      ariaLabel="AI prompts status"
      tone={stats.untestedAbCount > 0 ? 'info' : 'ok'}
      sentence={`${pluralizeWithCount(stats.activePrompts, 'prompt')} in use, ${testing}${bestPart}.`}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.active ?? 'In use',
          value: stats.activePrompts,
          hint: 'Prompts diagnosing your reports now, one per step.',
          to: promptLabLinks.active,
        },
        {
          label: statLabels?.candidates ?? 'Being tested',
          value: stats.candidatePrompts,
          hint: 'Copies of a prompt collecting grades before they replace it.',
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
