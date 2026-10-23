// ============================================================
// vuln-watch — known holes in dependencies and the runtime (ADR 0038).
//
// Trigger: pg_cron daily at 05:25 UTC (migration 20261022112045), and
//          POST {"projectId": "<uuid>"} from an internal caller (the
//          console's "Check now" goes through api-ext).
// Auth:    requireServiceRoleAuth (internal only).
//
// For each project with a primary GitHub repo (at most MAX_PROJECTS a run,
// least-recently checked first, no new project after START_BUDGET_MS):
// runVulnWatch reads the lockfiles and runtime pins at the default-branch
// head, matches exact versions on OSV.dev, enriches with CISA KEV and EPSS,
// files grouped `security_advisory` reports under the app's daily limit, and
// records a `portfolio_radar_vulns` gate run. One failing project never stops
// the others; its failure is recorded as an errored run, never skipped.
// Outbound hosts: api.osv.dev, www.cisa.gov, api.first.org, endoflife.date,
// api.github.com. Only package names and versions leave Mushi.
// ============================================================

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { RADAR_VULN_GATE } from '../_shared/radar/run.ts'
import { runVulnWatch, vulnTablesMissing } from '../_shared/vuln-watch-db.ts'
import { defaultVulnWatchDeps } from '../_shared/vuln-watch-deps.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
}

const slog = log.child('vuln-watch')
const MAX_PROJECTS = 25
const START_BUDGET_MS = 120_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_ID = '00000000-0000-0000-0000-000000000000'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function handler(req: Request): Promise<Response> {
  const authResp = requireServiceRoleAuth(req)
  if (authResp) return authResp
  const db = getServiceClient()

  if (await vulnTablesMissing(db)) {
    return json({ ok: false, error: { code: 'NOT_SET_UP', message: 'Apply migration 20261022112045_known_vulnerabilities first.' } }, 503)
  }

  let only: string | null = null
  let triggeredBy = 'cron'
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({})) as { projectId?: unknown; trigger?: unknown }
    if (typeof body.projectId === 'string') {
      if (!UUID_RE.test(body.projectId)) return json({ ok: false, error: 'projectId must be a uuid' }, 400)
      only = body.projectId
      triggeredBy = typeof body.trigger === 'string' && body.trigger.length <= 20 ? body.trigger : 'manual'
    }
  }

  let repoQ = db.from('project_repos').select('project_id').eq('is_primary', true)
  if (only) repoQ = repoQ.eq('project_id', only)
  const { data: repos, error } = await repoQ
  if (error) {
    slog.error('failed to list projects', { err: error.message })
    return json({ ok: false, error: error.message }, 500)
  }
  const ids = [...new Set((repos ?? []).map((r: { project_id: string }) => r.project_id))]

  const { data: lastRuns } = await db
    .from('gate_runs')
    .select('project_id, started_at')
    .eq('gate', RADAR_VULN_GATE)
    .in('project_id', ids.length ? ids : [NO_ID])
    .order('started_at', { ascending: false })
    .limit(2000)
  const last = new Map<string, number>()
  for (const r of (lastRuns ?? []) as Array<{ project_id: string; started_at: string }>) {
    if (!last.has(r.project_id)) last.set(r.project_id, Date.parse(r.started_at))
  }
  const batch = ids.sort((a, b) => (last.get(a) ?? 0) - (last.get(b) ?? 0)).slice(0, MAX_PROJECTS)

  // One release-line read per runtime for the whole invocation.
  const deps = { ...defaultVulnWatchDeps, releaseLineCache: new Map() }
  const results: Array<Record<string, unknown>> = []
  const t0 = Date.now()
  for (const projectId of batch) {
    if (Date.now() - t0 > START_BUDGET_MS) {
      slog.info('vuln-watch budget reached; the rest rotate to the next run', { done: results.length, left: batch.length - results.length })
      break
    }
    try {
      const run = await runVulnWatch(db, projectId, deps, triggeredBy)
      results.push({ projectId, status: run.status, lockfiles: run.lockfiles, packages: run.packages, matches: run.matches, filed: run.filed, capped: run.capped })
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 300)
      slog.error('vuln-watch run failed', { projectId, err: message })
      const now = new Date().toISOString()
      await db.from('gate_runs').insert({
        project_id: projectId, gate: RADAR_VULN_GATE, status: 'error', triggered_by: triggeredBy,
        summary: { error: message, results: [] }, findings_count: 0, started_at: now, completed_at: now,
      })
      results.push({ projectId, status: 'error', error: message })
    }
  }
  slog.info('vuln-watch complete', { total: ids.length, scanned: results.length })
  return json({ ok: true, data: { total: ids.length, scanned: results.length, results } })
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('vuln-watch', handler))
}
