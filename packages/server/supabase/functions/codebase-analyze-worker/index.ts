/**
 * HTTP entrypoint for codebase analyze jobs.
 *
 *   POST { jobId }   run that one job (the push indexer and Re-analyze kick).
 *   POST { limit? }  drain the queue: requeue stale 'running' jobs, then run
 *                    the oldest queued ones (pg_cron every 10 minutes,
 *                    migration 20261007141000). Answers 202 at once and keeps
 *                    working under EdgeRuntime.waitUntil.
 */

import { Hono } from 'npm:hono@4'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { withSentry } from '../_shared/sentry.ts'
import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { runInBackground } from '../_shared/background.ts'
import {
  analyzeDrainLimit,
  drainCodebaseAnalyzeJobs,
  runCodebaseAnalyzeJob,
} from '../_shared/codebase-analyze-runner.ts'

const wlog = log.child('codebase-analyze-worker')

const app = new Hono()

// Supabase serves this function at `/functions/v1/codebase-analyze-worker`;
// Hono sees the path WITH the function name, so routes MUST be prefixed with
// it (as in sdk-upgrade-worker / sdk-versions-cron). The bare '/' route this
// file had 404'd every kick until 2026-10-07, so all 53 jobs stayed queued.
app.get('/codebase-analyze-worker/health', (c) => c.json({ ok: true }))

app.post('/codebase-analyze-worker', async (c) => {
  const unauthorized = requireServiceRoleAuth(c.req.raw)
  if (unauthorized) return unauthorized

  const body = (await c.req.json().catch(() => ({}))) as { jobId?: string; limit?: unknown }
  const db = getServiceClient()

  if (!body.jobId) {
    const limit = analyzeDrainLimit(body.limit)
    runInBackground(
      drainCodebaseAnalyzeJobs(db, { limit }).then((summary) => {
        if (summary.error) wlog.error('analyze drain failed', { error: summary.error })
        else wlog.info('analyze drain finished', {
          requeued: summary.requeued,
          picked: summary.picked,
          completed: summary.results.filter((r) => r.status === 'completed').length,
          failed: summary.results.filter((r) => r.status === 'failed').length,
        })
      }),
      'codebase-analyze-drain',
    )
    return c.json({ ok: true, data: { mode: 'drain', limit } }, 202)
  }

  const result = await runCodebaseAnalyzeJob(db, body.jobId)
  if (!result.ok) {
    return c.json({ ok: false, error: result.error, status: result.status }, 500)
  }
  return c.json({ ok: true, data: result })
})

Deno.serve(withSentry('codebase-analyze-worker', app.fetch))
