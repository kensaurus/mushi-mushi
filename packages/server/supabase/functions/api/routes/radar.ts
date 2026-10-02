/**
 * radar.ts — the hole checks (Plan 020 Phase 1, ADR 0017).
 *
 *   GET  /v1/admin/projects/:id/radar        adminOrApiKey(mcp:read)  every detector's state
 *   POST /v1/admin/projects/:id/radar/run    adminOrApiKey(mcp:write) run now (1 per 10 min)
 *   GET  /v1/admin/orgs/:orgId/radar         adminOrApiKey(mcp:read)  open findings across the org
 *   POST /v1/ingest/radar                    apiKeyAuth               the host CI's scan (radar_ci)
 *
 * Reads never show a check that did not run as passing (see _shared/radar/run.ts).
 * The CI ingest stores only server-written messages: the CI sends rule ids,
 * file paths and line numbers, plus build-config files that are parsed and
 * never stored.
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { adminOrApiKey, apiKeyAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { runInBackground } from '../../_shared/background.ts'
import { defaultRadarRunDeps } from '../../_shared/radar/default-deps.ts'
import { CI_ONLY_RULES, RADAR_CI_GATE, RADAR_GATE, readRadar, recordCiRadar, runRadar, type RadarRunDeps } from '../../_shared/radar/run.ts'
import { isRepoScanPath } from '../../_shared/radar/repo-scan.ts'
import { RADAR_RULES, RADAR_RULE_IDS, type RadarFinding, type RadarRuleId } from '../../_shared/radar/types.ts'
import { callerCanAccessProject, jsonError } from '../shared.ts'
import type { Variables } from '../types.ts'
import { classifyIngestRateLimitError } from './ingest-rate-limit.ts'
import { portfolioAccess } from './portfolio.ts'

const rlog = log.child('radar')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const RADAR_RUN_COOLDOWN_MS = 10 * 60 * 1000
const MAX_CI_FILES = 40
const MAX_CI_FILE_BYTES = 256 * 1024
const MAX_CI_TOTAL_BYTES = 1024 * 1024

type Db = ReturnType<typeof getServiceClient>

export interface RadarRouteDeps {
  getServiceClient: () => Db
  adminOrApiKeyRead: MiddlewareHandler
  adminOrApiKeyWrite: MiddlewareHandler
  apiKeyAuth: MiddlewareHandler
  run: RadarRunDeps
  runInBackground: typeof runInBackground
  runRadar: typeof runRadar
}

export const defaultRadarDeps: RadarRouteDeps = {
  getServiceClient,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  adminOrApiKeyWrite: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  apiKeyAuth: apiKeyAuth as MiddlewareHandler,
  run: defaultRadarRunDeps,
  runInBackground,
  runRadar,
}

async function projectAccess(c: Context, db: Db): Promise<{ ok: true; projectId: string } | { ok: false; response: Response }> {
  const projectId = c.req.param('id') ?? ''
  if (!UUID_RE.test(projectId)) return { ok: false, response: jsonError(c, 'NOT_FOUND', 'Project not found', 404) }
  const access = await callerCanAccessProject(c, db, c.get('userId') as string, projectId)
  if (!access.allowed) return { ok: false, response: jsonError(c, 'NOT_FOUND', 'Project not found', 404) }
  return { ok: true, projectId }
}

const ciPushSchema = z.object({
  commitSha: z.string().regex(/^[0-9a-f]{7,64}$/i).optional(),
  scanned: z.array(z.enum(RADAR_RULE_IDS)).max(20).default([]),
  findings: z.array(z.object({
    ruleId: z.enum(RADAR_RULE_IDS),
    filePath: z.string().min(1).max(400),
    line: z.number().int().min(1).max(10_000_000).optional(),
  })).max(200).default([]),
  files: z.record(z.string().max(400), z.string()).default({}),
})

/** Server-written text for a CI finding: the CI sends where, Mushi says what. */
function ciFinding(f: { ruleId: RadarRuleId; filePath: string; line?: number }): RadarFinding {
  const where = `${f.filePath}${f.line ? `:${f.line}` : ''}`
  if (f.ruleId === 'storage_sql_delete') {
    return {
      ruleId: f.ruleId,
      severity: 'warn',
      message: `Rows of storage.objects are deleted with SQL at ${where}. The files stay in the bucket and keep billing.`,
      target: f.filePath,
      filePath: f.filePath,
      line: f.line ?? null,
      fix: "Delete the file through the Storage API instead: `supabase.storage.from('<bucket>').remove(['<path>'])`. A SQL delete leaves the file behind (https://supabase.com/docs/guides/storage/management/delete-objects).",
    }
  }
  return { ruleId: f.ruleId, severity: 'warn', message: `${RADAR_RULES[f.ruleId].title}: your CI flagged ${where}.`, target: f.filePath, filePath: f.filePath, line: f.line ?? null, fix: 'Open the file at that line and fix it.' }
}

export function registerRadarRoutes(app: Hono<{ Variables: Variables }>, deps: RadarRouteDeps = defaultRadarDeps): void {
  app.get('/v1/admin/projects/:id/radar', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await projectAccess(c, db)
    if (!access.ok) return access.response
    try {
      return c.json({ ok: true, data: await readRadar(db, access.projectId) })
    } catch (err) {
      rlog.error('radar read failed', { projectId: access.projectId, err: (err as Error)?.message })
      return jsonError(c, 'RADAR_FAILED', 'The hole checks could not be read. Try again in a minute.', 500)
    }
  })

  app.post('/v1/admin/projects/:id/radar/run', deps.adminOrApiKeyWrite, async (c) => {
    const db = deps.getServiceClient()
    const access = await projectAccess(c, db)
    if (!access.ok) return access.response
    const now = deps.run.now()
    const { data: last } = await db
      .from('gate_runs')
      .select('started_at')
      .eq('project_id', access.projectId)
      .eq('gate', RADAR_GATE)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const lastAt = (last as { started_at?: string } | null)?.started_at
    if (lastAt && now.getTime() - Date.parse(lastAt) < RADAR_RUN_COOLDOWN_MS) {
      const wait = Math.ceil((RADAR_RUN_COOLDOWN_MS - (now.getTime() - Date.parse(lastAt))) / 60000)
      c.header('Retry-After', String(wait * 60))
      return jsonError(c, 'RATE_LIMITED', `The hole checks ran a few minutes ago. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`, 429)
    }
    deps.runInBackground(
      deps.runRadar(db, access.projectId, deps.run, 'manual').catch((err) => {
        rlog.warn('radar run failed', { projectId: access.projectId, err: (err as Error)?.message })
        throw err
      }),
      'radar-run',
    )
    return c.json({ ok: true, data: { started: true, projectId: access.projectId, startedAt: now.toISOString() } }, 202)
  })

  app.get('/v1/admin/orgs/:orgId/radar', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    try {
      const ids = [...access.projectIds].sort().slice(0, 50)
      const { data: names } = ids.length ? await db.from('projects').select('id, name').in('id', ids) : { data: [] }
      const nameOf = new Map(((names ?? []) as Array<{ id: string; name: string | null }>).map((p) => [p.id, p.name]))
      const projects = await Promise.all(ids.map(async (id) => {
        const view = await readRadar(db, id)
        return {
          projectId: id,
          name: nameOf.get(id) ?? null,
          status: view.status,
          checkedAt: view.checkedAt,
          unchecked: view.detectors.filter((d) => d.state === 'unknown' || d.state === 'error').length,
          findings: view.detectors.flatMap((d) => d.findings.map((f) => ({ ...f, ruleId: d.ruleId, title: d.title }))),
        }
      }))
      return c.json({ ok: true, data: { organizationId: access.orgId, projects } })
    } catch (err) {
      rlog.error('org radar failed', { orgId: access.orgId, err: (err as Error)?.message })
      return jsonError(c, 'RADAR_FAILED', 'The hole checks could not be read. Try again in a minute.', 500)
    }
  })

  app.post('/v1/ingest/radar', deps.apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string | null
    if (!projectId) return jsonError(c, 'PROJECT_KEY_REQUIRED', 'Use a key bound to the project this CI builds.', 400)
    const db = deps.getServiceClient()
    const { error: rateErr } = await db.rpc('report_ingest_rate_limit_claim', { p_project_id: projectId, p_max_per_minute: 30 })
    const rate = classifyIngestRateLimitError(rateErr)
    if (rate === 'breach' || rate === 'fail-closed') {
      c.header('Retry-After', '60')
      return jsonError(c, 'RATE_LIMITED', 'Too many radar pushes. Retry in a minute.', 429)
    }
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return jsonError(c, 'INVALID_JSON', 'Body must be valid JSON', 400)
    }
    const parsed = ciPushSchema.safeParse(raw)
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500), 400)
    const body = parsed.data

    const files: Record<string, string> = {}
    let total = 0
    for (const [path, text] of Object.entries(body.files)) {
      if (!isRepoScanPath(path)) return jsonError(c, 'PATH_NOT_ALLOWED', `${path.slice(0, 120)} is not a build-config file the radar reads.`, 400)
      if (text.length > MAX_CI_FILE_BYTES) return jsonError(c, 'FILE_TOO_LARGE', `${path.slice(0, 120)} is over 256 KB.`, 413)
      total += text.length
      files[path] = text
    }
    if (Object.keys(files).length > MAX_CI_FILES || total > MAX_CI_TOTAL_BYTES) return jsonError(c, 'PAYLOAD_TOO_LARGE', 'At most 40 files and 1 MB in total.', 413)
    const scanned = body.scanned.filter((r) => CI_ONLY_RULES.includes(r))
    const findings = body.findings.filter((f) => scanned.includes(f.ruleId)).map(ciFinding)
    if (scanned.length === 0 && Object.keys(files).length === 0) {
      return jsonError(c, 'NOTHING_TO_RECORD', 'Send `scanned` rules or build-config `files`.', 400)
    }
    try {
      const run = await recordCiRadar(db, projectId, { commitSha: body.commitSha ?? null, scanned, findings, files }, deps.run.now())
      return c.json({ ok: true, data: { runId: run.runId, gate: RADAR_CI_GATE, status: run.status, results: run.results } })
    } catch (err) {
      rlog.error('radar ingest failed', { projectId, err: (err as Error)?.message })
      return jsonError(c, 'RADAR_FAILED', 'The radar results could not be stored.', 500)
    }
  })
}
