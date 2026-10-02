// ============================================================
// recipe-collector — daily cron that keeps each project's design plane
// current (Plan 019 Phase 1b; manifest and tokens only, Phase 2 widens it).
//
// Trigger: pg_cron daily at 03:35 UTC (migration 20261002130110), and
//          POST {"projectId": "<uuid>"} from an internal caller.
// Auth:    requireServiceRoleAuth (internal only).
//
// For each project with a primary GitHub repo (at most MAX_PROJECTS a run,
// least-recently refreshed first, and no new project after START_BUDGET_MS):
//   1. refreshRecipeSnapshot: read mushi.recipe.json + DTCG token files at the
//      default-branch head into app_recipe_snapshots.
//   2. When the snapshot has tokens and the last design_drift scan is older
//      than SCAN_EVERY_HOURS, runDesignDeviance writes a gate run, findings
//      and the design.deviance_score metric.
// A project whose step fails gets an errored design_drift run (never skipped
// silently); one failing project never stops the others.
// ============================================================

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { DESIGN_GATE, refreshRecipeSnapshot, runDesignDeviance } from '../_shared/design-plane.ts'
import { collectOrgPortfolio, collectProjectPhase2 } from '../_shared/recipe-phase2.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
}

const clog = log.child('recipe-collector')
const MAX_PROJECTS = 25
/** Stop starting new projects after this, so one run stays inside the function's wall clock. */
const START_BUDGET_MS = 60_000
const SCAN_EVERY_HOURS = 20
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

  let query = db.from('project_repos').select('project_id').eq('is_primary', true)
  if (only) query = query.eq('project_id', only)
  const { data: repos, error } = await query
  if (error) {
    clog.error('failed to list projects with a repo', { err: error.message })
    return json({ ok: false, error: error.message }, 500)
  }
  // Projects with a repo, plus projects only reachable through a bound connector
  // (App Store Connect, Play, AI spend, RevenueCat) — those need Phase 2 too.
  const extra: string[] = []
  if (!only) {
    const [{ data: binds }, { data: owned }] = await Promise.all([
      db.from('connector_bindings').select('project_id').limit(1000),
      db.from('connector_instances').select('project_id').not('project_id', 'is', null).limit(1000),
    ])
    for (const r of [...(binds ?? []), ...(owned ?? [])] as Array<{ project_id: string | null }>) if (r.project_id) extra.push(r.project_id)
  }
  const ids = [...new Set([...(repos ?? []).map((r: { project_id: string }) => r.project_id), ...extra])]

  // Least-recently refreshed first, so a large fleet rotates through the cap.
  const { data: snaps } = await db
    .from('app_recipe_snapshots')
    .select('project_id, captured_at')
    .eq('is_current', true)
    .in('project_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  const last = new Map((snaps ?? []).map((s: { project_id: string; captured_at: string }) => [s.project_id, Date.parse(s.captured_at)]))
  const batch = ids.sort((a, b) => (last.get(a) ?? 0) - (last.get(b) ?? 0)).slice(0, MAX_PROJECTS)

  const results: Array<{ projectId: string; refresh: string; scan: string; phase2?: string }> = []
  const t0 = Date.now()
  for (const projectId of batch) {
    if (Date.now() - t0 > START_BUDGET_MS) {
      clog.info('recipe collection budget reached; the rest rotate to the next run', { done: results.length, left: batch.length - results.length })
      break
    }
    const row = { projectId, refresh: 'skipped', scan: 'skipped' }
    try {
      const refresh = await refreshRecipeSnapshot(db, projectId, 'cron')
      row.refresh = refresh.ok ? `ok:${refresh.tokenCount}` : `${refresh.state}:${refresh.reason.slice(0, 80)}`
      if (refresh.ok && refresh.tokenCount > 0) {
        const { data: lastRun } = await db
          .from('gate_runs')
          .select('started_at, status')
          .eq('project_id', projectId)
          .eq('gate', DESIGN_GATE)
          .neq('status', 'error')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        const age = lastRun ? Date.now() - Date.parse((lastRun as { started_at: string }).started_at) : Infinity
        if (age > SCAN_EVERY_HOURS * 3600_000) {
          const run = await runDesignDeviance(db, projectId, 'cron')
          row.scan = run.ok ? `${run.run.status}:${run.run.score ?? 'n/a'}` : `error:${run.error.slice(0, 80)}`
        }
      }
    } catch (err) {
      clog.error('recipe collection failed', { projectId, err: String(err) })
      row.refresh = `threw:${String(err).slice(0, 80)}`
    }
    // Phase 2 (ADR 0017): connectors, CI / env / schema / deploy drift, resources.
    try {
      const p2 = await collectProjectPhase2(db, projectId)
      ;(row as { phase2?: string }).phase2 = p2.gates.map((g) => `${g.gate}:${g.status}`).join(',') || 'no connected source'
    } catch (err) {
      clog.error('phase 2 collection failed', { projectId, err: String(err) })
      ;(row as { phase2?: string }).phase2 = `threw:${String(err).slice(0, 80)}`
    }
    results.push(row)
  }
  // Cross-project rules once per organization touched by this run (Plan 019 P2).
  const { data: orgRows } = await db.from('projects').select('organization_id').in('id', batch.length ? batch : ['00000000-0000-0000-0000-000000000000'])
  for (const orgId of [...new Set(((orgRows ?? []) as Array<{ organization_id: string | null }>).map((r) => r.organization_id).filter((x): x is string => Boolean(x)))]) {
    try {
      await collectOrgPortfolio(db, orgId)
    } catch (err) {
      clog.error('portfolio rules failed', { orgId, err: String(err) })
    }
  }
  await db.rpc('recipe_observations_prune', { p_days: 90 }).then(() => {}, () => {})
  clog.info('recipe collection complete', { total: ids.length, collected: batch.length })
  return json({ ok: true, data: { total: ids.length, collected: batch.length, results } })
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('recipe-collector', handler))
}
