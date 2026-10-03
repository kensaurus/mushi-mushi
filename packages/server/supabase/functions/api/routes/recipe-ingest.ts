/**
 * recipe-ingest.ts — push and legacy adapters for the recipe (Plan 019 §2b),
 * and the portfolio's shared-resource graph (Phase P2).
 *
 *   POST /v1/ingest/recipe          apiKeyAuth  the host CI pushes mushi.recipe.json + token/CSS files
 *                                               for repos Mushi has no token for, plus the deviance
 *                                               scan `mushi recipe check` ran with the shared engine
 *                                               (`deviance`, scored here: _shared/design-ci-push.ts);
 *                                               the answer carries the score and the project's CI gate
 *   POST /v1/ingest/recipe/events   apiKeyAuth  build.completed / deploy.completed / release.published
 *   POST /v1/ingest/recipe/csv      jwtAuth     one-off import of shared resources (domains, bundle ids…)
 *   GET  /v1/admin/orgs/:orgId/portfolio/resources  adminOrApiKey(mcp:read)  resources, uses, cross-project findings
 *   GET  /v1/admin/projects/:id/recipe/drift          adminOrApiKey(mcp:read)  open recipe drift with fixes (MCP get_recipe_drift)
 *
 * Pushed text is untrusted: size caps, the same secret scan and manifest
 * schema as the GitHub path (snapshotFromSource), and nothing pushed is ever
 * executed.
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { adminOrApiKey, apiKeyAuth, jwtAuth, keyHasAgentScope, mcpKeyBrowserExposure } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { snapshotFromSource, DESIGN_GATE } from '../../_shared/design-plane.ts'
import { recordCiDeviance, type CiDevianceInput, type CiDevianceResult, type CiKeyExposure } from '../../_shared/design-ci-push.ts'
import { normalizeRepoPath } from '../../_shared/recipe-glob.ts'
import { PORTFOLIO_RESOURCE_KINDS } from '../../_shared/portfolio-rules.ts'
import { upsertResource } from '../../_shared/recipe-phase2.ts'
import { callerCanAccessProject, jsonError } from '../shared.ts'
import type { Variables } from '../types.ts'
import { classifyIngestRateLimitError } from './ingest-rate-limit.ts'
import { portfolioAccess } from './portfolio.ts'
import { latestPerGate, loadLatestDesignScans } from './recipe-compose.ts'

const ilog = log.child('recipe-ingest')
const RECIPE_DRIFT_GATES = ['ci_drift', 'deploy_drift', 'env_drift', 'schema_drift', 'design_drift'] as const
const MAX_FILES = 60
const MAX_FILE_BYTES = 512 * 1024
const MAX_TOTAL_BYTES = 4 * 1024 * 1024
const CSV_LISTED_ERRORS = 50

type Db = ReturnType<typeof getServiceClient>

export interface RecipeIngestDeps {
  getServiceClient: () => Db
  apiKeyAuth: MiddlewareHandler
  jwtAuth: MiddlewareHandler
  adminOrApiKeyRead: MiddlewareHandler
  now: () => Date
  recordCiDeviance: (db: Db, projectId: string, input: CiDevianceInput) => Promise<CiDevianceResult>
  /** Why the pushing key is public (a web page sent it, or an SDK key), or null; a public key's push never sets the design state or dispatches. */
  keyExposure: (c: Context) => CiKeyExposure
}

/**
 * Why the key apiKeyAuth resolved is public, or null for a private agent key:
 * this request's browser headers or the key's sticky browser signals
 * (mcpKeyBrowserExposure), else a key with no agent scope. That is the SDK
 * key (report:write only), which ships inside the app: a native app sends no
 * browser header, and a web key no browser has used yet has no signal.
 */
export function ingestKeyExposure(c: Context): CiKeyExposure {
  const signals = (c.get('apiKeyBrowserSignals') as { last_seen_origin: string | null; browser_seen_at: string | null } | undefined) ?? { last_seen_origin: null, browser_seen_at: null }
  const browser = mcpKeyBrowserExposure({ origin: c.req.header('Origin'), referer: c.req.header('Referer'), secFetchSite: c.req.header('Sec-Fetch-Site') }, signals)
  if (browser) return browser
  const scopes = (c.get('apiKeyScopes') as string[] | undefined) ?? []
  return keyHasAgentScope(scopes) ? null : 'sdk_key'
}

export const defaultRecipeIngestDeps: RecipeIngestDeps = {
  getServiceClient,
  apiKeyAuth: apiKeyAuth as MiddlewareHandler,
  jwtAuth: jwtAuth as MiddlewareHandler,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  now: () => new Date(),
  recordCiDeviance: (db, projectId, input) => recordCiDeviance(db, projectId, input),
  keyExposure: ingestKeyExposure,
}

const suggestionSchema = z.object({
  token: z.string().max(300),
  cssVar: z.string().max(200).nullable(),
  ts: z.string().max(200).nullable(),
  value: z.string().max(200),
  distance: z.number().nullable(),
}).strict()

/** A scan from `mushi recipe check` ≥ the shared engine: literal findings with the server's rule ids, and true counts. */
const devianceSchema = z.object({
  engine: z.literal(1),
  scannedFiles: z.number().int().min(0).max(1_000_000),
  scannedLines: z.number().int().min(0).max(1_000_000_000),
  matchedFiles: z.number().int().min(0).max(1_000_000),
  truncated: z.boolean(),
  counts: z.record(z.string().max(60), z.number().int().min(0).max(10_000_000)),
  score: z.number().min(0).max(100).nullable().optional(),
  findings: z.array(z.object({
    ruleId: z.string().max(60),
    filePath: z.string().min(1).max(400),
    line: z.number().int().min(1).max(10_000_000),
    col: z.number().int().min(1).max(1_000_000).nullable(),
    value: z.string().max(200),
    message: z.string().max(500),
    suggestion: suggestionSchema.nullable(),
  }).strict()).max(500),
}).strict()

const pushSchema = z.object({
  commitSha: z.string().regex(/^[0-9a-f]{7,64}$/i),
  branch: z.string().min(1).max(200).default('main'),
  files: z.record(z.string().max(400), z.string()),
  deviance: devianceSchema.optional(),
  // A CLI older than the shared engine: hex literals only, rule `off_token_literal`, no score.
  // Stored as a `ci_scan` run, which never becomes the shown score (isScanRun).
  findings: z.array(z.object({
    ruleId: z.literal('off_token_literal'),
    filePath: z.string().min(1).max(400),
    line: z.number().int().min(1).max(10_000_000),
    value: z.string().max(100),
  })).max(500).optional(),
  scannedFiles: z.number().int().min(0).max(1_000_000).optional(),
}).strict()

const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('build.completed'), id: z.string().min(1).max(100), workflow: z.string().max(200).optional(), branch: z.string().max(200).optional(), commit: z.string().max(64).optional(), conclusion: z.enum(['success', 'failure', 'cancelled']), startedAt: z.string().datetime().optional(), completedAt: z.string().datetime(), minutes: z.number().min(0).max(100_000).optional() }),
  z.object({ type: z.literal('deploy.completed'), targetId: z.string().min(1).max(80), environment: z.string().max(60).optional(), version: z.string().max(100).optional(), commit: z.string().max(64).optional(), ok: z.boolean(), error: z.string().max(300).optional() }),
  z.object({ type: z.literal('release.published'), targetId: z.string().min(1).max(80), version: z.string().min(1).max(100), commit: z.string().max(64).optional() }),
])

async function rateLimited(c: Context, db: Db, projectId: string): Promise<Response | null> {
  const { error } = await db.rpc('report_ingest_rate_limit_claim', { p_project_id: projectId, p_max_per_minute: 30 })
  const outcome = classifyIngestRateLimitError(error)
  if (outcome === 'breach' || outcome === 'fail-closed') {
    c.header('Retry-After', '60')
    return jsonError(c, 'RATE_LIMITED', 'Too many recipe pushes. Retry in a minute.', 429)
  }
  return null
}

/** Stable numeric run id for a host-supplied build id. */
function syntheticRunId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 2_147_483_647
  return h
}

/** One CSV line → cells (quotes and doubled quotes; no newlines inside cells). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { out.push(cur.trim()); cur = '' } else cur += ch
  }
  out.push(cur.trim())
  return out
}

/**
 * The CSV import is a signed-in owner's or admin's action (the route is
 * jwtAuth). A failed role read answers false, so the import fails closed.
 */
async function canImportResources(c: Context, db: Db, orgId: string): Promise<boolean> {
  if (c.get('authMethod') === 'apiKey') return false
  const userId = c.get('userId') as string | undefined
  if (!userId) return false
  const { data, error } = await db.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', userId).maybeSingle()
  if (error) {
    ilog.warn('org role read failed', { orgId, err: error.message })
    return false
  }
  return ['owner', 'admin'].includes((data as { role?: string } | null)?.role ?? '')
}

export function registerRecipeIngestRoutes(app: Hono<{ Variables: Variables }>, deps: RecipeIngestDeps = defaultRecipeIngestDeps): void {
  app.post('/v1/ingest/recipe', deps.apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string | null
    if (!projectId) return jsonError(c, 'PROJECT_KEY_REQUIRED', 'Use a key bound to the project this CI builds.', 400)
    const db = deps.getServiceClient()
    const limited = await rateLimited(c, db, projectId)
    if (limited) return limited
    const parsed = pushSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500), 400)
    const body = parsed.data
    const files = new Map<string, string>()
    let total = 0
    for (const [raw, text] of Object.entries(body.files)) {
      const path = normalizeRepoPath(raw)
      if (!path) return jsonError(c, 'PATH_NOT_ALLOWED', `${raw.slice(0, 120)} is not a safe repo path.`, 400)
      total += text.length
      files.set(path, text)
    }
    if (files.size > MAX_FILES || total > MAX_TOTAL_BYTES) return jsonError(c, 'PAYLOAD_TOO_LARGE', `At most ${MAX_FILES} files and 4 MB in total.`, 413)
    const result = await snapshotFromSource(db, projectId, {
      kind: 'ci_ingest',
      head: { sha: body.commitSha, branch: body.branch },
      readFile: async (path, maxBytes) => {
        const text = files.get(path)
        if (text === undefined) return { kind: 'absent', path }
        if (text.length > Math.min(maxBytes, MAX_FILE_BYTES)) return { kind: 'too_large', path, size: text.length }
        return { kind: 'file', path, text, sha: body.commitSha, size: text.length }
      },
      listTree: async () => ({ entries: [...files.keys()].map((p) => ({ path: p, size: files.get(p)!.length, sha: '' })), truncated: false }),
    }, 'ci')

    let findingsStored = 0
    let deviance: CiDevianceResult | null = null
    if (result.ok && body.deviance) {
      try {
        deviance = await deps.recordCiDeviance(db, projectId, { commitSha: body.commitSha, branch: body.branch, push: body.deviance, keyExposure: deps.keyExposure(c) })
        findingsStored = deviance.storedFindings
      } catch (err) {
        ilog.error('ci deviance scan failed', { projectId, err: (err as Error)?.message })
        return jsonError(c, 'DEVIANCE_FAILED', `The recipe was stored, but the deviance scan could not be: ${String((err as Error)?.message ?? err).slice(0, 200)}`, 500)
      }
    } else if (result.ok && body.findings) {
      const now = deps.now().toISOString()
      const status = body.findings.length ? 'warn' : 'pass'
      const { data: run, error } = await db.from('gate_runs').insert({
        project_id: projectId, gate: DESIGN_GATE, status, commit_sha: body.commitSha, triggered_by: 'ci', findings_count: body.findings.length,
        summary: { phase: 'ci_scan', source: 'ci', score: null, scannedFiles: body.scannedFiles ?? 0, storedFindings: body.findings.length },
        started_at: now, completed_at: now,
      }).select('id').single()
      if (!error && run) {
        const rows = body.findings.map((f) => ({
          gate_run_id: (run as { id: string }).id, project_id: projectId, severity: 'warn', rule_id: f.ruleId,
          message: `${f.filePath}:${f.line} uses ${f.value}, which matches no design token.`, file_path: f.filePath, line: f.line, allowlisted: false,
        }))
        if (rows.length) {
          const { error: fErr } = await db.from('gate_findings').insert(rows)
          if (!fErr) findingsStored = rows.length
          else await db.from('gate_runs').update({ status: 'error' }).eq('id', (run as { id: string }).id)
        }
      }
    }
    // A rejected push must fail the CI step, not pass it with a 200.
    if (!result.ok) return jsonError(c, 'RECIPE_REJECTED', result.reason, 422, { state: result.state, issues: result.issues })
    return c.json({ ok: true, data: { ...result, findingsStored, deviance } })
  })

  app.post('/v1/ingest/recipe/events', deps.apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string | null
    if (!projectId) return jsonError(c, 'PROJECT_KEY_REQUIRED', 'Use a key bound to the project these events belong to.', 400)
    const db = deps.getServiceClient()
    const limited = await rateLimited(c, db, projectId)
    if (limited) return limited
    const parsed = z.object({ events: z.array(eventSchema).min(1).max(50) }).strict().safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500), 400)
    const now = deps.now().toISOString()
    let stored = 0
    for (const e of parsed.data.events) {
      if (e.type === 'build.completed') {
        const { error } = await db.from('ci_workflow_runs').upsert({
          project_id: projectId, repo: 'external', run_id: syntheticRunId(e.id), workflow_path: e.workflow ?? null, name: e.workflow ?? null,
          head_branch: e.branch ?? null, head_sha: e.commit ?? null, status: 'completed', conclusion: e.conclusion,
          started_at: e.startedAt ?? null, completed_at: e.completedAt, est_billable_minutes: e.minutes ?? null, source: 'webhook',
        }, { onConflict: 'project_id,repo,run_id' })
        if (!error) stored++
      } else {
        const { error } = await db.from('deploy_observations').insert({
          project_id: projectId, target_id: e.targetId, environment: e.type === 'deploy.completed' ? e.environment ?? null : 'production',
          observed_version: e.version ?? null, observed_commit: e.commit ?? null, source: 'webhook',
          ok: e.type === 'deploy.completed' ? e.ok : true, error: e.type === 'deploy.completed' ? e.error ?? null : null, observed_at: now,
        })
        if (!error) stored++
      }
    }
    return c.json({ ok: true, data: { received: parsed.data.events.length, stored } })
  })

  app.post('/v1/ingest/recipe/csv', deps.jwtAuth, async (c) => {
    const db = deps.getServiceClient()
    const body = await c.req.json().catch(() => null) as { organizationId?: unknown; csv?: unknown } | null
    if (typeof body?.organizationId !== 'string' || typeof body.csv !== 'string') return jsonError(c, 'VALIDATION_ERROR', 'Send { organizationId, csv }.', 400)
    if (body.csv.length > 256 * 1024) return jsonError(c, 'PAYLOAD_TOO_LARGE', 'The CSV is over 256 KB.', 413)
    const access = await portfolioAccess(c, db, body.organizationId)
    if (!access.ok) return access.response
    if (!(await canImportResources(c, db, access.orgId))) return jsonError(c, 'FORBIDDEN', 'Only team owners and admins can import resources.', 403)
    const { data: projects } = await db.from('projects').select('id, slug, name').in('id', access.projectIds.length ? access.projectIds : ['00000000-0000-0000-0000-000000000000'])
    const resolveProject = (ref: string) => ((projects ?? []) as Array<{ id: string; slug: string | null; name: string | null }>).find((p) => p.id === ref || p.slug === ref || p.name === ref)?.id ?? null
    // Excel's "CSV UTF-8" starts the file with a byte-order mark, which would hide the `kind` header.
    // Blank lines are skipped but keep their place, so an error names the line the file really has.
    const lines = body.csv.replace(/^﻿/, '').split(/\r?\n/).map((text, i) => ({ n: i + 1, text: text.trim() })).filter((l) => l.text)
    const header = parseCsvLine(lines.shift()?.text ?? '').map((h) => h.toLowerCase())
    const col = (name: string) => header.indexOf(name)
    if (col('kind') < 0 || col('external_id') < 0 || col('project') < 0) return jsonError(c, 'VALIDATION_ERROR', 'The CSV needs the columns kind, external_id, project (and optionally role).', 400)
    const now = deps.now().toISOString()
    const errors: string[] = []
    let imported = 0
    for (const { n, text } of lines.slice(0, 500)) {
      const cells = parseCsvLine(text)
      const kind = cells[col('kind')]
      const externalId = cells[col('external_id')]
      const projectId = resolveProject(cells[col('project')] ?? '')
      const roleName = (col('role') >= 0 ? cells[col('role')] : '') || 'uses'
      if (!(PORTFOLIO_RESOURCE_KINDS as readonly string[]).includes(kind)) { errors.push(`line ${n}: unknown kind "${(kind ?? '').slice(0, 40)}"`); continue }
      if (!externalId || externalId.length > 300) { errors.push(`line ${n}: missing external_id`); continue }
      if (!projectId) { errors.push(`line ${n}: project not found in this team`); continue }
      const res = await upsertResource(db, access.orgId, kind, externalId, deps.now())
      if (!res) { errors.push(`line ${n}: could not save`); continue }
      const { error } = await db.from('portfolio_resource_uses').upsert({ resource_id: (res as { id: string }).id, project_id: projectId, role: roleName.slice(0, 60), source: 'csv', observed_at: now }, { onConflict: 'resource_id,project_id,role' })
      if (error) errors.push(`line ${n}: could not save the use`)
      else imported++
    }
    // `errors` is capped; `errorCount` counts every row that was not saved.
    return c.json({ ok: true, data: { imported, errorCount: errors.length, errors: errors.slice(0, CSV_LISTED_ERRORS), skippedOverLimit: Math.max(0, lines.length - 500) } })
  })

  app.get('/v1/admin/orgs/:orgId/portfolio/resources', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    try {
      const [{ data: resources }, { data: uses }, { data: findings }, canImport] = await Promise.all([
        db.from('portfolio_resources').select('id, kind, external_id, metadata').eq('organization_id', access.orgId).limit(1000),
        access.projectIds.length ? db.from('portfolio_resource_uses').select('resource_id, project_id, role, source, observed_at').in('project_id', access.projectIds).limit(5000) : Promise.resolve({ data: [] }),
        db.from('portfolio_findings').select('id, rule_id, severity, project_ids, resource_key, message, suggested_fix, updated_at').eq('organization_id', access.orgId).eq('status', 'open').limit(500),
        canImportResources(c, db, access.orgId),
      ])
      const useRows = (uses ?? []) as Array<{ resource_id: string; project_id: string; role: string; source: string }>
      const used = new Set(useRows.map((u) => u.resource_id))
      return c.json({
        ok: true,
        data: {
          organizationId: access.orgId,
          // Whether this caller may POST /v1/ingest/recipe/csv (a signed-in owner or admin).
          canImport,
          // Only resources a visible project uses, so a member never learns another team's ids.
          resources: ((resources ?? []) as Array<{ id: string; kind: string; external_id: string }>).filter((r) => used.has(r.id)).map((r) => ({
            id: r.id, kind: r.kind, externalId: r.external_id,
            uses: useRows.filter((u) => u.resource_id === r.id).map((u) => ({ projectId: u.project_id, role: u.role, source: u.source })),
          })),
          findings: ((findings ?? []) as Array<{ project_ids: string[] }>).filter((f) => f.project_ids.every((p) => access.projectIds.includes(p))),
        },
      })
    } catch (err) {
      ilog.error('resources read failed', { orgId: access.orgId, err: (err as Error)?.message })
      return jsonError(c, 'PORTFOLIO_FAILED', 'The shared resources could not be read.', 500)
    }
  })

  app.get('/v1/admin/projects/:id/recipe/drift', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const projectId = c.req.param('id') ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(projectId)) return jsonError(c, 'NOT_FOUND', 'Project not found', 404)
    const access = await callerCanAccessProject(c, db, c.get('userId') as string, projectId)
    if (!access.allowed) return jsonError(c, 'NOT_FOUND', 'Project not found', 404)
    // design_drift is read on its own, scans only: refresh errors and PR pushes are not drift and must never bury the latest scan.
    type DriftRun = { id: string; gate: string; status: string; summary: Record<string, unknown> | null; completed_at: string | null; commit_sha: string | null }
    let latest: DriftRun[]
    try {
      const [{ data: runs, error: runsErr }, designScans] = await Promise.all([
        db
          .from('gate_runs')
          .select('id, gate, status, summary, started_at, completed_at, commit_sha')
          .eq('project_id', projectId)
          .in('gate', RECIPE_DRIFT_GATES.filter((g) => g !== DESIGN_GATE))
          .order('started_at', { ascending: false })
          .limit(100),
        loadLatestDesignScans(db, [projectId]),
      ])
      if (runsErr) throw new Error(`gate_runs read failed: ${runsErr.message}`)
      latest = [...latestPerGate((runs ?? []) as DriftRun[]), ...designScans]
    } catch (err) {
      ilog.error('recipe drift read failed', { projectId, err: (err as Error)?.message })
      return jsonError(c, 'DRIFT_FAILED', 'The recipe drift could not be read.', 500)
    }
    const { data: findings } = latest.length
      ? await db.from('gate_findings').select('gate_run_id, rule_id, severity, message, file_path, line, suggested_fix').in('gate_run_id', latest.map((r) => r.id)).eq('allowlisted', false).limit(500)
      : { data: [] }
    const gateOf = new Map(latest.map((r) => [r.id, r.gate]))
    return c.json({
      ok: true,
      data: {
        projectId,
        gates: Object.fromEntries(RECIPE_DRIFT_GATES.map((g) => {
          const r = latest.find((x) => x.gate === g)
          return [g, r ? { status: r.status, checkedAt: r.completed_at, commitSha: r.commit_sha } : { status: 'never_run', checkedAt: null, commitSha: null }]
        })),
        findings: ((findings ?? []) as Array<{ gate_run_id: string; rule_id: string; severity: string; message: string; file_path: string | null; line: number | null; suggested_fix: unknown }>)
          .map((f) => ({ gate: gateOf.get(f.gate_run_id), ruleId: f.rule_id, severity: f.severity, message: f.message, filePath: f.file_path, line: f.line, suggestedFix: f.suggested_fix })),
      },
    })
  })
}
