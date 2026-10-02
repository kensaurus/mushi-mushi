/**
 * FILE: packages/server/supabase/functions/_shared/judge-eligibility.ts
 * PURPOSE: One definition of "what the judge can grade", shared by
 *          judge-batch (selection + empty-run reason), POST /v1/admin/judge/run
 *          (skip the paid dispatch when nothing is eligible) and the dashboard
 *          staleness flag (don't demand a re-run that would grade nothing).
 *
 * Before this module the staleness flag was purely time-based: a project whose
 * only report was already graded showed "Judge scores are 335h old" forever,
 * and every "Run quality check" click returned 200 with 0 evaluations.
 */

/** Report statuses judge-batch samples from (it also requires judge_evaluated_at IS NULL). */
export const JUDGE_ELIGIBLE_STATUSES = ['classified', 'grouped', 'fixing', 'fixed'] as const

/** Scores older than this count as stale — but only while there is something new to grade. */
export const JUDGE_STALE_AFTER_HOURS = 48

export type JudgeEmptyReason = 'no_projects' | 'judge_disabled' | 'nothing_to_grade'

export interface JudgeEmptyResult {
  evaluated: 0
  reason: JudgeEmptyReason
  message: string
}

/**
 * Explains a run that evaluates nothing. Returns null when there was work to
 * do, so a 0 caused by LLM failures still surfaces as an error, not as
 * "nothing to grade".
 */
export function judgeEmptyResult(input: {
  projectsChecked: number
  judgeEnabledProjects: number
  eligibleReports: number
}): JudgeEmptyResult | null {
  if (input.projectsChecked === 0) {
    return { evaluated: 0, reason: 'no_projects', message: 'No project to grade.' }
  }
  if (input.judgeEnabledProjects === 0) {
    return {
      evaluated: 0,
      reason: 'judge_disabled',
      message: 'The quality judge is turned off for this project. Turn it on in Settings to grade new reports.',
    }
  }
  if (input.eligibleReports === 0) {
    return {
      evaluated: 0,
      reason: 'nothing_to_grade',
      message: 'Nothing new to grade: every classified report already has a judge score.',
    }
  }
  return null
}

/**
 * Stale means "old scores AND ungraded reports waiting". With nothing eligible
 * a re-run is a no-op, so the inbox must not ask for one.
 */
export function isJudgeStale(input: { judgeStaleHours: number | null; ungradedReports: number }): boolean {
  if (input.ungradedReports <= 0) return false
  return input.judgeStaleHours == null || input.judgeStaleHours > JUDGE_STALE_AFTER_HOURS
}
