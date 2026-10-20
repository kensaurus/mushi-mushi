/**
 * The independent Opus review of a cloud agent's pull request (ADR 0030), as
 * the console shows it. The server shape is `PublicFixReview` in
 * packages/server/supabase/functions/_shared/fix-review.ts; it rides on
 * GET /v1/admin/fixes/:id/timeline (`data.review`).
 */

import { apiFetch } from './supabase'

export type FixReviewState = 'not_reviewed' | 'queued' | 'merge' | 'fix_first' | 'hold' | 'skipped' | 'failed'

interface FixReviewFinding {
  severity: 'blocker' | 'major' | 'minor'
  file: string
  line: number | null
  issue: string
  suggested_fix: string
}

export interface FixReview {
  state: FixReviewState
  label: string
  verdict: 'merge' | 'fix_first' | 'hold' | null
  fixesReport: boolean | null
  risk: 'low' | 'med' | 'high' | null
  findings: FixReviewFinding[]
  scopeCreep: boolean | null
  removesBehavior: string[]
  needsHumanDecision: string | null
  summary: string | null
  rulesApplied: string[]
  reason: string | null
  headSha: string | null
  diffTruncated: boolean
  model: string | null
  costUsd: number | null
  commentUrl: string | null
  reviewedAt: string | null
}

const NOT_REVIEWED: FixReview = {
  state: 'not_reviewed',
  label: 'Not reviewed',
  verdict: null,
  fixesReport: null,
  risk: null,
  findings: [],
  scopeCreep: null,
  removesBehavior: [],
  needsHumanDecision: null,
  summary: null,
  rulesApplied: [],
  reason: null,
  headSha: null,
  diffTruncated: false,
  model: null,
  costUsd: null,
  commentUrl: null,
  reviewedAt: null,
}

/** Chip tone per state: hold is the only one that blocks a merge. */
export function reviewTone(state: FixReviewState): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (state === 'merge') return 'ok'
  if (state === 'fix_first') return 'warn'
  if (state === 'hold') return 'danger'
  return 'neutral'
}

/** True when merging needs the explicit "merge anyway" override. */
export function reviewBlocksMerge(review: Pick<FixReview, 'state'> | null | undefined): boolean {
  return review?.state === 'hold'
}

/** "Re-run review" is offered unless a review is already running. */
export function canRerunReview(review: Pick<FixReview, 'state'> | null | undefined): boolean {
  return review?.state !== 'queued'
}

export async function fetchFixReview(fixId: string): Promise<{ ok: true; review: FixReview } | { ok: false; error: string }> {
  const res = await apiFetch<{ review?: FixReview }>(`/v1/admin/fixes/${fixId}/timeline`)
  if (!res.ok) return { ok: false, error: res.error?.message ?? 'Could not load the review' }
  return { ok: true, review: res.data?.review ?? NOT_REVIEWED }
}

export async function rerunFixReview(fixId: string): Promise<{ ok: true; review: FixReview } | { ok: false; error: string }> {
  const res = await apiFetch<{ review?: FixReview }>(`/v1/admin/fixes/${fixId}/review`, { method: 'POST' })
  if (!res.ok) return { ok: false, error: res.error?.message ?? 'Could not start the review' }
  return { ok: true, review: res.data?.review ?? { ...NOT_REVIEWED, state: 'queued', label: 'Review in progress' } }
}
