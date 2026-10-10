// ============================================================
// releases.ts — Release drafting, publishing, and attribution
//
// Admin (console JWT, or an API key — adminOrApiKey; a project-bound key
// only reaches its own project's releases):
//   GET  /v1/admin/releases/stats       — posture banner (mcp:read)
//   GET  /v1/admin/releases             — list releases for a project (mcp:read)
//   POST /v1/admin/releases/draft       — trigger release-builder edge function (mcp:write)
//   GET  /v1/admin/releases/auto-release — automatic draft blocking auto-release (mcp:read)
//   GET  /v1/admin/releases/:id         — release detail with credits (mcp:read)
//   PATCH /v1/admin/releases/:id        — edit body, title, status (mcp:write)
//   DELETE /v1/admin/releases/:id       — delete draft (not published) (mcp:write)
//   POST /v1/admin/releases/:id/publish — publish; resolve fixed_report_ids,
//                                          message each reporter, credit after delivery (mcp:write)
//
// SDK (apiKeyAuth):
//   GET /v1/sdk/me/credits              — releases where the user is credited
// ============================================================

import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { z } from 'npm:zod@3'
import { getServiceClient } from '../../_shared/db.ts'
import { adminOrApiKey, apiKeyAuth } from '../../_shared/auth.ts'
import { resolveEndUser } from '../../_shared/end-user-resolver.ts'
import {
  assertTargetProjectAccess,
  callerProjectIds,
  dbError,
  intersectOrgAndProjectScope,
  jsonForbidden,
  jsonNotFound,
  parseUuidParam,
  resolveOwnedProject,
} from '../shared.ts'
import { log } from '../../_shared/logger.ts'
import { reporterKey } from '../../_shared/reporter-token.ts'
import { publishRelease } from '../../_shared/release-publish.ts'
import { findOpenAutoDraft } from '../../_shared/auto-release.ts'
import { denyViewerWrite } from '../viewer-gate.ts'

async function assertReleaseRowAccess(
  c: Parameters<typeof assertTargetProjectAccess>[0],
  db: ReturnType<typeof getServiceClient>,
  userId: string,
  releaseId: string,
): Promise<
  | { ok: true; projectId: string; role: string | null }
  | { ok: false; response: Response }
> {
  const { data: release } = await db
    .from('releases')
    .select('project_id')
    .eq('id', releaseId)
    .maybeSingle()
  if (!release?.project_id) {
    return { ok: false, response: jsonNotFound(c, 'Release not found') }
  }
  const access = await assertTargetProjectAccess(c, db, userId, release.project_id as string)
  if (!access.ok) return { ok: false, response: access.response }
  return { ok: true, projectId: release.project_id as string, role: access.role ?? null }
}

type ReleaseStatsDb = ReturnType<typeof getServiceClient>

interface ReleaseStatsCounts {
  totalReleases: number
  draftCount: number
  publishedCount: number
  fixedReportsCount: number
  fulfilledTicketsShipped: number
  openFeedbackTickets: number
  lastPublishedAt: string | null
  lastDraftAt: string | null
  totalFixesLinked: number
  totalContributors: number
  draftFixes: number
  draftContributors: number
  totalCredits: number
  creditsNotified: number
}

const RELEASE_STATS_PAGE = 500

/**
 * Counts for GET /v1/admin/releases/stats. Counts are exact counts, and the
 * array totals and credit counts come from release_stats_totals() (migration
 * 20261010120000) in one SQL pass: the route feeds the sidebar counters
 * (nav-meta) on every page. Until that migration is applied they are read
 * page by page instead (the old unbounded select of every release and every
 * credit capped silently at PostgREST's 1,000 rows). A failed read throws:
 * the banner must not turn an outage into "0 drafts".
 */
async function loadReleaseStatsCounts(db: ReleaseStatsDb, pid: string): Promise<ReleaseStatsCounts> {
  const must = <T extends { error: { message?: string } | null }>(r: T): T => {
    if (r.error) throw new Error(r.error.message ?? 'release stats read failed')
    return r
  }
  const headCount = (q: PromiseLike<{ count: number | null; error: { message?: string } | null }>) =>
    Promise.resolve(q).then((r) => must(r).count ?? 0)
  const releaseCount = (status?: string) => {
    let q = db.from('releases').select('id', { count: 'exact', head: true }).eq('project_id', pid)
    if (status) q = q.eq('status', status)
    return headCount(q)
  }
  const newestAt = async (status: string, col: 'published_at' | 'created_at') => {
    const r = must(
      await db
        .from('releases')
        .select(col)
        .eq('project_id', pid)
        .eq('status', status)
        .order(col, { ascending: false })
        .limit(1),
    )
    return ((r.data ?? [])[0] as Record<string, string | null> | undefined)?.[col] ?? null
  }

  const [
    totalReleases,
    draftCount,
    publishedCount,
    fixedReportsCount,
    fulfilledTicketsShipped,
    openFeedbackTickets,
    lastPublishedAt,
    lastDraftAt,
  ] = await Promise.all([
    releaseCount(),
    releaseCount('draft'),
    releaseCount('published'),
    headCount(db.from('reports').select('id', { count: 'exact', head: true }).eq('project_id', pid).eq('status', 'fixed')),
    headCount(
      db
        .from('support_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
        .not('shipped_in_release_id', 'is', null),
    ),
    headCount(
      db
        .from('support_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
        .in('status', ['open', 'in_progress']),
    ),
    newestAt('published', 'published_at'),
    newestAt('draft', 'created_at'),
  ])

  const out: ReleaseStatsCounts = {
    totalReleases,
    draftCount,
    publishedCount,
    fixedReportsCount,
    fulfilledTicketsShipped,
    openFeedbackTickets,
    lastPublishedAt,
    lastDraftAt,
    totalFixesLinked: 0,
    totalContributors: 0,
    draftFixes: 0,
    draftContributors: 0,
    totalCredits: 0,
    creditsNotified: 0,
  }
  const { data: totals, error: totalsErr } = await db.rpc('release_stats_totals', { p_project_id: pid })
  const missing = totalsErr && (totalsErr.code === 'PGRST202' || totalsErr.code === '42883')
  if (totalsErr && !missing) throw new Error(totalsErr.message ?? 'release stats read failed')
  if (!missing) {
    const t = (totals ?? {}) as Record<string, number | string | null | undefined>
    out.totalFixesLinked = Number(t.total_fixes_linked ?? 0)
    out.totalContributors = Number(t.total_contributors ?? 0)
    out.draftFixes = Number(t.draft_fixes ?? 0)
    out.draftContributors = Number(t.draft_contributors ?? 0)
    out.totalCredits = Number(t.total_credits ?? 0)
    out.creditsNotified = Number(t.credits_notified ?? 0)
    return out
  }

  for (let from = 0; from < totalReleases; from += RELEASE_STATS_PAGE) {
    const { data: page } = must(
      await db
        .from('releases')
        .select('id, status, fixed_report_ids, credited_reporter_ids')
        .eq('project_id', pid)
        .order('created_at', { ascending: false })
        .range(from, from + RELEASE_STATS_PAGE - 1),
    )
    const rows = (page ?? []) as Array<{
      id: string
      status: string | null
      fixed_report_ids: string[] | null
      credited_reporter_ids: string[] | null
    }>
    if (rows.length === 0) break
    for (const r of rows) {
      const fixes = r.fixed_report_ids?.length ?? 0
      const contributors = r.credited_reporter_ids?.length ?? 0
      out.totalFixesLinked += fixes
      out.totalContributors += contributors
      if (r.status === 'draft') {
        out.draftFixes += fixes
        out.draftContributors += contributors
      }
    }
    const ids = rows.map((r) => r.id)
    const [credits, notified] = await Promise.all([
      headCount(db.from('release_credits').select('id', { count: 'exact', head: true }).in('release_id', ids)),
      headCount(
        db
          .from('release_credits')
          .select('id', { count: 'exact', head: true })
          .in('release_id', ids)
          .not('notified_at', 'is', null),
      ),
    ])
    out.totalCredits += credits
    out.creditsNotified += notified
  }
  return out
}

export function registerReleasesRoutes(app: Hono<{ Variables: Variables }>) {
  const readAuth = adminOrApiKey({ scope: 'mcp:read' })
  const writeAuth = adminOrApiKey({ scope: 'mcp:write' })

  // GET /v1/admin/releases/stats — posture banner + RELEASES SNAPSHOT.
  app.get('/v1/admin/releases/stats', readAuth, async (c) => {
    const db = getServiceClient()
    const userId = c.get('userId') as string

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      draftCount: 0,
      publishedCount: 0,
      totalReleases: 0,
      totalFixesLinked: 0,
      totalContributors: 0,
      totalCredits: 0,
      creditsNotified: 0,
      creditsPending: 0,
      fulfilledTicketsShipped: 0,
      fixedReportsCount: 0,
      openFeedbackTickets: 0,
      lastPublishedAt: null as string | null,
      lastDraftAt: null as string | null,
      topPriority: 'no_project' as
        | 'no_project'
        | 'drafts_pending'
        | 'ready_to_draft'
        | 'no_fixes'
        | 'no_releases'
        | 'healthy',
      topPriorityLabel: null as string | null,
      topPriorityTo: null as string | null,
    }

    const projectIds = await callerProjectIds(c, db, userId)
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: empty })
    }

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({
          ok: true,
          data: { ...empty, hasAnyProject: true, projectCount: projectIds.length },
        }),
    })
    if ('response' in resolvedProject) return resolvedProject.response
    const activeProject = resolvedProject.project
    const pid = activeProject.id

    let stats: ReleaseStatsCounts
    try {
      stats = await loadReleaseStatsCounts(db, pid)
    } catch (err) {
      return dbError(c, { message: err instanceof Error ? err.message : String(err) })
    }
    const {
      totalReleases,
      draftCount,
      publishedCount,
      fixedReportsCount,
      fulfilledTicketsShipped,
      openFeedbackTickets,
      lastPublishedAt,
      lastDraftAt,
      totalFixesLinked,
      totalContributors,
      draftFixes,
      draftContributors,
      totalCredits,
      creditsNotified,
    } = stats
    const creditsPending = totalCredits - creditsNotified

    let topPriority = empty.topPriority
    let topPriorityLabel: string | null = null
    let topPriorityTo: string | null = null

    if (draftCount > 0) {
      topPriority = 'drafts_pending'
      // The banner is about the drafts, so count only what the drafts carry.
      topPriorityLabel = `${draftContributors} contributor${draftContributors === 1 ? '' : 's'} credited · ${draftFixes} fix${draftFixes === 1 ? '' : 'es'} linked — review Markdown and publish to notify reporters.`
      topPriorityTo = '/releases?tab=drafts'
    } else if (totalReleases === 0 && fixedReportsCount > 0) {
      topPriority = 'no_releases'
      topPriorityLabel = `${fixedReportsCount} fixed report${fixedReportsCount === 1 ? '' : 's'} available — generate an AI changelog draft from the Draft tab.`
      topPriorityTo = '/releases?tab=draft'
    } else if (totalReleases === 0 && fixedReportsCount === 0) {
      topPriority = 'no_fixes'
      topPriorityLabel = 'Mark reports as fixed in Reports before generating a release draft.'
      topPriorityTo = '/reports?status=fixed'
    } else if (fixedReportsCount > 0 && draftCount === 0) {
      topPriority = 'ready_to_draft'
      topPriorityLabel = `${fixedReportsCount} fixed report${fixedReportsCount === 1 ? '' : 's'} since last publish — generate a new AI changelog draft.`
      topPriorityTo = '/releases?tab=draft'
    } else {
      topPriority = 'healthy'
      topPriorityLabel = `${publishedCount} published · ${totalCredits} credit${totalCredits === 1 ? '' : 's'} · ${openFeedbackTickets} open feedback ticket${openFeedbackTickets === 1 ? '' : 's'}.`
      topPriorityTo = '/releases?tab=published'
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName: activeProject.name ?? null,
        projectCount: projectIds.length,
        draftCount,
        publishedCount,
        totalReleases,
        totalFixesLinked,
        totalContributors,
        totalCredits,
        creditsNotified,
        creditsPending,
        fulfilledTicketsShipped,
        fixedReportsCount,
        openFeedbackTickets,
        lastPublishedAt,
        lastDraftAt,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    })
  })

  // ─── List releases ────────────────────────────────────────────────────────
  app.get('/v1/admin/releases', readAuth, async (c) => {
    const db = getServiceClient()
    const userId = c.get('userId') as string
    const projectIds = await intersectOrgAndProjectScope(c, db, userId)
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: [], meta: { total: 0, limit: 20, offset: 0 } })
    }

    const status = c.req.query('status') // 'draft' | 'published'
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20'), 100)
    const offset = parseInt(c.req.query('offset') ?? '0')

    let query = db
      .from('releases')
      .select('id, project_id, version, title, status, published_at, credited_reporter_ids, fixed_report_ids, fulfilled_ticket_ids, created_at, updated_at', { count: 'exact' })
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) query = query.eq('status', status)

    const { data, count, error } = await query
    if (error) return dbError(c, error)
    return c.json({ ok: true, data, meta: { total: count ?? 0, limit, offset } })
  })

  // GET /v1/admin/releases/auto-release — the automatic draft that blocks
  // auto-release for the active project, if any. One draft at a time is the
  // rule (uq_releases_one_auto_draft), so a draft whose publish failed stops
  // every later automatic release until a person publishes or deletes it.
  // Registered before /:id so "auto-release" is never parsed as an id.
  app.get('/v1/admin/releases/auto-release', readAuth, async (c) => {
    const db = getServiceClient()
    const userId = c.get('userId') as string
    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: { blockingDraft: null } }),
    })
    if ('response' in resolvedProject) return resolvedProject.response
    const open = await findOpenAutoDraft(db, resolvedProject.project.id as string, new Date())
    if (!open.ok) return c.json({ ok: false, error: { code: 'AUTO_DRAFT_UNREADABLE', message: open.error } }, 500)
    return c.json({ ok: true, data: { blockingDraft: open.draft } })
  })

  // ─── Draft a new release (via release-builder) ────────────────────────────
  const draftSchema = z.object({
    project_id: z.string().uuid(),
    version: z.string().min(1),
    title: z.string().optional(),
    window_start: z.string().optional(),
    window_end: z.string().optional(),
  })

  app.post('/v1/admin/releases/draft', writeAuth, async (c) => {
    const body = draftSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Enter a version (for example 1.2.3) and pick a project.' } }, 400)
    }

    const db = getServiceClient()
    const userId = c.get('userId') as string
    const access = await assertTargetProjectAccess(c, db, userId, body.data.project_id)
    if (!access.ok) return access.response
    const viewerDenied = denyViewerWrite(c, access.role, 'draft releases')
    if (viewerDenied) return viewerDenied

    // Call the release-builder edge function
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    let res: Response
    try {
      res = await fetch(`${supabaseUrl}/functions/v1/release-builder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify(body.data),
      })
    } catch (err) {
      log.error('fetch release-builder failed', { scope: 'releases/draft', err: String(err) })
      return c.json({ ok: false, error: { code: 'RELEASE_BUILDER_UNAVAILABLE', message: 'The release writer did not answer. Try again in a minute.' } }, 502)
    }

    // The edge function may return plain-text "Internal Server Error" on crash —
    // guard against non-JSON so we surface a useful message instead of 500ing.
    let data: Record<string, unknown> = {}
    const rawText = await res.text()
    try {
      data = JSON.parse(rawText)
    } catch {
      log.error('release-builder returned non-JSON', {
        scope: 'releases/draft',
        preview: rawText.slice(0, 200),
      })
      return c.json({ ok: false, error: { code: 'RELEASE_BUILDER_FAILED', message: 'The release writer failed. Try again in a minute.' } }, 502)
    }
    if (!res.ok) {
      const upstream = data.error
      const message = typeof upstream === 'string'
        ? upstream
        : (upstream as { message?: string } | undefined)?.message
      log.warn('release-builder refused draft', { scope: 'releases/draft', status: res.status, message })
      return c.json({
        ok: false,
        error: { code: 'RELEASE_BUILDER_FAILED', message: message || 'The release writer could not draft this release.' },
      }, res.status >= 500 ? 502 : 400)
    }
    return c.json({ ok: true, data: (data as { data?: unknown }).data ?? data })
  })

  // ─── Release detail ────────────────────────────────────────────────────────
  app.get('/v1/admin/releases/:id', readAuth, async (c) => {
    const db = getServiceClient()
    const userId = c.get('userId') as string
    const idParsed = parseUuidParam(c, 'id')
    if (!idParsed.ok) return idParsed.error
    const rowAccess = await assertReleaseRowAccess(c, db, userId, idParsed.value)
    if (!rowAccess.ok) return rowAccess.response

    const [releaseRes, creditsRes] = await Promise.all([
      db.from('releases').select('*').eq('id', c.req.param('id')!).single(),
      db.from('release_credits')
        .select('id, end_user_id, report_id, contribution_type, display_name_at_time, notified_at')
        .eq('release_id', c.req.param('id')!),
    ])

    if (releaseRes.error) return jsonNotFound(c, 'Release not found')
    return c.json({ ok: true, data: { ...releaseRes.data, credits: creditsRes.data ?? [] } })
  })

  // ─── Edit release ─────────────────────────────────────────────────────────
  const patchReleaseSchema = z.object({
    title: z.string().min(1).optional(),
    body_md: z.string().optional(),
    version: z.string().min(1).optional(),
    fulfilled_ticket_ids: z.array(z.string().uuid()).optional(),
  })

  app.patch('/v1/admin/releases/:id', writeAuth, async (c) => {
    const db = getServiceClient()
    const userId = c.get('userId') as string
    const idParsed = parseUuidParam(c, 'id')
    if (!idParsed.ok) return idParsed.error
    const rowAccess = await assertReleaseRowAccess(c, db, userId, idParsed.value)
    if (!rowAccess.ok) return rowAccess.response
    const viewerDenied = denyViewerWrite(c, rowAccess.role, 'edit releases')
    if (viewerDenied) return viewerDenied

    const body = patchReleaseSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'That change is not valid. Refresh the draft and try again.' } }, 400)
    }

    const { data, error } = await db
      .from('releases')
      .update(body.data)
      .eq('id', c.req.param('id')!)
      .eq('status', 'draft') // can only edit drafts
      .select()
      .maybeSingle()

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: 'The draft could not be saved. Try again in a moment.' } }, 500)
    if (!data) {
      return c.json({ ok: false, error: { code: 'NOT_A_DRAFT', message: 'This release is already published, so it can no longer be edited.' } }, 409)
    }
    return c.json({ ok: true, data })
  })

  // ─── Delete draft release ─────────────────────────────────────────────────
  app.delete('/v1/admin/releases/:id', writeAuth, async (c) => {
    const db = getServiceClient()
    const userId = c.get('userId') as string
    const idParsed = parseUuidParam(c, 'id')
    if (!idParsed.ok) return idParsed.error
    const rowAccess = await assertReleaseRowAccess(c, db, userId, idParsed.value)
    if (!rowAccess.ok) return rowAccess.response
    const viewerDenied = denyViewerWrite(c, rowAccess.role, 'delete release drafts')
    if (viewerDenied) return viewerDenied

    const { data: deleted, error } = await db
      .from('releases')
      .delete()
      .eq('id', c.req.param('id')!)
      .eq('status', 'draft')
      .select('id')

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: 'The draft could not be deleted. Try again in a moment.' } }, 500)
    if (!deleted || deleted.length === 0) {
      return c.json({ ok: false, error: { code: 'NOT_A_DRAFT', message: 'Only drafts can be deleted, and this release is already published.' } }, 409)
    }
    return c.json({ ok: true })
  })

  // ─── Publish release + notify credited users ──────────────────────────────
  app.post('/v1/admin/releases/:id/publish', writeAuth, async (c) => {
    const db = getServiceClient()
    const userId = c.get('userId') as string
    const idParsed = parseUuidParam(c, 'id')
    if (!idParsed.ok) return idParsed.error
    const rowAccess = await assertReleaseRowAccess(c, db, userId, idParsed.value)
    if (!rowAccess.ok) return rowAccess.response
    const viewerDenied = denyViewerWrite(c, rowAccess.role, 'publish releases')
    if (viewerDenied) return viewerDenied

    // Mark published, ship tickets, message each reporter (Plan 018 §5) and
    // stamp delivered credits — the same path the opt-in auto-release takes.
    const published = await publishRelease(db, idParsed.value, { kind: 'admin', id: userId })
    // `published: true` = the release is live but some reporters were not told.
    if (!published.ok) {
      log.warn('release publish incomplete', { scope: 'releases/publish', releaseId: idParsed.value, published: published.published, error: published.error })
      const message = published.published
        ? 'The release is live, but some follow-up steps failed: linked tickets or reporter messages may be missing. Check Notifications.'
        : published.status === 404
          ? 'This release is already published or no longer exists. Refresh the list.'
          : 'The release could not be published. Try again in a moment.'
      const code = published.published ? 'PUBLISHED_WITH_ERRORS' : published.status === 404 ? 'NOT_A_DRAFT' : 'PUBLISH_FAILED'
      return c.json({ ok: false, error: { code, message }, published: published.published }, published.status)
    }

    return c.json({
      ok: true,
      data: published.release,
      // Credits whose reporter actually received the release message.
      notified: published.notified,
      tickets_fulfilled: published.ticketsFulfilled,
      delivery: published.delivery,
    })
  })

  // ─── SDK: get credits for the current user ────────────────────────────────
  app.get('/v1/sdk/me/credits', apiKeyAuth, async (c) => {
    const db = getServiceClient()
    const projectId = c.get('projectId') as string
    const reporterToken = c.req.header('x-mushi-reporter-token') ?? ''
    const externalUserId = c.req.header('x-mushi-user-id') ?? ''

    if (!reporterToken && !externalUserId) {
      return c.json({ ok: true, data: [] })
    }

    // end_users are organization-scoped. Until 2026-09-22 the user-id lookup
    // ran across every organization, and the reporter-token lookup filtered
    // end_users on a column that table does not have, so it always came back
    // empty.
    const { data: project } = await db
      .from('projects')
      .select('organization_id')
      .eq('id', projectId)
      .maybeSingle()
    const organizationId = (project?.organization_id as string | undefined) ?? null
    if (!organizationId) return c.json({ ok: true, data: [] })

    let endUserId: string | null = null
    if (externalUserId) {
      const { data } = await db
        .from('end_users')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('external_user_id', externalUserId)
        .maybeSingle()
      endUserId = (data?.id as string | undefined) ?? null
    }

    // An anonymous reporter reaches its end user through the reports it filed.
    if (!endUserId && reporterToken) {
      const { data } = await db
        .from('reports')
        .select('end_user_id')
        .eq('project_id', projectId)
        .eq('reporter_token_hash', await reporterKey(reporterToken))
        .not('end_user_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      endUserId = (data?.end_user_id as string | undefined) ?? null
    }

    if (!endUserId) return c.json({ ok: true, data: [] })

    // Unread credits from this project's published releases
    const { data } = await db
      .from('release_credits')
      .select('id, contribution_type, display_name_at_time, releases!inner(id, version, title, body_md, published_at)')
      .eq('end_user_id', endUserId)
      .eq('releases.project_id', projectId)
      .is('notified_at', null) // unread only for the "new" toast

    return c.json({ ok: true, data: data ?? [] })
  })
}
