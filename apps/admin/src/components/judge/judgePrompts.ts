/**
 * FILE: apps/admin/src/components/judge/judgePrompts.ts
 * PURPOSE: The Triage grading "Prompts" tab, read honestly (round-2 review, 2026-11-18):
 *          - fifteen flat rows printed Score "–" and Evals "0" for every version while the
 *            Grades tab held 2 grades: the per-version counts were never linked, so a 0 there
 *            is unknown, not zero;
 *          - Diagnosis printed 100% for the version in use beside a test at 50% (150%);
 *          - ten steps that only run their built-in version repeated one row each.
 *          Rows are grouped by step, the split adds up, and unlinked counts say so once.
 */

import { effectiveTraffic } from '../prompt-lab/promptLabCounts'
import { STAGE_LABELS } from '../prompt-lab/types'

export interface JudgePromptRow {
  id: string
  project_id: string | null
  stage: string
  version: string
  is_active: boolean
  is_candidate: boolean
  traffic_percentage: number
  avg_judge_score: number | null
  total_evaluations: number
  created_at: string
}

export interface JudgePromptStep {
  stage: string
  label: string
  /** Versions in this step, in use first, each with the share it really gets. */
  rows: Array<JudgePromptRow & { share: number }>
}

const STAGE_ORDER = [
  'stage1', 'stage2', 'judge', 'fix', 'intelligence',
  'nl_plan', 'nl_summary', 'synthetic', 'modernizer', 'prompt_tune',
]

function stageRank(stage: string): number {
  const i = STAGE_ORDER.indexOf(stage)
  return i === -1 ? STAGE_ORDER.length : i
}

/**
 * Steps that test a version or have grades get their own group; steps that only run one
 * ungraded version fold into `baselineOnly`.
 */
export function groupJudgePrompts(prompts: readonly JudgePromptRow[]): { steps: JudgePromptStep[]; baselineOnly: JudgePromptStep[] } {
  const byStage = new Map<string, JudgePromptRow[]>()
  for (const p of prompts) {
    const list = byStage.get(p.stage) ?? []
    list.push(p)
    byStage.set(p.stage, list)
  }
  const ordered = [...byStage.entries()].sort(
    ([a], [b]) => stageRank(a) - stageRank(b) || a.localeCompare(b),
  )
  const steps: JudgePromptStep[] = []
  const baselineOnly: JudgePromptStep[] = []
  for (const [stage, versions] of ordered) {
    const rows = [...versions]
      .sort((a, b) => Number(b.is_active) - Number(a.is_active) || b.traffic_percentage - a.traffic_percentage)
      .map((p) => ({ ...p, share: effectiveTraffic(p, versions) }))
    const step = { stage, label: STAGE_LABELS[stage] ?? stage, rows }
    const tested = versions.some((p) => !p.is_active && p.is_candidate)
    const graded = versions.some((p) => p.avg_judge_score != null || p.total_evaluations > 0)
    if (tested || graded) steps.push(step)
    else baselineOnly.push(step)
  }
  return { steps, baselineOnly }
}

/**
 * True when the per-version scores can be trusted. Grades exist (`totalEvaluations` from the
 * stats route) but no version counts any of them: the link from grade to version is missing,
 * so every "0 evals" on the tab would be false.
 */
export function promptGradesLinked(prompts: readonly JudgePromptRow[], totalEvaluations: number): boolean {
  if (totalEvaluations <= 0) return true
  return prompts.some((p) => p.total_evaluations > 0 || p.avg_judge_score != null)
}

/**
 * Whether a trend can be drawn. One week of grades drew a single dot at the top edge of an
 * empty 12-week chart (round-2 review, 2026-11-18); under two weeks the page says the number.
 */
export function canDrawTrend(weekCount: number): boolean {
  return weekCount >= 2
}
