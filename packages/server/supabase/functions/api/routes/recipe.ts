/**
 * recipe.ts — App Recipe (Plan 019 Phase 1) and design-plane (Phase 1b) routes.
 *
 * Reads:  adminOrApiKey(mcp:read) + callerCanAccessProject (404 when the
 *         caller cannot reach the project, including a project-bound key aimed
 *         at another project).
 * Writes: adminOrApiKey(mcp:write). Opening a PR also needs an owner/admin
 *         role. A design change is only ever a DRAFT PR (markReady: false) to
 *         allowlisted paths; Mushi never writes to the default branch.
 *
 * Shapes: _shared/recipe-types.ts. Every response is `{ ok: true, data }`.
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { createPrFromFiles } from '../../_shared/github-pr.ts'
import { fetchLatestWorkflowRunForSha } from '../../_shared/github.ts'
import {
  getDefaultHead,
  listActionsNames,
  readRepoBytes,
  readRepoFile,
  resolveRecipeRepo,
  type RecipeRepo,
} from '../../_shared/recipe-github.ts'
import { assetMime, signAssetUrl, verifyAssetSignature } from '../../_shared/design-assets.ts'
import { loadCurrentSnapshot, refreshRecipeSnapshot, startDesignDeviance, type SnapshotRow } from '../../_shared/design-plane.ts'
import { runInBackground } from '../../_shared/background.ts'
import { judgingSet, type StoredTokens } from '../../_shared/design-sets.ts'
import { applyActivateDirection, applyRulesEdit, applyTokenEdits, buildDuplicateDirection, DIRECTION_NAME_RE, unifiedDiff, type TokenFileEdit } from '../../_shared/design-change.ts'
import { effectiveDesignRules, isWritablePath, RECIPE_MANIFEST_MAX_BYTES, RECIPE_MANIFEST_PATH } from '../../_shared/recipe-schema.ts'
import { directionOf, MAX_ASSET_BYTES, MAX_TOKEN_FILE_BYTES } from '../../_shared/design-sets.ts'
import { DESIGN_RULE_IDS, RECIPE_ELEMENT_KEYS, type DesignChangeResult, type DesignDevianceRunResult, type DesignTokensResponse, type DevianceRun, type RecipeElementKey, type RecipeHistoryResponse } from '../../_shared/recipe-types.ts'
import { inferStack, requiredCiVarNames } from './project-ci-secrets.ts'
import { callerCanAccessProject, dbError, jsonError } from '../shared.ts'
import type { Variables } from '../types.ts'
import {
  buildDesignExcerpt,
  composeDesignPlane,
  composeDirections,
  composeRecipe,
  isScanRun,
  loadDesignRuns,
  loadRunFindings,
  toDevianceRun,
  type ComposeDeps,
} from './recipe-compose.ts'

const rlog = log.child('recipe')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000

type Db = ReturnType<typeof getServiceClient>

export interface RecipeRouteDeps extends ComposeDeps {
  getServiceClient: () => Db
  adminOrApiKeyRead: MiddlewareHandler
  adminOrApiKeyWrite: MiddlewareHandler
  refresh: typeof refreshRecipeSnapshot
  startDeviance: typeof startDesignDeviance
  runInBackground: typeof runInBackground
  loadSnapshot: typeof loadCurrentSnapshot
  readRepoFile: typeof readRepoFile
  readRepoBytes: typeof readRepoBytes
  createPr: typeof createPrFromFiles
  /** Key material for signed asset URLs; null disables previews (never a default key). */
  assetSecret: () => string | null
}

export const defaultRecipeDeps: RecipeRouteDeps = {
  getServiceClient,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  adminOrApiKeyWrite: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  refresh: refreshRecipeSnapshot,
  startDeviance: startDesignDeviance,
  runInBackground,
  loadSnapshot: loadCurrentSnapshot,
  readRepoFile,
  readRepoBytes,
  createPr: createPrFromFiles,
  assetSecret: () => {
    try {
      return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? null
    } catch {
      return null
    }
  },
  resolveRepo: resolveRecipeRepo,
  getDefaultHead,
  fetchWorkflowRun: (repo: RecipeRepo, branch: string, sha: string) => fetchLatestWorkflowRunForSha(repo.token, repo.ref, branch, sha),
  listActionsNames,
  requiredEnvNames: (slug) => requiredCiVarNames(inferStack(slug)).map((v) => v.name),
  now: () => new Date(),
}

type Access = { ok: true; projectId: string; role: string | null } | { ok: false; response: Response }

async function projectAccess(c: Context, db: Db, opts: { needAdmin?: boolean } = {}): Promise<Access> {
  const projectId = c.req.param('id') ?? ''
  if (!UUID_RE.test(projectId)) return { ok: false, response: jsonError(c, 'NOT_FOUND', 'Project not found', 404) }
  const userId = c.get('userId') as string
  const access = await callerCanAccessProject(c, db, userId, projectId)
  if (!access.allowed) return { ok: false, response: jsonError(c, 'NOT_FOUND', 'Project not found', 404) }
  if (opts.needAdmin && access.role !== 'owner' && access.role !== 'admin') {
    return { ok: false, response: jsonError(c, 'FORBIDDEN', 'Only project owners and admins can open design PRs.', 403) }
  }
  return { ok: true, projectId, role: access.role }
}

const tokenEditSchema = z.object({
  path: z.string().min(1).max(300),
  value: z.union([z.string().max(300), z.number(), z.array(z.string().max(80)).max(20)]),
  set: z.string().max(80).optional(),
})

const rulePatchSchema = z.object({
  enabled: z.boolean().optional(),
  severity: z.enum(['info', 'warn', 'error']).optional(),
  allowValues: z.array(z.string().max(100)).max(200).optional(),
  allowFiles: z.array(z.string().max(300)).max(100).optional(),
  primitives: z.record(z.string().max(40), z.string().max(80)).optional(),
}).strict()

function defaultChangeTitle(req: z.infer<typeof changeSchema>): string {
  switch (req.kind) {
    case 'tokens': return 'chore(design): update design tokens'
    case 'rules': return 'chore(design): update design rules'
    case 'activate': return `chore(design): make ${req.direction} the active direction`
    case 'duplicate': return `chore(design): add the ${req.name} direction`
  }
}

const changeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tokens'), edits: z.array(tokenEditSchema).min(1).max(50), dryRun: z.boolean().optional(), title: z.string().max(120).optional() }),
  z.object({ kind: z.literal('rules'), rules: z.record(z.enum(DESIGN_RULE_IDS), rulePatchSchema), dryRun: z.boolean().optional(), title: z.string().max(120).optional() }),
  z.object({ kind: z.literal('activate'), direction: z.string().min(1).max(80), dryRun: z.boolean().optional(), title: z.string().max(120).optional() }),
  z.object({
    kind: z.literal('duplicate'),
    from: z.string().min(1).max(80),
    name: z.string().regex(DIRECTION_NAME_RE),
    displayName: z.string().max(80).optional(),
    edits: z.array(tokenEditSchema.omit({ set: true })).max(50).optional(),
    dryRun: z.boolean().optional(),
    title: z.string().max(120).optional(),
  }),
])

export function registerRecipeRoutes(app: Hono<{ Variables: Variables }>, deps: RecipeRouteDeps = defaultRecipeDeps): void {
  // ── GET /v1/admin/projects/:id/recipe ──────────────────────────────────────
  app.get('/v1/admin/projects/:id/recipe', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await projectAccess(c, db)
    if (!access.ok) return access.response
    try {
      const { response } = await composeRecipe(db, deps, access.projectId)
      return c.json({ ok: true, data: response })
    } catch (err) {
      rlog.error('recipe compose failed', { projectId: access.projectId, err: String(err) })
      return jsonError(c, 'RECIPE_FAILED', 'Could not compose the recipe.', 500)
    }
  })

  // ── GET /v1/admin/projects/:id/recipe/elements/:element ────────────────────
  app.get('/v1/admin/projects/:id/recipe/elements/:element', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await projectAccess(c, db)
    if (!access.ok) return access.response
    const element = c.req.param('element') as RecipeElementKey
    if (!(RECIPE_ELEMENT_KEYS as readonly string[]).includes(element)) {
      return jsonError(c, 'VALIDATION_ERROR', `element must be one of ${RECIPE_ELEMENT_KEYS.join(', ')}`, 400)
    }
    try {
      const { response, details } = await composeRecipe(db, deps, access.projectId)
      return c.json({ ok: true, data: { element: response.elements[element], detail: details[element] } })
    } catch (err) {
      rlog.error('recipe element failed', { projectId: access.projectId, element, err: String(err) })
      return jsonError(c, 'RECIPE_FAILED', 'Could not compose the recipe.', 500)
    }
  })

  // ── POST /v1/admin/projects/:id/recipe/refresh ─────────────────────────────
  app.post('/v1/admin/projects/:id/recipe/refresh', deps.adminOrApiKeyWrite, async (c) => {
    const db = deps.getServiceClient()
    const access = await projectAccess(c, db)
    if (!access.ok) return access.response
    const current = await deps.loadSnapshot(db, access.projectId)
    if (current && deps.now().getTime() - Date.parse(current.captured_at) < REFRESH_COOLDOWN_MS) {
      return jsonError(c, 'RATE_LIMITED', 'The recipe was refreshed in the last 5 minutes. Try again shortly.', 429)
    }
    const result = await deps.refresh(db, access.projectId, c.get('authMethod') === 'apiKey' ? 'mcp' : 'manual')
    return c.json({ ok: true, data: result })
  })

  // ── GET /v1/admin/projects/:id/recipe/history ──────────────────────────────
  app.get('/v1/admin/projects/:id/recipe/history', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await projectAccess(c, db)
    if (!access.ok) return access.response
    const { data, error } = await db
      .from('app_recipe_snapshots')
      .select('id, captured_at, commit_sha, source, tokens_hash, is_current, tokens, validation_errors')
      .eq('project_id', access.projectId)
      .order('captured_at', { ascending: false })
      .limit(20)
    if (error) return dbError(c, error)
    const rows = (data ?? []) as Array<SnapshotRow>
    const snapshots = rows.map((r) => ({
      id: r.id,
      capturedAt: r.captured_at,
      commitSha: r.commit_sha,
      source: r.source,
      tokensHash: r.tokens_hash,
      isCurrent: r.is_current,
      tokenCount: judgingSet(r.tokens as StoredTokens | null)?.tokens.length ?? 0,
      validationErrorCount: (r.validation_errors ?? []).length,
    }))
    let latestDiff: RecipeHistoryResponse['latestDiff'] = null
    if (rows.length >= 2) {
      const toMap = (r: SnapshotRow) => new Map((judgingSet(r.tokens as StoredTokens | null)?.tokens ?? []).map((t) => [t.path, t.display]))
      const next = toMap(rows[0])
      const prev = toMap(rows[1])
      latestDiff = {
        fromSnapshotId: rows[1].id,
        toSnapshotId: rows[0].id,
        added: [...next.keys()].filter((k) => !prev.has(k)).slice(0, 200),
        removed: [...prev.keys()].filter((k) => !next.has(k)).slice(0, 200),
        changed: [...next.entries()].filter(([k, v]) => prev.has(k) && prev.get(k) !== v).slice(0, 200).map(([path, to]) => ({ path, from: prev.get(path)!, to })),
      }
    }
    return c.json({ ok: true, data: { snapshots, latestDiff } satisfies RecipeHistoryResponse })
  })

  // ── GET /v1/admin/projects/:id/design ──────────────────────────────────────
  app.get('/v1/admin/projects/:id/design', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await projectAccess(c, db)
    if (!access.ok) return access.response
    try {
      const [snapshot, repo] = await Promise.all([deps.loadSnapshot(db, access.projectId), deps.resolveRepo(db, access.projectId)])
      const data = await composeDesignPlane(db, access.projectId, snapshot, repo, c.req.query('direction') ?? null, deps.now())
      return c.json({ ok: true, data })
    } catch (err) {
      rlog.error('design plane failed', { projectId: access.projectId, err: String(err) })
      return jsonError(c, 'DESIGN_FAILED', 'Could not load the design system.', 500)
    }
  })

  // ── GET /v1/admin/projects/:id/design/tokens ───────────────────────────────
  app.get('/v1/admin/projects/:id/design/tokens', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await projectAccess(c, db)
    if (!access.ok) return access.response
    const snapshot = await deps.loadSnapshot(db, access.projectId)
    const stored = (snapshot?.tokens ?? null) as StoredTokens | null
    const direction = c.req.query('direction')
    const set = (direction ? stored?.sets.find((s) => s.name === direction) : null) ?? judgingSet(stored)
    const group = c.req.query('group')
    const type = c.req.query('type')
    const tokens = (set?.tokens ?? []).filter((t) => (!group || t.group === group) && (!type || t.type === type))
    const nameMap: Record<string, string> = {}
    for (const t of set?.tokens ?? []) {
      if (t.cssVar) nameMap[t.cssVar] = t.path
      if (t.ts) nameMap[t.ts] = t.path
    }
    const data: DesignTokensResponse = { projectId: access.projectId, set: set?.name ?? null, tokens: tokens.slice(0, 500), nameMap, total: tokens.length }
    return c.json({ ok: true, data })
  })

  // ── GET /v1/admin/projects/:id/design/deviance ─────────────────────────────
  app.get('/v1/admin/projects/:id/design/deviance', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await projectAccess(c, db)
    if (!access.ok) return access.response
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 25) || 25, 1), 200)
    const [runs, snapshot] = await Promise.all([loadDesignRuns(db, access.projectId), deps.loadSnapshot(db, access.projectId)])
    const now = deps.now()
    const scans = runs.filter(isScanRun).map((r) => toDevianceRun(r, now))
    const latest = scans.find((r) => r.status !== 'running') ?? null
    const findings = latest && latest.status !== 'error' ? await loadRunFindings(db, latest.runId, limit) : []
    return c.json({
      ok: true,
      data: {
        projectId: access.projectId,
        latest,
        running: scans[0]?.status === 'running' ? scans[0] : null,
        trend: scans.filter((r) => r.status !== 'running').slice(0, 30).reverse().map((r) => ({ at: r.completedAt ?? r.startedAt, score: r.score, status: r.status })),
        findings,
        rules: effectiveDesignRules(snapshot?.manifest ?? null),
      },
    })
  })

  // ── POST /v1/admin/projects/:id/design/deviance/run ────────────────────────
  app.post('/v1/admin/projects/:id/design/deviance/run', deps.adminOrApiKeyWrite, async (c) => {
    const db = deps.getServiceClient()
    const access = await projectAccess(c, db)
    if (!access.ok) return access.response
    const now = deps.now()
    const runs = await loadDesignRuns(db, access.projectId, 5)
    const recent = runs.filter(isScanRun).map((r) => toDevianceRun(r, now)).find((r) => r.status !== 'error')
    if (recent && now.getTime() - Date.parse(recent.startedAt) < REFRESH_COOLDOWN_MS) {
      return jsonError(c, 'RATE_LIMITED', recent.status === 'running' ? 'A deviance check is already running.' : 'A deviance check ran in the last 5 minutes. Try again shortly.', 429)
    }
    if (recent?.status === 'running') return jsonError(c, 'RATE_LIMITED', 'A deviance check is already running.', 429)
    const trigger = c.get('authMethod') === 'apiKey' ? 'mcp' : 'manual'
    const refresh = await deps.refresh(db, access.projectId, trigger)
    if (!refresh.ok || refresh.tokenCount === 0) {
      return c.json({ ok: true, data: { refresh, run: null } satisfies DesignDevianceRunResult })
    }
    // The scan reads up to 1,500 files; it finishes in the background and
    // the console polls GET /design/deviance until `running` clears.
    const started = await deps.startDeviance(db, access.projectId, trigger)
    if (!started.ok) return jsonError(c, 'DEVIANCE_FAILED', started.error, 502)
    deps.runInBackground(started.execute(), 'design-deviance-scan')
    const run: DevianceRun = {
      runId: started.runId, status: 'running', score: null, scannedFiles: 0, scannedLines: 0, matchedFiles: 0, truncated: false,
      commitSha: started.commitSha, startedAt: started.startedAt, completedAt: null, breakdown: [], counts: {}, storedFindings: 0, error: null,
    }
    return c.json({ ok: true, data: { refresh, run } satisfies DesignDevianceRunResult }, 202)
  })

  // ── GET /v1/admin/projects/:id/design/excerpt ──────────────────────────────
  app.get('/v1/admin/projects/:id/design/excerpt', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await projectAccess(c, db)
    if (!access.ok) return access.response
    const files = (c.req.query('files') ?? '').split(',').map((f) => f.trim()).filter(Boolean).slice(0, 20)
    const [snapshot, repo] = await Promise.all([deps.loadSnapshot(db, access.projectId), deps.resolveRepo(db, access.projectId)])
    const plane = await composeDesignPlane(db, access.projectId, snapshot, repo, null, deps.now())
    const runId = plane.deviance.latest?.runId
    const fileFindings = runId && files.length > 0 ? await loadRunFindings(db, runId, 200) : []
    return c.json({ ok: true, data: buildDesignExcerpt(plane, files, fileFindings) })
  })

  // ── GET /v1/admin/projects/:id/design/directions ───────────────────────────
  app.get('/v1/admin/projects/:id/design/directions', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await projectAccess(c, db)
    if (!access.ok) return access.response
    try {
      const [snapshot, repo] = await Promise.all([deps.loadSnapshot(db, access.projectId), deps.resolveRepo(db, access.projectId)])
      const secret = deps.assetSecret()
      const now = deps.now()
      const sign = secret ? (path: string) => signAssetUrl(secret, access.projectId, path, now.getTime()) : null
      const data = await composeDirections(db, access.projectId, snapshot, repo, now, sign)
      return c.json({ ok: true, data })
    } catch (err) {
      rlog.error('design directions failed', { projectId: access.projectId, err: String(err) })
      return jsonError(c, 'DESIGN_FAILED', 'Could not load the design directions.', 500)
    }
  })

  // ── GET /v1/design-assets/:projectId (signed URL, no auth header) ─────────
  // An <img> cannot send the console's bearer token. The URL carries an HMAC
  // over (project, path, expiry) minted by the adminOrApiKey route above, and
  // the path must still be an asset the current snapshot lists.
  app.get('/v1/design-assets/:projectId', async (c) => {
    const projectId = c.req.param('projectId') ?? ''
    const path = c.req.query('path') ?? ''
    const secret = deps.assetSecret()
    if (!UUID_RE.test(projectId) || !path || !secret) return new Response('Not found', { status: 404 })
    const check = await verifyAssetSignature(secret, projectId, path, c.req.query('exp'), c.req.query('sig'), deps.now().getTime())
    if (!check.ok) return new Response(check.reason === 'expired' ? 'Link expired' : 'Forbidden', { status: 403 })
    const mime = assetMime(path)
    const db = deps.getServiceClient()
    const snapshot = await deps.loadSnapshot(db, projectId)
    const listed = ((snapshot?.tokens ?? null) as StoredTokens | null)?.sets.some((s) => (s.assets ?? []).some((a) => a.path === path))
    if (!mime || !snapshot || !listed) return new Response('Not found', { status: 404 })
    const repo = await deps.resolveRepo(db, projectId)
    if (!repo.ok) return new Response('Not found', { status: 404 })
    try {
      const file = await deps.readRepoBytes(repo.repo, snapshot.commit_sha ?? repo.repo.defaultBranchHint, path, MAX_ASSET_BYTES)
      if (file.kind === 'too_large') return new Response('Too large', { status: 413 })
      if (file.kind === 'absent') return new Response('Not found', { status: 404 })
      return new Response(file.bytes, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Cache-Control': 'private, max-age=300',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        },
      })
    } catch (err) {
      rlog.warn('design asset read failed', { projectId, path, err: String(err) })
      return new Response('Upstream error', { status: 502 })
    }
  })

  // ── POST /v1/admin/projects/:id/design/changes ─────────────────────────────
  app.post('/v1/admin/projects/:id/design/changes', deps.adminOrApiKeyWrite, async (c) => {
    const db = deps.getServiceClient()
    const body = await c.req.json().catch(() => null)
    const parsed = changeSchema.safeParse(body)
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'invalid body', 400)
    const req = parsed.data
    const dryRun = req.dryRun !== false
    const access = await projectAccess(c, db, { needAdmin: !dryRun })
    if (!access.ok) return access.response

    const snapshot = await deps.loadSnapshot(db, access.projectId)
    const manifest = snapshot?.manifest ?? null
    if (!snapshot || !manifest) return jsonError(c, 'NO_MANIFEST', 'Add a valid mushi.recipe.json to the repo and refresh first.', 409)
    const repo = await deps.resolveRepo(db, access.projectId)
    if (!repo.ok) return jsonError(c, 'NO_REPO', repo.reason, 409)
    const stored = snapshot.tokens as StoredTokens | null

    let head: { branch: string; sha: string }
    try {
      head = await deps.getDefaultHead(repo.repo)
    } catch (err) {
      return jsonError(c, 'GITHUB_FAILED', (err as Error).message, 502)
    }

    const sourceFiles = (stored?.sets ?? []).flatMap((s) => s.files.filter((f) => f.role === 'source').map((f) => f.path))
    const scope = [...new Set([...sourceFiles, RECIPE_MANIFEST_PATH])]
    const denied: DesignChangeResult['denied'] = []
    const changes: Array<{ path: string; before: string; after: string; reason: string }> = []

    const readLive = async (path: string, cap: number): Promise<string | Response> => {
      try {
        const file = await deps.readRepoFile(repo.repo, head.sha, path, cap)
        if (file.kind === 'absent') return jsonError(c, 'FILE_GONE', `${path} no longer exists on ${head.branch}; refresh the recipe.`, 409)
        if (file.kind === 'too_large') return jsonError(c, 'FILE_TOO_LARGE', `${path} is too large to edit from the console.`, 409)
        return file.text
      } catch (err) {
        return jsonError(c, 'GITHUB_FAILED', (err as Error).message, 502)
      }
    }

    if (req.kind === 'tokens') {
      const byFile = new Map<string, TokenFileEdit[]>()
      for (const e of req.edits) {
        const set = (e.set ? stored?.sets.find((s) => s.name === e.set) : null) ?? judgingSet(stored)
        const token = set?.tokens.find((t) => t.path === e.path)
        if (!token) return jsonError(c, 'UNKNOWN_TOKEN', `${e.path} is not a token in ${set?.name ?? 'the active set'}.`, 400)
        if (token.role !== 'source') {
          denied.push({ path: token.file, reason: 'this token file is a generated export; edit its source instead' })
          continue
        }
        const check = isWritablePath(token.file, manifest, scope)
        if (!check.ok) {
          denied.push({ path: token.file, reason: check.reason })
          continue
        }
        const list = byFile.get(check.path) ?? []
        list.push({ path: token.path, type: token.type, value: e.value })
        byFile.set(check.path, list)
      }
      for (const [path, edits] of byFile) {
        const before = await readLive(path, MAX_TOKEN_FILE_BYTES)
        if (typeof before !== 'string') return before
        const applied = applyTokenEdits(before, edits)
        if (!applied.ok) return jsonError(c, 'EDIT_REJECTED', applied.reason, 400)
        changes.push({ path, before, after: applied.text, reason: `update design tokens ${edits.map((e) => e.path).join(', ')}`.slice(0, 200) })
      }
    } else if (req.kind === 'activate') {
      const target = stored?.sets.find((s) => s.kind === 'direction' && s.name === req.direction)
      if (!target) return jsonError(c, 'UNKNOWN_DIRECTION', `${req.direction} is not a direction in the last refresh.`, 400)
      if (target.active) return jsonError(c, 'NO_CHANGE', `${req.direction} is already the active direction.`, 400)
      const check = isWritablePath(RECIPE_MANIFEST_PATH, manifest, scope)
      if (!check.ok) {
        denied.push({ path: RECIPE_MANIFEST_PATH, reason: check.reason })
      } else {
        const before = await readLive(RECIPE_MANIFEST_PATH, RECIPE_MANIFEST_MAX_BYTES)
        if (typeof before !== 'string') return before
        const applied = applyActivateDirection(before, target.files.filter((f) => f.role === 'source').map((f) => f.path))
        if (!applied.ok) return jsonError(c, 'EDIT_REJECTED', applied.reason, 400)
        changes.push({ path: RECIPE_MANIFEST_PATH, before, after: applied.text, reason: `make ${req.direction} the active design direction` })
      }
    } else if (req.kind === 'duplicate') {
      const from = stored?.sets.find((s) => s.kind === 'direction' && s.name === req.from)
      if (!from) return jsonError(c, 'UNKNOWN_DIRECTION', `${req.from} is not a direction in the last refresh.`, 400)
      if (stored?.sets.some((s) => s.name === req.name)) return jsonError(c, 'DIRECTION_EXISTS', `A direction named ${req.name} already exists.`, 409)
      const sources = from.files.filter((f) => f.role === 'source' && directionOf(f.path))
      const newPaths = sources.map((f) => f.path.replace(`/directions/${req.from}/`, `/directions/${req.name}/`))
      for (const p of newPaths) {
        const check = isWritablePath(p, manifest, newPaths)
        if (!check.ok) denied.push({ path: p, reason: check.reason })
      }
      if (denied.length === 0) {
        const texts: Array<{ path: string; text: string }> = []
        for (const f of sources) {
          const t = await readLive(f.path, MAX_TOKEN_FILE_BYTES)
          if (typeof t !== 'string') return t
          texts.push({ path: f.path, text: t })
        }
        for (const p of newPaths) {
          try {
            const existing = await deps.readRepoFile(repo.repo, head.sha, p, MAX_TOKEN_FILE_BYTES)
            if (existing.kind !== 'absent') return jsonError(c, 'DIRECTION_EXISTS', `${p} already exists on ${head.branch}.`, 409)
          } catch (err) {
            return jsonError(c, 'GITHUB_FAILED', (err as Error).message, 502)
          }
        }
        const typeOf = new Map(from.tokens.map((t) => [t.path, t.type]))
        const edits: TokenFileEdit[] = []
        for (const e of req.edits ?? []) {
          if (!typeOf.has(e.path)) return jsonError(c, 'UNKNOWN_TOKEN', `${e.path} is not a token in ${req.from}.`, 400)
          edits.push({ path: e.path, type: typeOf.get(e.path) ?? null, value: e.value })
        }
        const built = buildDuplicateDirection(texts, req.from, req.name, req.displayName ?? null, edits)
        if (!built.ok) return jsonError(c, 'EDIT_REJECTED', built.reason, 400)
        for (const f of built.files) changes.push({ path: f.path, before: '', after: f.text, reason: `add design direction ${req.name} (copied from ${req.from})` })
      }
    } else {
      const check = isWritablePath(RECIPE_MANIFEST_PATH, manifest, scope)
      if (!check.ok) {
        denied.push({ path: RECIPE_MANIFEST_PATH, reason: check.reason })
      } else {
        const before = await readLive(RECIPE_MANIFEST_PATH, RECIPE_MANIFEST_MAX_BYTES)
        if (typeof before !== 'string') return before
        const applied = applyRulesEdit(before, req.rules)
        if (!applied.ok) return jsonError(c, 'EDIT_REJECTED', applied.reason, 400)
        changes.push({ path: RECIPE_MANIFEST_PATH, before, after: applied.text, reason: `update design rules ${Object.keys(req.rules).join(', ')}`.slice(0, 200) })
      }
    }

    const files = changes
      .map((ch) => ({ ch, d: unifiedDiff(ch.path, ch.before, ch.after) }))
      .filter((x) => x.d.additions + x.d.deletions > 0)
    const result: DesignChangeResult = {
      dryRun,
      files: files.map((x) => ({ path: x.ch.path, diff: x.d.diff, additions: x.d.additions, deletions: x.d.deletions })),
      denied,
      pr: null,
    }
    if (dryRun) return c.json({ ok: true, data: result })
    if (denied.length > 0) return jsonError(c, 'PATH_NOT_WRITABLE', denied.map((d) => `${d.path}: ${d.reason}`).join('; '), 400)
    if (files.length === 0) return jsonError(c, 'NO_CHANGE', 'Nothing would change; the values already match.', 400)

    const userId = c.get('userId') as string
    const title = req.title?.trim() || defaultChangeTitle(req)
    const prBody = [
      'Proposed from the Mushi console design plane (Plan 019).',
      '',
      ...files.map((x) => `- \`${x.ch.path}\`: ${x.ch.reason}`),
      '',
      'This PR stays a **draft** so your CI does not run until you mark it ready for review.',
      `Requested by ${c.get('authMethod') === 'apiKey' ? `API key ${String(c.get('apiKeyPrefix') ?? '')}` : `console user ${userId}`}.`,
    ].join('\n')
    try {
      const pr = await deps.createPr({
        token: repo.repo.token,
        owner: repo.repo.ref.owner,
        repo: repo.repo.ref.repo,
        defaultBranch: head.branch,
        branch: `mushi/recipe-design-${deps.now().getTime().toString(36)}`,
        title,
        body: prBody,
        files: files.map((x) => ({ path: x.ch.path, contents: x.ch.after, reason: x.ch.reason })),
        category: 'chore',
        markReady: false,
      })
      rlog.info('design draft PR opened', { projectId: access.projectId, pr: pr.number, files: files.length, userId })
      return c.json({ ok: true, data: { ...result, pr: { url: pr.url, number: pr.number, branch: pr.branch, draft: true } } })
    } catch (err) {
      rlog.error('design draft PR failed', { projectId: access.projectId, err: String(err) })
      return jsonError(c, 'PR_FAILED', `Could not open the draft PR: ${(err as Error).message}`.slice(0, 300), 502)
    }
  })
}
