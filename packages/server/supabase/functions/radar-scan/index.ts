// ============================================================
// radar-scan — daily hole checks across projects (Plan 020 Phase 1, ADR 0017).
//
// Trigger: pg_cron daily at 04:05 UTC (migration 20261002180000), and
//          POST {"projectId": "<uuid>"} from an internal caller.
// Auth:    requireServiceRoleAuth (internal only).
//
// For each project with a recipe snapshot or a primary GitHub repo (at most
// MAX_PROJECTS a run, least-recently checked first, and no new project after
// START_BUDGET_MS): runRadar runs the public probes (store names, listing
// locales, domain and certificate expiry, security headers, the privacy link)
// and the store-policy rules read from the repo, then records one `portfolio_radar`
// gate run. A project whose run throws gets an errored radar run, never a
// silent skip; one failing project never stops the others.
// ============================================================

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { RADAR_GATE, runRadar } from '../_shared/radar/run.ts'
import { defaultRadarRunDeps } from '../_shared/radar/default-deps.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
}

const slog = log.child('radar-scan')
const MAX_PROJECTS = 25
const START_BUDGET_MS = 60_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_ID = '00000000-0000-0000-0000-000000000000'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function handler(req: Request): Promise<Response> {
  const authResp = requireServiceRoleAuth(req)
  if (authResp) return authResp
  const db = getServiceClient()

  let only: string | null = null
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({})) as { projectId?: unknown }
    if (typeof body.projectId === 'string') {
      if (!UUID_RE.test(body.projectId)) return json({ ok: false, error: 'projectId must be a uuid' }, 400)
      only = body.projectId
    }
  }

  let snapQ = db.from('app_recipe_snapshots').select('project_id').eq('is_current', true)
  let repoQ = db.from('project_repos').select('project_id').eq('is_primary', true)
  if (only) {
    snapQ = snapQ.eq('project_id', only)
    repoQ = repoQ.eq('project_id', only)
  }
  const [{ data: snaps, error: sErr }, { data: repos, error: rErr }] = await Promise.all([snapQ, repoQ])
  if (sErr || rErr) {
    slog.error('failed to list projects', { err: (sErr ?? rErr)?.message })
    return json({ ok: false, error: (sErr ?? rErr)?.message }, 500)
  }
  const ids = [...new Set([...(snaps ?? []), ...(repos ?? [])].map((r: { project_id: string }) => r.project_id))]

  const { data: lastRuns } = await db
    .from('gate_runs')
    .select('project_id, started_at')
    .eq('gate', RADAR_GATE)
    .in('project_id', ids.length ? ids : [NO_ID])
    .order('started_at', { ascending: false })
    .limit(2000)
  const last = new Map<string, number>()
  for (const r of (lastRuns ?? []) as Array<{ project_id: string; started_at: string }>) {
    if (!last.has(r.project_id)) last.set(r.project_id, Date.parse(r.started_at))
  }
  const batch = ids.sort((a, b) => (last.get(a) ?? 0) - (last.get(b) ?? 0)).slice(0, MAX_PROJECTS)

  const results: Array<{ projectId: string; status: string; checked?: number; unchecked?: number; errored?: number; error?: string }> = []
  const t0 = Date.now()
  for (const projectId of batch) {
    if (Date.now() - t0 > START_BUDGET_MS) {
      slog.info('radar budget reached; the rest rotate to the next run', { done: results.length, left: batch.length - results.length })
      break
    }
    try {
      const run = await runRadar(db, projectId, defaultRadarRunDeps, 'cron')
      results.push({ projectId, status: run.status, checked: run.checked, unchecked: run.unchecked, errored: run.errored })
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 300)
      slog.error('radar run failed', { projectId, err: message })
      const now = new Date().toISOString()
      await db.from('gate_runs').insert({
        project_id: projectId, gate: RADAR_GATE, status: 'error', triggered_by: 'cron',
        summary: { error: message, results: [] }, findings_count: 0, started_at: now, completed_at: now,
      })
      results.push({ projectId, status: 'error', error: message })
    }
  }
  slog.info('radar scan complete', { total: ids.length, scanned: results.length })
  return json({ ok: true, data: { total: ids.length, scanned: results.length, results } })
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('radar-scan', handler))
}
