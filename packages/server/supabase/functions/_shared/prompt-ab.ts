/**
 * FILE: prompt-ab.ts
 * PURPOSE: Prompt A/B testing infrastructure for staged classification pipeline.
 *
 * OVERVIEW:
 * - Supports A/B testing custom prompt templates per project and stage
 * - Traffic splitting based on configurable percentage on candidate prompts
 * - Running-average score tracking per prompt version via judge evaluations
 * - Automatic promotion of candidates that outperform the active prompt
 *
 * DEPENDENCIES:
 * - Supabase JS client (SupabaseClient from @supabase/supabase-js)
 * - `prompt_versions` table in Supabase
 *
 * USAGE:
 *   import { getPromptForStage, recordPromptResult, checkPromotionEligibility, promoteCandidate } from '../_shared/prompt-ab.ts'
 *
 *   const { promptTemplate, promptVersion, isCandidate } = await getPromptForStage(db, projectId, 'stage1')
 *   await recordPromptResult(db, reportId, promptVersion, 0.87)
 *   const eligibility = await checkPromotionEligibility(db, projectId, 'stage1')
 *   if (eligibility.shouldPromote) await promoteCandidate(db, projectId, 'stage1', promptVersion)
 *
 * TECHNICAL DETAILS:
 * - getPromptForStage: queries active + candidate rows, routes traffic probabilistically
 * - recordPromptResult: incremental running-average update (no full re-scan)
 * - checkPromotionEligibility: requires >= 30 evals and > 5% score lift
 * - promoteCandidate: atomic swap of active/candidate flags
 *
 * NOTES:
 * - Returns null promptTemplate when no prompt_versions row exists (caller keeps hardcoded default)
 * - project_id NULL rows act as global defaults (queried when no project-specific row found)
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from './logger.ts'
import {
  DEFAULT_JUDGE_RUBRIC as PURE_DEFAULT_JUDGE_RUBRIC,
  resolveJudgeWeights as pureResolveJudgeWeights,
  type JudgeRubric as PureJudgeRubric,
} from './judge-rubric.ts'

// Re-export the pure helpers so existing call-sites keep importing from
// prompt-ab.ts while the vitest (Node) test suite can pull them from the
// dedicated file that has zero Deno-only imports.
export const DEFAULT_JUDGE_RUBRIC = PURE_DEFAULT_JUDGE_RUBRIC
export const resolveJudgeWeights = pureResolveJudgeWeights
export type JudgeRubric = PureJudgeRubric

const log = rootLog.child('prompt-ab')

// ── Types ────────────────────────────────────────────────────────────────────

export interface PromptSelection {
  promptTemplate: string | null
  promptVersion: string | null
  isCandidate: boolean
  judgeRubric: PureJudgeRubric | null
}

export interface PromotionEligibility {
  shouldPromote: boolean
  candidateScore: number
  activeScore: number
  reason: string
}

interface PromptVersionRow {
  id: string
  version: string
  prompt_template: string
  is_active: boolean
  is_candidate: boolean
  traffic_percentage: number
  avg_judge_score: number | null
  total_evaluations: number
  judge_rubric?: PureJudgeRubric | null
}

const MIN_EVALUATIONS_FOR_PROMOTION = 30
const MIN_SCORE_LIFT_PERCENT = 5

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve which prompt template to use for a given project + stage.
 * Falls back to global defaults (project_id IS NULL) when no project-specific row exists.
 * Returns null fields when no prompt_versions rows exist at all (caller should keep its hardcoded prompt).
 */
export async function getPromptForStage(
  db: SupabaseClient,
  projectId: string,
  stage: string,
): Promise<PromptSelection> {
  // Wave S (2026-04-23): include judge_rubric so callers (judge-batch) can
  // honour per-prompt weight overrides without a second query. The column
  // was added in migration 20260422110000 and is always selectable (nullable
  // jsonb) — no conditional needed.
  let { data: rows } = await db
    .from('prompt_versions')
    .select('id, version, prompt_template, is_active, is_candidate, traffic_percentage, judge_rubric')
    .eq('project_id', projectId)
    .eq('stage', stage)
    .or('is_active.eq.true,is_candidate.eq.true')

  // Fall back to global defaults when no project-specific rows
  if (!rows?.length) {
    const { data: globalRows } = await db
      .from('prompt_versions')
      .select('id, version, prompt_template, is_active, is_candidate, traffic_percentage, judge_rubric')
      .is('project_id', null)
      .eq('stage', stage)
      .or('is_active.eq.true,is_candidate.eq.true')
    rows = globalRows
  }

  if (!rows?.length) {
    return { promptTemplate: null, promptVersion: null, isCandidate: false, judgeRubric: null }
  }

  const active = rows.find((r: PromptVersionRow) => r.is_active && !r.is_candidate)
  const candidate = rows.find((r: PromptVersionRow) => r.is_candidate)

  if (!active) {
    const first = rows[0] as PromptVersionRow
    return {
      promptTemplate: first.prompt_template,
      promptVersion: first.version,
      isCandidate: first.is_candidate,
      judgeRubric: first.judge_rubric ?? null,
    }
  }

  if (!candidate) {
    return {
      promptTemplate: active.prompt_template,
      promptVersion: active.version,
      isCandidate: false,
      judgeRubric: active.judge_rubric ?? null,
    }
  }

  // Route traffic probabilistically based on candidate's traffic_percentage
  const roll = Math.random() * 100
  if (roll < (candidate.traffic_percentage ?? 0)) {
    log.info('Routing to candidate prompt', { stage, version: candidate.version, roll: roll.toFixed(1) })
    return {
      promptTemplate: candidate.prompt_template,
      promptVersion: candidate.version,
      isCandidate: true,
      judgeRubric: candidate.judge_rubric ?? null,
    }
  }

  return {
    promptTemplate: active.prompt_template,
    promptVersion: active.version,
    isCandidate: false,
    judgeRubric: active.judge_rubric ?? null,
  }
}


/**
 * Record a judge score against a prompt version using an incremental running average.
 * Formula: new_avg = ((old_avg * old_count) + new_score) / (old_count + 1)
 *
 * V5.3 §2.7 fix (M-cross-cutting): MUST filter by project_id and stage as well
 * as version. Prior to this, two projects sharing a version string like "v1"
 * would write to the wrong row, corrupting both projects' running averages.
 * If projectId is omitted, we restrict to global rows (project_id IS NULL).
 */
export async function recordPromptResult(
  db: SupabaseClient,
  _reportId: string,
  promptVersion: string,
  judgeScore: number,
  scope?: { projectId?: string | null; stage?: string },
): Promise<void> {
  if (!promptVersion) return

  let query = db
    .from('prompt_versions')
    .select('id, avg_judge_score, total_evaluations')
    .eq('version', promptVersion)
  query = scope?.projectId ? query.eq('project_id', scope.projectId) : query.is('project_id', null)
  if (scope?.stage) query = query.eq('stage', scope.stage)

  const { data: rows, error: fetchErr } = await query
  if (fetchErr) {
    log.warn('prompt_versions lookup failed', { promptVersion, error: fetchErr.message })
    return
  }
  if (!rows || rows.length === 0) {
    log.warn('prompt_versions row not found for scope', { promptVersion, projectId: scope?.projectId, stage: scope?.stage })
    return
  }
  if (rows.length > 1) {
    // Defensive: the (project_id, stage, version) unique constraint should make
    // this impossible after migration 20260418000700 — keep the guard so older
    // databases don't silently corrupt the running average.
    log.error('Multiple prompt_versions rows match scope; refusing to update to avoid corruption', {
      promptVersion, projectId: scope?.projectId, stage: scope?.stage, count: rows.length,
    })
    return
  }
  const row = rows[0]

  const oldAvg = row.avg_judge_score ?? 0
  const oldCount = row.total_evaluations ?? 0
  const newAvg = ((oldAvg * oldCount) + judgeScore) / (oldCount + 1)

  const { error: updateErr } = await db
    .from('prompt_versions')
    .update({
      avg_judge_score: newAvg,
      total_evaluations: oldCount + 1,
    })
    .eq('id', row.id)

  if (updateErr) {
    log.error('Failed to update prompt version score', { promptVersion, error: updateErr.message })
  }
}

/**
 * Promote a candidate prompt to active, deactivating the previous active prompt.
 */
export async function promoteCandidate(
  db: SupabaseClient,
  projectId: string,
  stage: string,
  candidateVersion: string,
): Promise<void> {
  // Deactivate old active prompt
  await db
    .from('prompt_versions')
    .update({ is_active: false })
    .eq('project_id', projectId)
    .eq('stage', stage)
    .eq('is_active', true)
    .neq('version', candidateVersion)

  // Promote candidate
  const { error } = await db
    .from('prompt_versions')
    .update({
      is_active: true,
      is_candidate: false,
      traffic_percentage: 100,
    })
    .eq('project_id', projectId)
    .eq('stage', stage)
    .eq('version', candidateVersion)

  if (error) {
    log.error('Failed to promote candidate', { projectId, stage, candidateVersion, error: error.message })
  } else {
    log.info('Candidate promoted to active', { projectId, stage, candidateVersion })
  }
}

/**
 * Check whether the candidate prompt for a project+stage is eligible for automatic promotion.
 * Requirements: >= 30 evaluations and > 5% score lift over the current active prompt.
 */
export async function checkPromotionEligibility(
  db: SupabaseClient,
  projectId: string,
  stage: string,
): Promise<PromotionEligibility> {
  const { data: rows } = await db
    .from('prompt_versions')
    .select('version, is_active, is_candidate, avg_judge_score, total_evaluations')
    .eq('project_id', projectId)
    .eq('stage', stage)
    .or('is_active.eq.true,is_candidate.eq.true')

  const noAction: PromotionEligibility = { shouldPromote: false, candidateScore: 0, activeScore: 0, reason: '' }

  if (!rows?.length) return { ...noAction, reason: 'No prompt versions found' }

  const active = rows.find((r: PromptVersionRow) => r.is_active && !r.is_candidate)
  const candidate = rows.find((r: PromptVersionRow) => r.is_candidate)

  if (!candidate) return { ...noAction, reason: 'No candidate prompt' }
  if (!active) return { ...noAction, reason: 'No active prompt to compare against' }

  const candidateScore = candidate.avg_judge_score ?? 0
  const activeScore = active.avg_judge_score ?? 0
  const candidateEvals = candidate.total_evaluations ?? 0

  if (candidateEvals < MIN_EVALUATIONS_FOR_PROMOTION) {
    return {
      shouldPromote: false,
      candidateScore,
      activeScore,
      reason: `Candidate has ${candidateEvals}/${MIN_EVALUATIONS_FOR_PROMOTION} required evaluations`,
    }
  }

  if (activeScore <= 0) {
    return {
      shouldPromote: candidateScore > 0,
      candidateScore,
      activeScore,
      reason: activeScore <= 0 && candidateScore > 0
        ? 'Active prompt has no score data; candidate has positive score'
        : 'Both prompts have no score data',
    }
  }

  const liftPct = ((candidateScore - activeScore) / activeScore) * 100

  if (liftPct > MIN_SCORE_LIFT_PERCENT) {
    return {
      shouldPromote: true,
      candidateScore,
      activeScore,
      reason: `Candidate score ${candidateScore.toFixed(3)} is ${liftPct.toFixed(1)}% higher than active ${activeScore.toFixed(3)} (>${MIN_SCORE_LIFT_PERCENT}% threshold)`,
    }
  }

  return {
    shouldPromote: false,
    candidateScore,
    activeScore,
    reason: `Score lift ${liftPct.toFixed(1)}% is below ${MIN_SCORE_LIFT_PERCENT}% threshold`,
  }
}
