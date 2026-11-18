/**
 * FILE: apps/admin/src/components/prompt-lab/promptLabCounts.ts
 * PURPOSE: One source for the AI prompts counts (2026-11-18). The stats endpoint counted
 *          every candidate row ("3 being tested", "3 with no grades", "A/B running") while
 *          the scoreboard showed two steps with a test, both at 0% of traffic, and no grade
 *          anywhere. When the prompt list has loaded, the banner and the status line read
 *          the same steps the scoreboard draws.
 */

import type { PromptLabStats } from './PromptLabStatsTypes'
import { STAGE_LABELS, type PromptVersion } from './types'

/** Where one step's test stands. */
type StepTestState = 'none' | 'not_started' | 'running_ungraded' | 'running_graded'

export interface StepTest {
  active: PromptVersion | null
  /** The test version the page shows for this step. */
  candidate: PromptVersion | null
  state: StepTestState
}

/**
 * The one reading of a step's test, used by the scoreboard, the banner and the status line
 * (round-2 review, 2026-11-18). Diagnosis had one test at 0% and one at 50%: the scoreboard
 * picked the 0% one by grade and said "Not started" while the counts saw the 50% one and
 * said "A/B running". A test that gets traffic now wins the pick, so the row and the counts
 * describe the same version.
 */
export function stepTest(versions: readonly PromptVersion[]): StepTest {
  const active = versions.find((p) => p.is_active) ?? null
  const tests = versions.filter((p) => !p.is_active && p.is_candidate)
  const candidate =
    [...tests].sort(
      (a, b) =>
        Number(b.traffic_percentage > 0) - Number(a.traffic_percentage > 0) ||
        (b.avg_judge_score ?? -1) - (a.avg_judge_score ?? -1) ||
        b.total_evaluations - a.total_evaluations,
    )[0] ?? null
  const state: StepTestState = !candidate
    ? 'none'
    : !(candidate.traffic_percentage > 0)
      ? 'not_started'
      : candidate.avg_judge_score == null
        ? 'running_ungraded'
        : 'running_graded'
  return { active, candidate, state }
}

/**
 * The share a version really gets. Tests take their percentage and the version in use keeps
 * the rest: Diagnosis printed "100%" for the version in use beside a test at 50%, which reads
 * as 150% (round-2 review, 2026-11-18).
 */
type TrafficFields = Pick<PromptVersion, 'is_active' | 'is_candidate' | 'traffic_percentage'>

export function effectiveTraffic(p: TrafficFields, stepVersions: readonly TrafficFields[]): number {
  if (!p.is_active) return p.traffic_percentage
  const tested = stepVersions
    .filter((v) => !v.is_active && v.is_candidate)
    .reduce((sum, v) => sum + Math.max(0, v.traffic_percentage), 0)
  return Math.max(0, Math.min(100, 100 - tested))
}

function groupByStage(prompts: readonly PromptVersion[]): Map<string, PromptVersion[]> {
  const byStage = new Map<string, PromptVersion[]>()
  for (const p of prompts) {
    const list = byStage.get(p.stage) ?? []
    list.push(p)
    byStage.set(p.stage, list)
  }
  return byStage
}

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
  /** Step names per state, for a banner that names them instead of counting twice. */
  runningSteps: string[]
  notStartedSteps: string[]
}

/** @internal Exported for tests. */
export function promptTestCounts(prompts: readonly PromptVersion[]): PromptTestCounts {
  let stepsWithTest = 0
  const runningSteps: string[] = []
  const notStartedSteps: string[] = []
  for (const [stage, versions] of groupByStage(prompts)) {
    const t = stepTest(versions)
    if (t.state === 'none') continue
    stepsWithTest += 1
    const name = STAGE_LABELS[stage] ?? stage
    if (t.state === 'not_started') notStartedSteps.push(name)
    else if (t.state === 'running_ungraded') runningSteps.push(name)
  }
  return {
    inUse: prompts.filter((p) => p.is_active).length,
    stepsWithTest,
    runningUngraded: runningSteps.length,
    notStarted: notStartedSteps.length,
    noGrades: prompts.every((p) => p.avg_judge_score == null),
    runningSteps,
    notStartedSteps,
  }
}

const list = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/**
 * The stats with the prompt-list counts laid over them. Without a prompt list the
 * server's numbers stand. The posture follows the scoreboard: "running" only when the
 * test the scoreboard shows gets traffic. The label names the steps, so it can never
 * say "1 step" beside a tile of 2 (round-2 review, 2026-11-18).
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
      const idle = c.notStarted > 0 ? ` ${list(c.notStartedSteps)}: test not started (0% of traffic).` : ''
      next.topPriorityLabel = `${list(c.runningSteps)}: test gets traffic, waiting for its first grades.${idle}`
    } else if (c.notStarted > 0 && c.notStarted === c.stepsWithTest) {
      next.topPriority = 'candidates_idle'
      next.topPriorityLabel = `${list(c.notStartedSteps)}: test gets 0% of traffic, so it never runs.`
    }
  }
  return next
}
