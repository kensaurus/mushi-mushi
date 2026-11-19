/**
 * FILE: PromptLabSnapshotStrip.tsx
 * PURPOSE: AI prompts status: which prompts are in use, which are being
 *          tested, and the best grade so far (PageStatus, P1).
 */

import { Btn, PageStatus, type PageStatusTone } from '../ui'
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
  /** "1 test running · 1 not started", from the prompt list (promptTestSummary). */
  testSummary?: { text: string; testing: number } | null
  /** Where the step tables are, for the line's one action ("Set traffic %" / "Open prompts"). */
  promptsHref?: string
}

/**
 * @internal Exported for tests. The line's tone and action once it carries the test state (the
 * banner that used to say it is gone): every test at 0% of traffic is a warning with "Set
 * traffic %"; a test that gets traffic is work in progress with "Open prompts".
 */
export function promptLabLineState(testSummary: { testing: number } | null | undefined): { tone: PageStatusTone; action: string | null } {
  if (!testSummary) return { tone: 'neutral', action: null }
  return testSummary.testing === 0 ? { tone: 'warn', action: 'Set traffic %' } : { tone: 'info', action: 'Open prompts' }
}

export function PromptLabSnapshotStrip({ stats, statsFetchedAt, statsValidating, bestIsBuiltIn = false, statLabels, testSummary = null, promptsHref = promptLabLinks.candidates }: Props) {
  const line = promptLabLineState(testSummary)
  // No grade is a dash in the tile: the sentence says "no grades" once (2026-11-19: 4 times).
  const best = stats.bestScore != null ? `${Math.round(stats.bestScore * 100)}%` : '—'
  const source = bestScoreSource(stats) ?? (stats.bestScore != null ? 'grade' : null)
  // One status line for tests and grades: the page no longer stacks a test banner over it.
  const grades =
    stats.bestScore != null
      ? `Best grade ${best}${source ? ` (${source}${bestIsBuiltIn ? ', built-in default' : ''})` : ''}.`
      : 'No version has a grade yet. Grades come from Triage grading.'
  const sentence = testSummary ? `${testSummary.text}. ${grades}` : grades
  return (
    <PageStatus
      ariaLabel="AI prompts status"
      tone={line.tone}
      sentence={sentence}
      action={line.action ? <Btn to={promptsHref} size="sm" variant={line.tone === 'warn' ? 'primary' : 'ghost'}>{line.action}</Btn> : undefined}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.active ?? 'In use',
          value: stats.activePrompts,
          hint: 'Prompts diagnosing your reports now, one per step.',
          to: promptLabLinks.active,
        },
        {
          // Steps whose test gets traffic: "2 steps with a test" beside one running read as two
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
        },
      ]}
    />
  )
}
