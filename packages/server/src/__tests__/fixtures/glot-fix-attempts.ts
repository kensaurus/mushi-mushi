/**
 * glot.it fix attempts and report states as read from production on
 * 2026-10-04 (read-only SELECT, project 542b34e0). Ids and errors are
 * trimmed and merged_at times are placeholders (only their presence
 * matters); statuses, PR states, PR numbers and created_at are exact.
 *
 * Truth on that day:
 *   - 4 reports fixed by merged PRs #138, #139, #140, #141;
 *   - 1 report still classified whose only attempt was skipped because the
 *     OpenAI embedding key was rejected (401);
 *   - 0 open PRs.
 * The console read "8 auto-fixes failed", "OPEN PRS 7" and "Retry 8 failed".
 */

import type { TruthAttempt, TruthReport } from '../../../supabase/functions/_shared/fix-report-truth.ts'

const R_SKIP = '323e8956-1d17-4071-a504-4782e5092cac'
const R_FETCH = '6f1974ea-5f88-4e33-a674-fe09a9ab6a0f'
const R_LCP = '9c848825-1651-4ddc-bf1b-1566a1499a4c'
const R_CLS = 'dfd633bd-6854-425c-9df3-a115b3ec0087'
const R_AUDIO = '030bcf3d-5f28-4d79-8198-dea8ae65b0cc'

export const GLOT_REPORT_IDS = { R_SKIP, R_FETCH, R_LCP, R_CLS, R_AUDIO }

export const GLOT_REPORTS: TruthReport[] = [
  { id: R_SKIP, status: 'fixed' },
  { id: R_FETCH, status: 'fixed' },
  { id: R_LCP, status: 'fixed' },
  { id: R_CLS, status: 'fixed' },
  { id: R_AUDIO, status: 'classified' },
]

const REVIEW_FAILED = 'review_failed: the fix model flagged its own change for human review.'
const CURSOR_400 = 'Cursor API 400 validation_error: envVars cannot be combined with a client-supplied agentId'

export const GLOT_ATTEMPTS: TruthAttempt[] = [
  {
    id: '68b85f04', report_id: R_AUDIO, status: 'skipped_no_context', failure_category: 'no_relevant_code',
    error: 'RAG embedding call failed (Error: Embedding API error: 401 from api.openai.com for model text-embedding-3-small: Incorrect API key provided)',
    created_at: '2026-09-23T02:26:10Z',
  },
  { id: '61493b01', report_id: R_SKIP, status: 'failed', error: REVIEW_FAILED, created_at: '2026-10-03T09:00:04Z' },
  { id: 'aa713533', report_id: R_SKIP, status: 'failed', error: "review_failed: the fix's edits could not be applied", created_at: '2026-10-03T09:47:47Z' },
  { id: 'a394448f', report_id: R_SKIP, status: 'failed', error: CURSOR_400, created_at: '2026-10-03T10:04:06Z' },
  {
    id: 'ca33c5d3', report_id: R_SKIP, status: 'completed', pr_url: 'https://github.com/kensaurus/glot.it/pull/141',
    pr_number: 141, pr_state: 'merged', merged_at: '2026-10-03T12:00:00Z', created_at: '2026-10-03T10:07:49Z',
  },
  { id: '5cef995a', report_id: R_FETCH, status: 'failed', error: REVIEW_FAILED, created_at: '2026-10-03T08:59:21Z' },
  { id: '83946055', report_id: R_FETCH, status: 'failed', error: REVIEW_FAILED, created_at: '2026-10-03T09:43:02Z' },
  {
    id: '2a60301d', report_id: R_FETCH, status: 'completed', pr_url: 'https://github.com/kensaurus/glot.it/pull/135',
    pr_number: 135, pr_state: 'closed', created_at: '2026-10-03T09:46:24Z',
  },
  {
    id: '08b50098', report_id: R_FETCH, status: 'completed', pr_url: 'https://github.com/kensaurus/glot.it/pull/138',
    pr_number: 138, pr_state: 'merged', merged_at: '2026-10-03T12:00:00Z', created_at: '2026-10-03T10:01:23Z',
  },
  { id: 'd2e37d24', report_id: R_LCP, status: 'failed', error: REVIEW_FAILED, created_at: '2026-10-03T09:00:39Z' },
  {
    id: '920aaea6', report_id: R_LCP, status: 'completed', pr_url: 'https://github.com/kensaurus/glot.it/pull/137',
    pr_number: 137, pr_state: 'closed', created_at: '2026-10-03T09:48:20Z',
  },
  { id: '3ba49227', report_id: R_LCP, status: 'failed', error: CURSOR_400, created_at: '2026-10-03T10:04:07Z' },
  {
    id: '2d7c5a18', report_id: R_LCP, status: 'completed', pr_url: 'https://github.com/kensaurus/glot.it/pull/140',
    pr_number: 140, pr_state: 'merged', merged_at: '2026-10-03T12:00:00Z', created_at: '2026-10-03T10:07:51Z',
  },
  { id: '7f051471', report_id: R_CLS, status: 'failed', error: REVIEW_FAILED, created_at: '2026-10-03T09:00:20Z' },
  {
    id: 'a97b9665', report_id: R_CLS, status: 'completed', pr_url: 'https://github.com/kensaurus/glot.it/pull/136',
    pr_number: 136, pr_state: 'closed', created_at: '2026-10-03T09:48:03Z',
  },
  {
    id: '978c118c', report_id: R_CLS, status: 'completed', pr_url: 'https://github.com/kensaurus/glot.it/pull/139',
    pr_number: 139, pr_state: 'merged', merged_at: '2026-10-03T12:00:00Z', created_at: '2026-10-03T10:01:38Z',
  },
]
