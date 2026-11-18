/**
 * FILE: apps/admin/src/components/prompt-lab/promptLabCounts.ts
 * PURPOSE: One source for the AI prompts counts (2026-11-18). The stats endpoint counted
 *          every candidate row ("3 being tested", "3 with no grades", "A/B running") while
 *          the scoreboard showed two steps with a test, both at 0% of traffic, and no grade
 *          anywhere. When the prompt list has loaded, the banner and the status line read
 *          the same steps the scoreboard draws.
 */

import type { PromptLabStats } from './PromptLabStatsTypes'
import type { PromptVersion } from './types'

interface PromptTestCounts {
  /** Versions in use (one per step). */
  inUse: number
  /** Steps with a test version (the scoreboard rows that show one). */
  stepsWithTest: number
  /** Steps whose test gets traffic but has no grade yet. */
  runningUngraded: number
  /** Steps whose test versions all sit at 0% of traffic: not started. */
  notStarted: number
  /** True when no version on the page has a grade. */
  noGrades: boolean
}

/** @internal Exported for tests. */
export function promptTestCounts(prompts: readonly PromptVersion[]): PromptTestCounts {
  const byStage = new Map<string, PromptVersion[]>()
  for (const p of prompts) {
    const list = byStage.get(p.stage) ?? []
    list.push(p)
    byStage.set(p.stage, list)
  }
  let stepsWithTest = 0
  let runningUngraded = 0
  let notStarted = 0
  for (const versions of byStage.values()) {
    const tests = versions.filter((p) => !p.is_active && p.is_candidate)
    if (tests.length === 0) continue
    stepsWithTest += 1
    const running = tests.filter((p) => p.traffic_percentage > 0)
    if (running.length === 0) notStarted += 1
    else if (running.some((p) => p.avg_judge_score == null)) runningUngraded += 1
  }
  return {
    inUse: prompts.filter((p) => p.is_active).length,
    stepsWithTest,
    runningUngraded,
    notStarted,
    noGrades: prompts.every((p) => p.avg_judge_score == null),
  }
}

const steps = (n: number) => `${n} step${n === 1 ? '' : 's'}`

/**
 * The stats with the prompt-list counts laid over them. Without a prompt list the
 * server's numbers stand. The posture follows the counts: "A/B running" only when a
 * test gets traffic; tests that all sit at 0% read as not started.
 */
export function reconcilePromptLabStats(stats: PromptLabStats, prompts: readonly PromptVersion[] | null | undefined): PromptLabStats {
  if (!prompts || prompts.length === 0) return stats
  const c = promptTestCounts(prompts)
  const next: PromptLabStats = {
    ...stats,
    activePrompts: c.inUse,
    candidatePrompts: c.stepsWithTest,
    untestedAbCount: c.runningUngraded,
  }
  if (stats.topPriority === 'untested_ab' || stats.topPriority === 'ab_running' || stats.topPriority === 'candidates_idle') {
    if (c.runningUngraded > 0) {
      next.topPriority = 'untested_ab'
      next.topPriorityLabel = `${steps(c.runningUngraded)} testing a version that has no grades yet.`
    } else if (c.notStarted > 0 && c.notStarted === c.stepsWithTest) {
      next.topPriority = 'candidates_idle'
      next.topPriorityLabel = `${steps(c.notStarted)} with a test version that gets 0% of traffic.`
    }
  }
  return next
}
