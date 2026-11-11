/**
 * FILE: packages/server/supabase/functions/api/routes/ci-runner-ingest.ts
 * PURPOSE: POST /v1/ingest/runner on its own, so both `api` and `api-ext`
 *          serve it from one handler.
 *
 *   POST /v1/ingest/runner               apiKeyAuth + scope runner:write, 60/min
 *        `mushi runner heartbeat` (kind 'heartbeat') and the runner job hooks
 *        (kind 'job'). Host ids arrive hashed; raw machine ids are refused.
 *        Only a runner:write key: the public SDK key (report:write, shipped in
 *        app bundles) could otherwise forge hosts and memory figures, and an
 *        mcp:write key must not sit on a runner, where CI jobs run as the
 *        same user and could read it. runner:write unlocks nothing else.
 *
 * Why its own file: every runner pushes here about once a minute. When `api`
 * forwarded the path to `api-ext` (_shared/edge-proxy.ts), each push cost two
 * edge invocations. `api` is at Supabase's deploy size limit, so it imports
 * this small module instead of the whole CI route group (ci.ts). `api-ext`
 * keeps serving the path through registerCiRoutes for clients that call it
 * directly.
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { apiKeyAuth, requireApiKeyScope } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { runnerIngestSchema } from '../../_shared/schemas.ts'
import { claimTenantRateLimit } from '../../_shared/tenant-observability.ts'
import { jsonError } from '../shared.ts'
import type { Variables } from '../types.ts'

const clog = log.child('ci-routes')

export const RUNNER_INGEST_PER_MINUTE = 60
/** A job sample may be at most this far in the future (clock skew) or the past. */
const SAMPLE_FUTURE_MS = 10 * 60_000
const SAMPLE_PAST_MS = 7 * 24 * 60 * 60_000

type Db = ReturnType<typeof getServiceClient>

export interface RunnerIngestDeps {
  getServiceClient: () => Db
  apiKeyAuth: MiddlewareHandler
  /** After apiKeyAuth on the runner ingest: the key must carry runner:write. */
  requireRunnerScope: MiddlewareHandler
  claimRateLimit: typeof claimTenantRateLimit
  now: () => Date
}

export const defaultRunnerIngestDeps: RunnerIngestDeps = {
  getServiceClient,
  apiKeyAuth: apiKeyAuth as MiddlewareHandler,
  requireRunnerScope: requireApiKeyScope('runner:write') as MiddlewareHandler,
  claimRateLimit: claimTenantRateLimit,
  now: () => new Date(),
}

export function registerRunnerIngestRoute(app: Hono<{ Variables: Variables }>, deps: RunnerIngestDeps = defaultRunnerIngestDeps): void {
  app.post('/v1/ingest/runner', deps.apiKeyAuth, deps.requireRunnerScope, (c) => ingestRunner(c, deps))
}

async function ingestRunner(c: Context, deps: RunnerIngestDeps): Promise<Response> {
  const projectId = c.get('projectId') as string | null | undefined
  if (!projectId) return jsonError(c, 'PROJECT_KEY_REQUIRED', 'Use a key bound to a project (Projects → SDK ingest key).', 400)
  const db = deps.getServiceClient()
  const rate = await deps.claimRateLimit(db, `project:${projectId}:runner_ingest`, RUNNER_INGEST_PER_MINUTE, 60)
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSec ?? 60))
    return jsonError(c, 'RATE_LIMITED', 'Too many runner pushes. Retry in a minute.', 429)
  }
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return jsonError(c, 'INVALID_JSON', 'Body must be valid JSON', 400)
  }
  const parsed = runnerIngestSchema.safeParse(raw)
  if (!parsed.success) {
    return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500), 400)
  }
  const body = parsed.data

  const { data: project, error: projectErr } = await db.from('projects').select('organization_id').eq('id', projectId).maybeSingle()
  if (projectErr) return jsonError(c, 'DB_ERROR', 'Could not read the project.', 500)
  const organizationId = (project as { organization_id: string | null } | null)?.organization_id ?? null
  if (!organizationId) return jsonError(c, 'NO_ORGANIZATION', 'This project belongs to no organization, so runner data has nowhere to go.', 409)

  const now = deps.now()
  if (body.kind === 'heartbeat') {
    const h = body.host
    const { error } = await db.from('ci_runner_hosts').upsert(
      {
        organization_id: organizationId,
        project_id: projectId,
        host_id: h.host_id,
        hostname: h.hostname,
        platform: h.platform,
        cpu_count: h.cpu_count ?? null,
        mem_total_mb: h.mem_total_mb ?? null,
        mushi_version: h.mushi_version ?? null,
        metrics: h.metrics ?? {},
        runners: body.runners,
        // Server time: a host with a wrong clock must not look fresh or stale.
        last_heartbeat_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
      { onConflict: 'organization_id,host_id' },
    )
    if (error) {
      clog.error('runner heartbeat upsert failed', { projectId, err: error.message })
      return jsonError(c, 'DB_ERROR', 'The heartbeat could not be stored.', 500)
    }
    return c.json({ ok: true, data: { kind: 'heartbeat', hostId: h.host_id, runners: body.runners.length, receivedAt: now.toISOString() } })
  }

  const at = Date.parse(body.at)
  if (at > now.getTime() + SAMPLE_FUTURE_MS || at < now.getTime() - SAMPLE_PAST_MS) {
    return jsonError(c, 'SAMPLE_OUT_OF_RANGE', '`at` must be within the last 7 days (and not in the future).', 400)
  }
  const { error } = await db.from('ci_runner_job_samples').upsert(
    {
      organization_id: organizationId,
      project_id: projectId,
      host_id: body.host_id,
      runner_name: body.runner_name,
      repo: body.repo,
      run_id: body.run_id,
      run_attempt: body.run_attempt,
      job_key: body.job_key,
      phase: body.phase,
      at: new Date(at).toISOString(),
      mem_peak_mb: body.mem_peak_mb ?? null,
      mem_max_mb: body.mem_max_mb ?? null,
      oom_kills: body.oom_kills ?? null,
      swap_used_mb: body.swap_used_mb ?? null,
      load1: body.load1 ?? null,
    },
    { onConflict: 'organization_id,host_id,job_key,phase', ignoreDuplicates: true },
  )
  if (error) {
    clog.error('runner job sample insert failed', { projectId, err: error.message })
    return jsonError(c, 'DB_ERROR', 'The job sample could not be stored.', 500)
  }
  return c.json({ ok: true, data: { kind: 'job', jobKey: body.job_key, phase: body.phase } })
}
