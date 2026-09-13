// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * agent-status-poll — Supabase Edge Function (verify_jwt = false, internal)
 *
 * Cron poller for CLOUD coding agents (cursor_cloud / github_cloud_agent).
 * Cursor v1 has no webhook yet and GitHub Agent Tasks never will, so every
 * `fix_attempts` row the fix-worker handed to a vendor is polled here until
 * it ends:
 *
 *   - candidates: agent ∈ DISPATCHABLE_CLOUD_AGENTS, status still open,
 *     pr_url NULL, started ≥ 2 min ago (the fix-worker's own bookkeeping and
 *     a v0 webhook get first shot) and < 24 h ago; 20 per tick, oldest first;
 *   - each is polled through its adapter (`_shared/agent-adapters.ts`) and
 *     the outcome applied with `applyCloudAgentOutcome` — the same
 *     idempotent path `cursor-webhook` and `webhooks-github-indexer` use, so
 *     a PR is written and announced exactly once;
 *   - a branch name learned while the agent is still working
 *     (GitHub `sessions[].head_ref`, Cursor `git.branches[].branch`) is
 *     copied onto `fix_attempts.branch_name` so the GitHub indexer can match
 *     the PR by head ref even before this poller sees it;
 *   - open attempts older than 24 h are failed ("gave up") so the dispatch
 *     job stops blocking re-dispatch of the report.
 *
 * Auth: `requireServiceRoleAuth` — invoked by pg_cron `mushi-agent-status-poll`
 * (migration 20260912007000, schedule `5-55/5 * * * *`) via
 * `public.mushi_runtime_supabase_url()` + `public.mushi_internal_auth_header()`.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getServiceClient } from '../_shared/db.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import {
  DISPATCHABLE_CLOUD_AGENTS,
  applyCloudAgentOutcome,
  getCloudAgentAdapter,
  pollResultToOutcome,
  type CloudAgentAdapter,
  type FixAttemptRow,
} from '../_shared/agent-adapters.ts'

const log = rootLog.child('agent-status-poll')

export const POLL_MIN_AGE_MS = 2 * 60_000
export const POLL_MAX_AGE_MS = 24 * 60 * 60_000
export const POLL_BATCH = 20
const OPEN_STATUSES = ['running', 'queued']
const ATTEMPT_COLUMNS =
  'id, project_id, report_id, agent, status, pr_url, branch_name, cursor_agent_id, cursor_run_id, github_task_id, github_task_url, external_agent_ref, started_at'

export interface PollSummary {
  scanned: number
  working: number
  prOpened: number
  completedNoPr: number
  failed: number
  expired: number
  errors: number
  skipped: number
}

export interface PollOptions {
  now?: Date
  /** Override for tests. */
  adapterFor?: (kind: string) => CloudAgentAdapter
}

export async function runAgentStatusPoll(db: SupabaseClient, opts: PollOptions = {}): Promise<PollSummary> {
  const now = opts.now ?? new Date()
  const adapterFor = opts.adapterFor ?? getCloudAgentAdapter
  const minAgeIso = new Date(now.getTime() - POLL_MIN_AGE_MS).toISOString()
  const maxAgeIso = new Date(now.getTime() - POLL_MAX_AGE_MS).toISOString()
  const kinds = [...DISPATCHABLE_CLOUD_AGENTS]
  const summary: PollSummary = {
    scanned: 0,
    working: 0,
    prOpened: 0,
    completedNoPr: 0,
    failed: 0,
    expired: 0,
    errors: 0,
    skipped: 0,
  }

  // 1. Give up on zombies (> 24 h open) so ALREADY_DISPATCHED stops blocking
  //    the report. Same batch cap as the poll loop.
  const { data: stale, error: staleErr } = await db
    .from('fix_attempts')
    .select(ATTEMPT_COLUMNS)
    .in('agent', kinds)
    .in('status', OPEN_STATUSES)
    .is('pr_url', null)
    .lt('started_at', maxAgeIso)
    .order('started_at', { ascending: true })
    .limit(POLL_BATCH)
  if (staleErr) {
    log.warn('stale attempt scan failed', { error: staleErr.message })
  }
  for (const row of (stale ?? []) as FixAttemptRow[]) {
    const applied = await applyCloudAgentOutcome(
      db,
      { attemptId: row.id, projectId: row.project_id, reportId: row.report_id, agent: row.agent },
      {
        kind: 'failed',
        error: `Cloud agent (${row.agent}) did not finish within 24 h; Mushi stopped polling. Check the vendor dashboard and re-dispatch when ready.`,
      },
    )
    if (applied.applied) summary.expired++
    else summary.skipped++
  }

  // 2. Poll the open ones.
  const { data: rows, error: rowsErr } = await db
    .from('fix_attempts')
    .select(ATTEMPT_COLUMNS)
    .in('agent', kinds)
    .in('status', OPEN_STATUSES)
    .is('pr_url', null)
    .lt('started_at', minAgeIso)
    .gte('started_at', maxAgeIso)
    .order('started_at', { ascending: true })
    .limit(POLL_BATCH)
  if (rowsErr) {
    log.error('open attempt scan failed', { error: rowsErr.message })
    return summary
  }

  for (const row of (rows ?? []) as FixAttemptRow[]) {
    summary.scanned++
    const target = { attemptId: row.id, projectId: row.project_id, reportId: row.report_id, agent: row.agent }
    try {
      const adapter = adapterFor(row.agent)
      const poll = await adapter.poll({ db, projectId: row.project_id, attempt: row })

      // Persist anything learned while polling (run id for v0 agents, a head
      // ref for GitHub tasks) so the next tick / the indexer can use it.
      const learned: Record<string, unknown> = {}
      if (poll.ref && typeof poll.ref.cursor_run_id === 'string' && !row.cursor_run_id) {
        learned.cursor_run_id = poll.ref.cursor_run_id
      }
      if (poll.branch && poll.branch !== row.branch_name) learned.branch_name = poll.branch
      if (poll.ref && Object.keys(poll.ref).length > 0) {
        learned.external_agent_ref = {
          ...((row.external_agent_ref ?? {}) as Record<string, unknown>),
          ...poll.ref,
          last_polled_at: now.toISOString(),
          last_poll_status: poll.status,
        }
      }
      if (Object.keys(learned).length > 0) {
        await db.from('fix_attempts').update(learned).eq('id', row.id)
      }

      const outcome = pollResultToOutcome(poll)
      if (!outcome) {
        summary.working++
        continue
      }
      const applied = await applyCloudAgentOutcome(db, target, outcome)
      if (!applied.applied) {
        summary.skipped++
        continue
      }
      if (outcome.kind === 'pr_opened') summary.prOpened++
      else if (outcome.kind === 'completed_no_pr') summary.completedNoPr++
      else summary.failed++
    } catch (err) {
      // Vendor hiccup or missing credentials: leave the row for the next tick.
      summary.errors++
      log.warn('poll failed for attempt (will retry next tick)', {
        fixAttemptId: row.id,
        agent: row.agent,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  log.info('agent-status-poll.done', { ...summary })
  return summary
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false, error: { code: 'METHOD_NOT_ALLOWED' } }), { status: 405 })
  }
  const unauthorized = requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

  const summary = await runAgentStatusPoll(getServiceClient())
  return new Response(JSON.stringify({ ok: true, data: summary }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('agent-status-poll', handler))
}
