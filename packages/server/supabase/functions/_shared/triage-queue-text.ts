/**
 * FILE: packages/server/supabase/functions/_shared/triage-queue-text.ts
 * PURPOSE: The small part of the report pipeline trail that the unified
 *          timeline (served by `api`) needs: the processing_queue row shape,
 *          its columns, and its errors and states in plain words.
 *
 *          Split out of report-pipeline-trail.ts so `api` does not bundle
 *          the whole trail builder; the trail routes are served by api-ext
 *          (api upload budget, scripts/deploy-edge-function.test.mjs).
 *          report-pipeline-trail.ts re-exports everything here.
 */

import { sanitizeLlmError } from './llm-error-sanitize.ts'

export interface TrailQueueRow {
  id: string
  stage: string
  status: string
  attempts: number | null
  max_attempts: number | null
  last_error: string | null
  scheduled_at?: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export const TRAIL_QUEUE_COLUMNS = 'id, stage, status, attempts, max_attempts, last_error, scheduled_at, created_at, started_at, completed_at'

const DETAIL_MAX = 600

/** Screen and cut raw error text before it leaves the server. */
export function screenDetail(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null
  const clean = sanitizeLlmError(raw).trim()
  return clean.length > DETAIL_MAX ? `${clean.slice(0, DETAIL_MAX)}…` : clean
}

/**
 * A triage error (queue `last_error` or `reports.processing_error`) in one
 * plain line. Order matters: a budget 402 says "budget", not "crashed".
 */
export function plainTriageError(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null
  const m = raw.toLowerCase()
  if (/stage2 handoff failed/.test(m)) return 'The quick check worked, but handing the report to the full diagnosis failed.'
  if (/budget|spend cap|spend limit|quota|\b402\b|insufficient_quota|credit/.test(m)) return 'The AI budget or quota is used up, so triage stopped.'
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden|invalid[ _-]?api[ _-]?key|incorrect api key|authentication/.test(m)) return 'The AI key or the internal worker token was refused.'
  if (/\b429\b|rate.?limit|too many requests/.test(m)) return 'The AI provider asked Mushi Mushi to slow down (rate limit).'
  if (/time(d)?[ _-]?out|timeout|abort|idle/.test(m)) return 'Triage took too long and was stopped.'
  if (/stage1_llm_unavailable|no (ai|llm) key|no key|missing key|not configured/.test(m)) return 'No AI model was available for triage.'
  if (/fetch failed|network|econn|enotfound|dns|connection (refused|reset)/.test(m)) return 'Mushi Mushi could not reach its triage worker.'
  if (/\b404\b|not found/.test(m)) return 'The triage worker could not find this report.'
  if (/\b5\d\d\b|unhandled|internal server error|stage1_unhandled/.test(m)) return 'The triage worker crashed on this report.'
  return 'Triage failed for a reason Mushi Mushi does not recognise yet.'
}

/** A queue job's state in the timeline's words ("Quick check failed · attempt 2 of 3"). */
export function queueJobTimelineTitle(job: Pick<TrailQueueRow, 'stage' | 'status' | 'attempts' | 'max_attempts'>): string {
  const name = job.stage === 'stage1' ? 'Quick check' : `Triage job (${job.stage})`
  const word: Record<string, string> = {
    pending: 'waiting for the worker',
    processing: 'running',
    running: 'running',
    completed: 'done',
    failed: 'failed',
    dead_letter: 'gave up',
  }
  const tries = (job.attempts ?? 0) > 0 ? ` · attempt ${job.attempts} of ${job.max_attempts ?? 3}` : ''
  return `${name} ${word[job.status] ?? job.status}${tries}`
}
