/**
 * FILE: apps/admin/src/lib/judgeFilters.ts
 * PURPOSE: The /judge Evaluations request and the Run-judge confirm copy
 *          (console QA group C, 2026-10-04).
 *
 * Every filter runs on the server (`/v1/admin/judge/evaluations`) over all
 * evaluations. Filtering the latest 50 in the browser made "Disagreements
 * only" show a few rows next to a badge counting every disagreement, and a
 * prompt row's stage was dropped, so stage 1 "v3" also listed stage 2 "v3".
 */

export interface JudgeEvalQuery {
  sort: 'recent' | 'score_asc'
  page: number
  pageSize: number
  disagreementOnly: boolean
  prompt: { version: string; stage: string } | null
  from: string | null
  to: string | null
}

export function judgeEvaluationsPath(q: JudgeEvalQuery): string {
  const params = new URLSearchParams({
    limit: String(q.pageSize),
    page: String(Math.max(1, q.page)),
    sort: q.sort,
  })
  if (q.disagreementOnly) params.set('disagreement', '1')
  if (q.prompt) {
    params.set('prompt_version', q.prompt.version)
    if (q.prompt.stage) params.set('prompt_stage', q.prompt.stage)
  }
  if (q.from && q.to) {
    params.set('from', q.from)
    params.set('to', q.to)
  }
  return `/v1/admin/judge/evaluations?${params.toString()}`
}

/** What one click on "Run judge now" does, before it spends anything. */
export function judgeRunConfirmBody(ungradedReports: number): string {
  if (ungradedReports > 0) {
    return `The judge grades the ${ungradedReports} classified report${ungradedReports === 1 ? '' : 's'} it has not scored yet. Each grade is one LLM call on your key. Scores appear here within a few minutes.`
  }
  return 'Every classified report already has a score, so this run will likely grade nothing. The nightly run picks up new reports by itself.'
}
