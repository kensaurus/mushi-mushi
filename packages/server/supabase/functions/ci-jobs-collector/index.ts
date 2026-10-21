// ============================================================
// ci-jobs-collector — keep GitHub Actions jobs and runners current for the
// CI view and the fix loop (Plan 022 Phase 2, ADR 0033).
//
// Trigger: pg_cron every 10 minutes at :02 … :52 (migration
//          20261021111344_ci_runner_visibility), and POST
//          {"projectId": "<uuid>"} from an internal caller.
// Auth:    requireServiceRoleAuth (internal only).
//
// Each tick reads runs on every branch updated in the last 2 h for every
// repo in project_repos, the jobs of runs not stored as finished, and the
// runner list (a refused list is retried once a day). At most 40 GitHub
// calls per tick, shared across projects; then ci_jobs and
// ci_runner_job_samples older than 30 days are deleted.
// See _shared/ci-collector.ts.
// ============================================================

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { resolveProjectGithubToken } from '../_shared/github.ts'
import { startCronRun } from '../_shared/telemetry.ts'
import { runCiCollector, type CollectorDeps } from '../_shared/ci-collector.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
}

const clog = log.child('ci-jobs-collector')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const liveDeps: CollectorDeps = {
  resolveToken: (db, projectId, installationId) => resolveProjectGithubToken(db as never, projectId, installationId),
  now: () => new Date(),
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export async function handler(req: Request): Promise<Response> {
  const authResp = requireServiceRoleAuth(req)
  if (authResp) return authResp
  const db = getServiceClient()

  let only: string[] | undefined
  let trigger: 'cron' | 'manual' | 'http' = 'http'
  if (req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { projectId?: unknown; trigger?: unknown }
    if (body.trigger === 'cron') trigger = 'cron'
    if (typeof body.projectId === 'string') {
      if (!UUID_RE.test(body.projectId)) return json({ ok: false, error: { code: 'BAD_PROJECT_ID', message: 'projectId must be a uuid' } }, 400)
      only = [body.projectId]
      trigger = 'manual'
    }
  }

  const run = await startCronRun(db, 'ci-jobs-collector', trigger)
  try {
    const summary = await runCiCollector(db as never, liveDeps, { projectIds: only })
    clog.info('ci-jobs-collector tick', { ...summary })
    await run.finish({ rowsAffected: summary.stored, metadata: { ...summary } })
    return json({ ok: true, data: summary })
  } catch (err) {
    const message = String((err as Error)?.message ?? err).slice(0, 300)
    clog.error('ci-jobs-collector failed', { err: message })
    await run.fail(err)
    return json({ ok: false, error: { code: 'COLLECTOR_FAILED', message: 'The CI collector could not finish this tick.' } }, 500)
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('ci-jobs-collector', handler))
}
