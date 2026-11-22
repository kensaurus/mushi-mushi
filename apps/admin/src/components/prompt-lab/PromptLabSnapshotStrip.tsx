/**
 * FILE: PromptLabSnapshotStrip.tsx
 * PURPOSE: AI prompts status: one recommendation in plain words with its button
 *          (promptRecommendation), then prompts in use, steps testing and the best grade.
 */

import { Btn, PageStatus } from '../ui'
import { BarCell } from '../signal/BarCell'
import type { PromptLabStats } from './PromptLabStatsTypes'
import type { PromptRecommendation, PromptRecommendationAction } from './promptRecommendation'

const promptLabLinks = {
  active: '/prompt-lab?tab=prompts',
  candidates: '/prompt-lab?tab=prompts',
  bestScore: '/judge',
} as const

interface Props {
  stats: PromptLabStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
  /** "1 test running · 1 not started", from the prompt list (promptTestSummary). */
  testSummary?: { text: string; testing: number } | null
  /** The one recommendation the line leads with (promptRecommendation). */
  recommendation: PromptRecommendation
  /** Runs the recommendation's button. */
  onAction?: (action: PromptRecommendationAction) => void
}

export function PromptLabSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels, testSummary = null, recommendation, onAction }: Props) {
  // No grade is a dash in the tile: the sentence says "no grades" once (2026-11-19: 4 times).
  const best = stats.bestScore != null ? `${Math.round(stats.bestScore * 100)}%` : '—'
  return (
    <PageStatus
      ariaLabel="AI prompts status"
      tone={recommendation.tone}
      sentence={recommendation.sentence}
      action={
        recommendation.action && recommendation.actionLabel && onAction ? (
          <Btn size="sm" variant={recommendation.tone === 'neutral' ? 'ghost' : 'primary'} onClick={() => onAction(recommendation.action!)} data-testid="prompt-lab-lead-action">
            {recommendation.actionLabel}
          </Btn>
        ) : undefined
      }
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.active ?? 'In use',
          value: stats.activePrompts,
          hint: 'Prompts diagnosing your reports now, one per step.',
          to: promptLabLinks.active,
        },
        {
          // Steps whose test gets reports: "2 steps with a test" beside one running read as two
          // running (2026-11-19).
          label: statLabels?.candidates ?? 'Steps testing',
          value: testSummary ? testSummary.testing : stats.candidatePrompts,
          hint: 'Steps whose test version gets a share of reports and collects grades before it can replace the one in use.',
          to: promptLabLinks.candidates,
        },
        {
          label: statLabels?.bestScore ?? 'Best grade',
          value: best,
          hint: 'Highest average grade across prompts in use and being tested. Opens Triage grading.',
          to: promptLabLinks.bestScore,
          visual: stats.bestScore != null ? <BarCell value={Math.round(stats.bestScore * 100)} max={100} label={`Best grade ${best}`} tone={stats.bestScore >= 0.8 ? 'ok' : stats.bestScore >= 0.6 ? 'warn' : 'danger'} /> : undefined,
        },
      ]}
    />
  )
}
