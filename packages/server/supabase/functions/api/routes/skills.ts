/**
 * skills.ts — Skill pipeline endpoints
 *
 * Admin (JWT or MCP API key):
 *   GET    /v1/admin/skills                          — list skill catalog (paginated, filterable by category/search)
 *   GET    /v1/admin/skills/:slug                    — get single skill with full body
 *   GET    /v1/admin/skills/sources                  — list skill sources for project
 *   POST   /v1/admin/skills/sources                  — add a new skill source
 *   POST   /v1/admin/skills/sources/:id/sync         — trigger sync for a single source
 *   DELETE /v1/admin/skills/sources/:id              — remove a source and retire its skills
 *
 *   GET    /v1/admin/skills/pipelines                — list pipeline runs for a project
 *   POST   /v1/admin/skills/pipelines                — start a new pipeline run
 *   GET    /v1/admin/skills/pipelines/:id            — run detail + step runs
 *   DELETE /v1/admin/skills/pipelines/:id            — abort a run (stops its Cursor agents)
 *   POST   /v1/admin/skills/pipelines/:runId/steps/:stepIndex/checkin — check in a step (CLI/agent)
 *
 * Phase 1 of Skill-Driven Triage Pipelines feature.
 */

import { Hono } from 'npm:hono@4'
import type { Context } from 'npm:hono@4'
import { requireAuthOrApiKey } from '../middleware/auth.ts'
import { checkProjectAccessIfNamed } from '../middleware/project.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { accessibleProjectIds } from '../../_shared/project-access.ts'
import { assertCallerProjectScope, assertTargetProjectAccess } from '../shared.ts'
import { claimTenantRateLimit, logTenantContext, tenantContextFromHono } from '../../_shared/tenant-observability.ts'
import { getRelevantCode } from '../../_shared/rag.ts'
import { composeRunPacket, resolveChain } from '../../_shared/skill-packet.ts'
import { dispatchPluginEvent } from '../../_shared/plugins.ts'
import {
  dedupeSkillsBySlug,
  findActiveSkillBySlug,
  projectSkillSourceIds,
} from '../../_shared/skill-catalog.ts'
import { unwrapUpstreamError } from '../../_shared/upstream-error.ts'
import { stopCursorAgentLatestRun, type CursorStopOutcome } from '../../_shared/agent-adapters.ts'
import type { Variables } from '../types.ts'

const app = new Hono<{ Variables: Variables }>()

function db() {
  return getServiceClient()
}

const REPORT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Upper bound on catalog rows read before de-duplicating by slug. */
const CATALOG_SCAN_CAP = 5000

/** Run states a step check-in may still change. */
const OPEN_RUN_STATUSES = ['pending', 'running']

function projectIdFromRequest(c: Context<{ Variables: Variables }>): string | null {
  return (
    c.req.query('project_id') ??
    c.req.header('x-mushi-project-id') ??
    c.req.header('X-Mushi-Project-Id') ??
    null
  )
}

async function assertRunAccess(
  c: Context<{ Variables: Variables }>,
  runId: string,
): Promise<{ ok: true; projectId: string } | { ok: false; response: Response }> {
  const { data: run } = await db()
    .from('skill_pipeline_runs')
    .select('id, project_id')
    .eq('id', runId)
    .maybeSingle()

  if (!run) {
    return { ok: false, response: c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Run not found' } }, 404) }
  }

  const authMethod = c.get('authMethod') as string | undefined
  const userId = c.get('userId') as string | undefined
  let allowed: string[]
  if (authMethod === 'apiKey') {
    const bound = c.get('projectId') as string | undefined
    allowed = bound ? [bound] : []
    const scopeErr = assertCallerProjectScope(c, run.project_id as string)
    if (scopeErr) return { ok: false, response: scopeErr }
  } else if (userId) {
    allowed = await accessibleProjectIds(db(), userId)
  } else {
    return { ok: false, response: c.json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401) }
  }

  if (!allowed.includes(run.project_id as string)) {
    return { ok: false, response: c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Access denied' } }, 403) }
  }

  return { ok: true, projectId: run.project_id as string }
}

export function registerSkillsRoutes(parent: Hono<{ Variables: Variables }>) {
  parent.route('/v1/admin/skills', skillsRoutes())
}

function skillsRoutes() {
  const r = new Hono<{ Variables: Variables }>()
  r.use('*', requireAuthOrApiKey, checkProjectAccessIfNamed)

  // ── Catalog ─────────────────────────────────────────────────────────────

  // ── Sidebar stats ───────────────────────────────────────────────────────

  r.get('/stats', async (c) => {
    const projectId = projectIdFromRequest(c)
    if (!projectId) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'project_id required' } }, 400)
    }

    const { data: projectRow } = await db()
      .from('projects')
      .select('id, name')
      .eq('id', projectId)
      .maybeSingle()

    const [{ data: slugRows }, { data: runs }] = await Promise.all([
      // Distinct slugs: the same repo added by two projects stores each skill
      // once per source, and the catalog shows it once (skill-catalog.ts).
      db()
        .from('agent_skills')
        .select('slug')
        .eq('is_active', true)
        .limit(CATALOG_SCAN_CAP),
      db()
        .from('skill_pipeline_runs')
        .select('id, status')
        .eq('project_id', projectId)
        .in('status', ['pending', 'running', 'failed'])
        .limit(200),
    ])

    let activeRuns = 0
    let failedRuns = 0
    const activeRunIds: string[] = []
    for (const run of runs ?? []) {
      const status = run.status as string
      if (status === 'running' || status === 'pending') {
        activeRuns += 1
        activeRunIds.push(run.id as string)
      } else if (status === 'failed') {
        failedRuns += 1
      }
    }

    const catalogTotal = new Set((slugRows ?? []).map((r) => r.slug as string)).size

    let awaitingCheckin = 0
    if (activeRunIds.length > 0) {
      const { count } = await db()
        .from('skill_pipeline_step_runs')
        .select('id', { count: 'exact', head: true })
        .in('run_id', activeRunIds)
        .eq('status', 'pending')
      awaitingCheckin = count ?? 0
    }

    const scoped = (path: string) =>
      `${path}${path.includes('?') ? '&' : '?'}project=${encodeURIComponent(projectId)}`

    let topPriority: 'empty_catalog' | 'failed_runs' | 'awaiting_checkin' | 'active_runs' | 'healthy' =
      'healthy'
    let topPriorityLabel: string | null = null
    let topPriorityTo: string | null = null

    if ((catalogTotal ?? 0) === 0) {
      topPriority = 'empty_catalog'
      topPriorityLabel = 'Skill catalog is empty — add a GitHub source and sync (try kensaurus/skills).'
      topPriorityTo = scoped('/skills?tab=sources')
    } else if (failedRuns > 0) {
      topPriority = 'failed_runs'
      topPriorityLabel = `${failedRuns} pipeline run${failedRuns === 1 ? '' : 's'} failed — open the run to read the step error.`
      topPriorityTo = scoped('/skills?tab=pipelines')
    } else if (awaitingCheckin > 0) {
      topPriority = 'awaiting_checkin'
      topPriorityLabel = `${awaitingCheckin} step${awaitingCheckin === 1 ? '' : 's'} waiting for handoff check-in in your IDE.`
      topPriorityTo = scoped('/skills?tab=pipelines')
    } else if (activeRuns > 0) {
      topPriority = 'active_runs'
      topPriorityLabel = `${activeRuns} pipeline run${activeRuns === 1 ? '' : 's'} in progress — watch steps update live.`
      topPriorityTo = scoped('/skills?tab=pipelines')
    } else {
      topPriority = 'healthy'
      topPriorityLabel = `${catalogTotal ?? 0} skills synced — attach one to a report or start from the catalog.`
      topPriorityTo = scoped('/skills?tab=catalog')
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId,
        projectName: projectRow?.name ?? null,
        catalogTotal: catalogTotal ?? 0,
        activeRuns,
        failedRuns,
        awaitingCheckin,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    })
  })

  // List skills — paginated, filterable by category or free-text search.
  // One row per slug (skill-catalog.ts): reads every matching row, keeps the
  // caller project's own copy of a duplicated slug, then pages in memory.
  r.get('/', async (c) => {
    const category = c.req.query('category')
    const search = c.req.query('q')
    const page = Math.max(parseInt(c.req.query('page') ?? '1', 10) || 1, 1)
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '200', 10) || 200, 1), 200)

    let q = db()
      .from('agent_skills')
      .select('id, slug, source_id, category, title, description, chain_slugs, license, created_at, updated_at')
      .eq('is_active', true)
      .order('category', { ascending: true })
      .order('slug', { ascending: true })
      .limit(CATALOG_SCAN_CAP)

    if (category) q = q.eq('category', category)
    if (search) {
      // Simple substring search — embeddings-based search handled by MCP tools.
      // Strip characters that have meaning in PostgREST's .or() filter grammar
      // (comma = OR separator, parens = grouping, * / % = wildcards, \ = escape)
      // to prevent a crafted `q` from injecting extra filter conditions.
      const safe = search.replace(/[,()*%\\]/g, ' ').trim()
      if (safe) {
        q = q.or(`slug.ilike.%${safe}%,title.ilike.%${safe}%,description.ilike.%${safe}%`)
      }
    }

    const { data, error } = await q
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

    const preferred = await projectSkillSourceIds(db(), projectIdFromRequest(c))
    const unique = dedupeSkillsBySlug(
      (data ?? []) as Array<{ slug: string; source_id: string | null; updated_at: string | null; id: string; category: string }>,
      preferred,
    )
    const pageRows = unique.slice((page - 1) * limit, page * limit)

    // Group by category for the catalog browser
    const grouped: Record<string, typeof pageRows> = {}
    for (const skill of pageRows) {
      const cat = skill.category as string
      if (!grouped[cat]) grouped[cat] = []
      grouped[cat].push(skill)
    }

    return c.json({ ok: true, data: pageRows, grouped, total: unique.length, page, limit })
  })

  // ── Sources ──────────────────────────────────────────────────────────────

  r.get('/sources', async (c) => {
    const projectId = projectIdFromRequest(c)
    if (!projectId) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'project_id required' } }, 400)
    }
    const { data, error } = await db()
      .from('skill_sources')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

    const sources = data ?? []
    const withCounts = await Promise.all(
      sources.map(async (src) => {
        const { count } = await db()
          .from('agent_skills')
          .select('id', { count: 'exact', head: true })
          .eq('source_id', src.id as string)
          .eq('is_active', true)
        return { ...src, catalog_count: count ?? 0 }
      }),
    )
    return c.json({ ok: true, data: withCounts })
  })

  r.post('/sources', async (c) => {
    const body = await c.req.json()
    const projectId =
      (typeof body.project_id === 'string' ? body.project_id : null) ?? projectIdFromRequest(c)

    if (!projectId || !body.repo_slug) {
      return c.json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'project_id and repo_slug are required' },
      }, 400)
    }

    const userId = c.get('userId') as string
    const access = await assertTargetProjectAccess(c, db(), userId, projectId)
    if (!access.ok) return access.response

    // Validate slug format: owner/repo
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(body.repo_slug)) {
      return c.json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'repo_slug must be "owner/repo" format' },
      }, 400)
    }

    const { data, error } = await db()
      .from('skill_sources')
      .insert({
        project_id: projectId,
        repo_slug: body.repo_slug,
        ref: body.ref ?? 'main',
        enabled: body.enabled !== false,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return c.json({
          ok: false,
          error: { code: 'DUPLICATE', message: `Source "${body.repo_slug}" is already added for this project` },
        }, 409)
      }
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    }
    return c.json({ ok: true, data }, 201)
  })

  // Cloud pipeline readiness for the active project
  r.get('/cloud-readiness', async (c) => {
    const projectId = projectIdFromRequest(c)
    if (!projectId) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'project_id required' } }, 400)
    }
    const { data: settings } = await db()
      .from('project_settings')
      .select('cursor_api_key_ref, github_repo_url')
      .eq('project_id', projectId)
      .maybeSingle()
    const row = settings as { cursor_api_key_ref?: string | null; github_repo_url?: string | null } | null
    const hasCursorKey = Boolean(row?.cursor_api_key_ref)
    const hasGithubRepo = Boolean(row?.github_repo_url)
    return c.json({
      ok: true,
      data: {
        cursorKeyConfigured: hasCursorKey,
        githubRepoConfigured: hasGithubRepo,
        cloudReady: hasCursorKey && hasGithubRepo,
      },
    })
  })

  r.post('/sources/:id/sync', async (c) => {
    const sourceId = c.req.param('id')

    // Verify the source belongs to an accessible project
    const userId = c.get('userId')
    const { data: source } = await db()
      .from('skill_sources')
      .select('id, project_id')
      .eq('id', sourceId)
      .maybeSingle()

    if (!source) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Source not found' } }, 404)
    }

    const allowed = await accessibleProjectIds(db(), userId)
    if (!allowed.includes(source.project_id as string)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Access denied' } }, 403)
    }

    const reqBody = await c.req.json().catch(() => ({})) as { force?: boolean }

    // Fire-and-forget the sync function
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/skill-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ source_id: sourceId, force: reqBody.force ?? false }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        // skill-sync answers `{ ok:false, error:'…' }` or `{ error:{code,message} }`;
        // pass its own reason through so the console can say why.
        const error = unwrapUpstreamError(json, {
          code: 'SYNC_FAILED',
          message: `The skill sync could not run (HTTP ${res.status}). Try again in a minute.`,
        })
        return c.json({ ok: false, error }, (res.status >= 400 ? res.status : 502) as 502)
      }
      // Nest stats under `data` so every consumer (console, CLI) reads them
      // consistently via the standard `{ ok, data }` envelope.
      return c.json({ ok: true, data: json })
    } catch (err) {
      return c.json({
        ok: false,
        error: { code: 'SYNC_UNREACHABLE', message: `Couldn't reach the skill sync worker: ${String(err)}` },
      }, 502)
    }
  })

  // Remove a source. Its skills leave the catalog first (agent_skills.source_id
  // is ON DELETE SET NULL, so they would otherwise stay listed forever).
  r.delete('/sources/:id', async (c) => {
    const sourceId = c.req.param('id')
    const { data: source } = await db()
      .from('skill_sources')
      .select('id, project_id, repo_slug')
      .eq('id', sourceId)
      .maybeSingle()
    if (!source) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'That skill source no longer exists.' } }, 404)
    }
    const access = await assertTargetProjectAccess(c, db(), c.get('userId') as string, source.project_id as string)
    if (!access.ok) return access.response

    const { error: retireErr } = await db()
      .from('agent_skills')
      .update({ is_active: false })
      .eq('source_id', sourceId)
    if (retireErr) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: retireErr.message } }, 500)
    }
    const { error } = await db().from('skill_sources').delete().eq('id', sourceId)
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data: { id: sourceId, repo_slug: source.repo_slug } })
  })

  // ── Pipelines ────────────────────────────────────────────────────────────

  r.get('/pipelines', async (c) => {
    const projectId = projectIdFromRequest(c)
    if (!projectId) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'project_id required' } }, 400)
    }

    const status = c.req.query('status')
    const reportId = c.req.query('report_id')
    const page = parseInt(c.req.query('page') ?? '1', 10)
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100)

    let q = db()
      .from('skill_pipeline_runs')
      .select('*, skill_pipeline_step_runs(*)', { count: 'exact' })
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (status) q = q.eq('status', status)
    if (reportId) q = q.eq('report_id', reportId)

    const { data, error, count } = await q
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data: data ?? [], total: count, page, limit })
  })

  // Start a pipeline run
  r.post('/pipelines', async (c) => {
    const userId = c.get('userId') as string
    const body = await c.req.json()
    const projectId =
      (typeof body.project_id === 'string' ? body.project_id : null) ?? projectIdFromRequest(c)

    const { root_skill_slug, report_id, mode } = body

    if (!projectId || !root_skill_slug) {
      return c.json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'project_id and root_skill_slug are required' },
      }, 400)
    }

    const access = await assertTargetProjectAccess(c, db(), userId, projectId)
    if (!access.ok) return access.response

    // The report must belong to this project. Read it before the rate limit
    // so a wrong id costs no quota; a report elsewhere is a plain 404.
    let report: {
      id: unknown
      summary: unknown
      severity: unknown
      category: unknown
      component: unknown
      stage2_analysis: unknown
      screenshot_url: unknown
    } | null = null
    if (report_id != null && report_id !== '') {
      if (typeof report_id !== 'string' || !REPORT_ID_RE.test(report_id)) {
        return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found in this project' } }, 404)
      }
      const { data } = await db()
        .from('reports')
        .select('id, summary, severity, category, component, stage2_analysis, screenshot_url')
        .eq('id', report_id)
        .eq('project_id', projectId)
        .maybeSingle()
      if (!data) {
        return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found in this project' } }, 404)
      }
      report = data
    }

    logTenantContext(tenantContextFromHono(c))

    const rate = await claimTenantRateLimit(db(), `project:${projectId}:skill_pipeline_start`, 10, 3600)
    if (!rate.allowed) {
      return c.json({
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many pipeline runs for this project — try again later',
          retry_after_sec: rate.retryAfterSec,
        },
      }, 429)
    }

    // Validate mode
    const runMode = mode === 'cloud' ? 'cloud' : 'handoff'

    // Rate limit: max 10 active pipeline runs per project at once
    const MAX_ACTIVE_RUNS = 10
    const { count: activeCount } = await db()
      .from('skill_pipeline_runs')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .in('status', ['pending', 'running'])

    if ((activeCount ?? 0) >= MAX_ACTIVE_RUNS) {
      return c.json({
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          message: `Project has ${activeCount} active pipeline runs. Maximum is ${MAX_ACTIVE_RUNS}. Complete or abort existing runs first.`,
        },
      }, 429)
    }

    // Dedup: one pending run per skill per project within a 5-minute window
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const { data: recentPending } = await db()
      .from('skill_pipeline_runs')
      .select('id, created_at')
      .eq('project_id', projectId)
      .eq('root_skill_slug', root_skill_slug)
      .eq('status', 'pending')
      .gte('created_at', fiveMinutesAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (recentPending) {
      return c.json({
        ok: false,
        error: {
          code: 'DUPLICATE',
          message: `A pipeline for "${root_skill_slug}" is already pending (${(recentPending.id as string).slice(0, 8)}…). Abort it or wait before starting another.`,
        },
      }, 409)
    }

    // Validate the skill exists (one row per slug, even when several sources carry it)
    const { skill } = await findActiveSkillBySlug(
      db(),
      String(root_skill_slug),
      'slug, title, description, body_md, chain_slugs',
      await projectSkillSourceIds(db(), projectId),
    )

    if (!skill) {
      return c.json({
        ok: false,
        error: { code: 'NOT_FOUND', message: `Skill "${root_skill_slug}" not found. Run skill sync first.` },
      }, 404)
    }

    // Resolve the full chain
    const chainSlugs = await resolveChain(root_skill_slug)

    // Build report context if report_id provided
    let reportContext: Parameters<typeof composeRunPacket>[0]['reportContext'] = {
      id: report_id ?? 'n/a',
      summary: null,
      severity: null,
      category: null,
      component: null,
      rootCause: null,
      reproductionSteps: null,
      suggestedFix: null,
      screenshotUrl: null,
      ragFiles: [],
    }

    if (report) {
      const s2 = (report.stage2_analysis as Record<string, unknown> | null) ?? {}
      reportContext = {
        id: report.id as string,
        summary: report.summary as string | null,
        severity: report.severity as string | null,
        category: report.category as string | null,
        component: report.component as string | null,
        rootCause: (s2.rootCause as string | null) ?? null,
        reproductionSteps: (s2.reproductionSteps as string[] | null) ?? null,
        suggestedFix: (s2.suggestedFix as string | null) ?? null,
        screenshotUrl: report.screenshot_url as string | null,
        ragFiles: [],
      }

      // Fetch RAG code context using the summary as query
      if (report.summary) {
        try {
          const ragFiles = await getRelevantCode(db(), projectId, {
            symptom: report.summary as string,
          })
          reportContext.ragFiles = ragFiles.slice(0, 5).map((f) => ({
            path: f.filePath,
            snippet: f.preview?.slice(0, 600) ?? '',
          }))
        } catch {
          // RAG is best-effort — don't fail pipeline creation
        }
      }
    }

    // Compose the context packet
    const contextPacket = await composeRunPacket({
      rootSkillSlug: root_skill_slug,
      chainSlugs,
      reportContext,
    })

    // Insert the pipeline run
    const { data: run, error: runErr } = await db()
      .from('skill_pipeline_runs')
      .insert({
        project_id: projectId,
        report_id: report_id ?? null,
        root_skill_slug,
        chain_slugs: chainSlugs,
        mode: runMode,
        status: 'pending',
        context_packet: contextPacket,
        created_by: userId,
      })
      .select()
      .single()

    if (runErr) return c.json({ ok: false, error: { code: 'DB_ERROR', message: runErr.message } }, 500)

    // Create step rows for each slug in the chain
    const allSlugs = [root_skill_slug, ...chainSlugs]
    const steps = allSlugs.map((slug, i) => ({
      run_id: run.id as string,
      step_index: i,
      skill_slug: slug,
      status: 'pending',
    }))

    if (steps.length > 0) {
      await db().from('skill_pipeline_step_runs').insert(steps)
    }

    // For cloud mode: advance to running immediately (step dispatch handled below)
    if (runMode === 'cloud') {
      await db()
        .from('skill_pipeline_runs')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', run.id as string)

      // Dispatch step 0 via Cursor Cloud (fire-and-forget handled by Phase 5 plugin)
      dispatchCloudStep(run.id as string, 0, root_skill_slug, contextPacket, projectId).catch(() => {})
    }

    return c.json({ ok: true, data: run, chainSlugs, stepCount: steps.length }, 201)
  })

  // Pipeline run detail
  r.get('/pipelines/:id', async (c) => {
    const runId = c.req.param('id')
    const access = await assertRunAccess(c, runId)
    if (!access.ok) return access.response

    const { data: run, error } = await db()
      .from('skill_pipeline_runs')
      .select('*')
      .eq('id', runId)
      .single()

    if (error) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404)

    const { data: steps } = await db()
      .from('skill_pipeline_step_runs')
      .select('*')
      .eq('run_id', runId)
      .order('step_index', { ascending: true })

    return c.json({ ok: true, data: { ...run, steps: steps ?? [] } })
  })

  // Abort a pipeline run. Open steps are closed as skipped. In cloud mode each
  // step that already started a Cursor Cloud agent gets its run cancelled, and
  // the answer says per agent whether that worked: an agent we could not stop
  // may still push a branch or open a PR.
  r.delete('/pipelines/:id', async (c) => {
    const runId = c.req.param('id')
    const access = await assertRunAccess(c, runId)
    if (!access.ok) return access.response

    const now = new Date().toISOString()
    const { data: aborted, error: abortErr } = await db()
      .from('skill_pipeline_runs')
      .update({ status: 'aborted', finished_at: now })
      .eq('id', runId)
      .in('status', OPEN_RUN_STATUSES)
      .select('id, mode')
    if (abortErr) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: abortErr.message } }, 500)
    }
    const run = (aborted ?? [])[0] as { id: string; mode: string } | undefined
    if (!run) {
      return c.json({
        ok: false,
        error: { code: 'RUN_CLOSED', message: 'This pipeline already finished, so there is nothing to cancel.' },
      }, 409)
    }

    const { data: openSteps } = await db()
      .from('skill_pipeline_step_runs')
      .select('step_index, status, agent_ref')
      .eq('run_id', runId)
      .in('status', ['pending', 'running'])

    const agents: Array<{ stepIndex: number; agentRef: string; outcome: CursorStopOutcome }> = []
    if (run.mode === 'cloud') {
      for (const step of (openSteps ?? []) as Array<{ step_index: number; agent_ref: string | null }>) {
        if (!step.agent_ref) continue
        const outcome = await stopCursorAgentLatestRun(db(), access.projectId, step.agent_ref)
        agents.push({ stepIndex: step.step_index, agentRef: step.agent_ref, outcome })
      }
    }

    if ((openSteps ?? []).length > 0) {
      await db()
        .from('skill_pipeline_step_runs')
        .update({ status: 'skipped', finished_at: now, updated_at: now, notes: 'Cancelled from the console.' })
        .eq('run_id', runId)
        .in('status', ['pending', 'running'])
    }

    return c.json({
      ok: true,
      data: {
        id: runId,
        mode: run.mode,
        agents,
        stopped: agents.filter((a) => a.outcome === 'stopped' || a.outcome === 'already_finished').length,
        stillRunning: agents.filter((a) => a.outcome === 'failed' || a.outcome === 'no_key').length,
      },
    })
  })

  // Check in a step (CLI agent updates status after completing a step)
  r.post('/pipelines/:runId/steps/:stepIndex/checkin', async (c) => {
    const runId = c.req.param('runId')
    const stepIndex = parseInt(c.req.param('stepIndex') ?? '0', 10)

    const access = await assertRunAccess(c, runId)
    if (!access.ok) return access.response

    const body = await c.req.json()
    const { status, notes, pr_url, agent_ref } = body

    // A cancelled or finished run stays closed: a late agent check-in must not
    // reopen it or dispatch the next cloud step.
    const { data: runState } = await db()
      .from('skill_pipeline_runs')
      .select('status')
      .eq('id', runId)
      .maybeSingle()
    if (!runState || !OPEN_RUN_STATUSES.includes(runState.status as string)) {
      return c.json({
        ok: false,
        error: {
          code: 'RUN_CLOSED',
          message: `This pipeline is ${runState?.status ?? 'gone'}, so its steps can no longer be checked in.`,
        },
      }, 409)
    }

    if (!status || !['running', 'passed', 'failed', 'skipped'].includes(status)) {
      return c.json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'status must be: running | passed | failed | skipped' },
      }, 400)
    }

    const now = new Date().toISOString()
    const stepUpdate: Record<string, unknown> = { status, updated_at: now }
    if (notes) stepUpdate.notes = notes
    if (pr_url) stepUpdate.pr_url = pr_url
    if (agent_ref) stepUpdate.agent_ref = agent_ref
    if (status === 'running') stepUpdate.started_at = now
    if (['passed', 'failed', 'skipped'].includes(status)) stepUpdate.finished_at = now

    const { error: stepErr } = await db()
      .from('skill_pipeline_step_runs')
      .update(stepUpdate)
      .eq('run_id', runId)
      .eq('step_index', stepIndex)

    if (stepErr) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: stepErr.message } }, 500)
    }

    // If this step passed, activate the next one (and auto-dispatch in cloud mode)
    if (status === 'passed') {
      const { data: runRow } = await db()
        .from('skill_pipeline_runs')
        .select('mode, context_packet, project_id, status')
        .eq('id', runId)
        .maybeSingle()

      const { data: nextStep } = await db()
        .from('skill_pipeline_step_runs')
        .select('skill_slug, status')
        .eq('run_id', runId)
        .eq('step_index', stepIndex + 1)
        .maybeSingle()

      if (nextStep && nextStep.status === 'pending') {
        // Next step stays pending until cloud dispatch or manual check-in
        if (runRow?.mode === 'cloud' && runRow.status !== 'aborted') {
          dispatchCloudStep(
            runId,
            stepIndex + 1,
            nextStep.skill_slug as string,
            runRow.context_packet as string,
            runRow.project_id as string,
          ).catch(() => {})
        }
      }

      // Check if all steps are done
      const { data: allSteps } = await db()
        .from('skill_pipeline_step_runs')
        .select('status')
        .eq('run_id', runId)

      const allDone = (allSteps ?? []).every(
        (s) => ['passed', 'skipped'].includes(s.status as string),
      )
      if (allDone) {
        await db()
          .from('skill_pipeline_runs')
          .update({ status: 'completed', finished_at: now })
          .eq('id', runId)
          .in('status', ['pending', 'running'])
      }
    }

    if (status === 'failed') {
      await db()
        .from('skill_pipeline_runs')
        .update({ status: 'failed', finished_at: now })
        .eq('id', runId)
        .in('status', ['pending', 'running'])
    }

    return c.json({ ok: true })
  })

  // Ensure pipeline run is started when first step begins
  r.post('/pipelines/:runId/start', async (c) => {
    const runId = c.req.param('runId')
    const access = await assertRunAccess(c, runId)
    if (!access.ok) return access.response

    await db()
      .from('skill_pipeline_runs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', runId)
      .eq('status', 'pending')

    return c.json({ ok: true })
  })

  // ── Catalog: single skill (must be last to avoid shadowing static sub-routes) ──
  r.get('/:slug', async (c) => {
    const slug = c.req.param('slug')
    const { skill: data, error } = await findActiveSkillBySlug(
      db(),
      slug,
      '*',
      await projectSkillSourceIds(db(), projectIdFromRequest(c)),
    )

    if (error || !data) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: `Skill "${slug}" not found` } }, 404)
    }

    return c.json({ ok: true, data })
  })

  return r
}

// ── Cloud dispatch helper ────────────────────────────────────────────────────
// Fan-out via dispatchPluginEvent → built-in cursor-cloud-agent or webhook plugins.
async function dispatchCloudStep(
  runId: string,
  stepIndex: number,
  skillSlug: string,
  contextPacket: string,
  projectId: string,
): Promise<void> {
  const client = getServiceClient()
  const now = new Date().toISOString()

  await client
    .from('skill_pipeline_step_runs')
    .update({ status: 'running', started_at: now, updated_at: now })
    .eq('run_id', runId)
    .eq('step_index', stepIndex)

  try {
    await dispatchPluginEvent(client, projectId, 'skill_pipeline.step.dispatched', {
      runId,
      stepIndex,
      skillSlug,
      contextPacket,
      projectId,
    })
  } catch (err) {
    await markCloudStepFailed(client, runId, stepIndex, `Dispatch error: ${String(err)}`)
  }
}

async function markCloudStepFailed(
  client: ReturnType<typeof getServiceClient>,
  runId: string,
  stepIndex: number,
  notes: string,
): Promise<void> {
  const now = new Date().toISOString()
  await client
    .from('skill_pipeline_step_runs')
    .update({ status: 'failed', finished_at: now, updated_at: now, notes })
    .eq('run_id', runId)
    .eq('step_index', stepIndex)
  await client
    .from('skill_pipeline_runs')
    .update({ status: 'failed', finished_at: now })
    .eq('id', runId)
    .in('status', ['pending', 'running'])
}

declare const Deno: {
  env: { get(name: string): string | undefined }
}
