// ============================================================
// releases.ts — Release drafting, publishing, and attribution
//
// Admin (JWT, org-scoped):
//   GET  /v1/admin/releases             — list releases for a project
//   POST /v1/admin/releases/draft       — trigger release-builder edge function
//   GET  /v1/admin/releases/:id         — release detail with credits
//   PATCH /v1/admin/releases/:id        — edit body, title, status
//   DELETE /v1/admin/releases/:id       — delete draft (not published)
//   POST /v1/admin/releases/:id/publish — publish + send widget notifications
//
// SDK (apiKeyAuth):
//   GET /v1/sdk/me/credits              — releases where the user is credited
// ============================================================

import type { Hono } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { getServiceClient } from '../../_shared/db.ts'
import { jwtAuth, getOrgIdFromContext, apiKeyAuth } from '../../_shared/auth.ts'
import { resolveEndUser } from '../../_shared/end-user-resolver.ts'
import { ownedProjectIds, resolveOwnedProject } from '../shared.ts'

export function registerReleasesRoutes(app: Hono<{ Variables: Variables }>) {
  // GET /v1/admin/releases/stats — posture banner + RELEASES SNAPSHOT.
  app.get('/v1/admin/releases/stats', jwtAuth, async (c) => {
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

    const projectIds = await ownedProjectIds(db, userId)
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

    const [releasesRes, fixedReportsRes, shippedTicketsRes, openTicketsRes] = await Promise.all([
      db
        .from('releases')
        .select('id, status, fixed_report_ids, credited_reporter_ids, published_at, created_at')
        .eq('project_id', pid)
        .order('created_at', { ascending: false }),
      db
        .from('reports')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
        .eq('status', 'fixed'),
      db
        .from('support_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
        .not('shipped_in_release_id', 'is', null),
      db
        .from('support_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
        .in('status', ['open', 'in_progress']),
    ])

    const releases = releasesRes.data ?? []
    const releaseIds = releases.map((r) => r.id as string)

    const creditsRes =
      releaseIds.length > 0
        ? await db
            .from('release_credits')
            .select('id, notified_at')
            .in('release_id', releaseIds)
        : { data: [] as Array<{ id: string; notified_at: string | null }> }

    const credits = creditsRes.data ?? []
    const draftCount = releases.filter((r) => r.status === 'draft').length
    const publishedCount = releases.filter((r) => r.status === 'published').length
    const totalFixesLinked = releases.reduce(
      (sum, r) => sum + ((r.fixed_report_ids as string[] | null)?.length ?? 0),
      0,
    )
    const totalContributors = releases.reduce(
      (sum, r) => sum + ((r.credited_reporter_ids as string[] | null)?.length ?? 0),
      0,
    )
    const creditsNotified = credits.filter((c) => c.notified_at != null).length
    const creditsPending = credits.filter((c) => c.notified_at == null).length
    const fixedReportsCount = fixedReportsRes.count ?? 0
    const fulfilledTicketsShipped = shippedTicketsRes.count ?? 0
    const openFeedbackTickets = openTicketsRes.count ?? 0
    const lastPublished = releases.find((r) => r.status === 'published')
    const lastDraft = releases.find((r) => r.status === 'draft')

    let topPriority = empty.topPriority
    let topPriorityLabel: string | null = null
    let topPriorityTo: string | null = null

    if (draftCount > 0) {
      topPriority = 'drafts_pending'
      topPriorityLabel = `${totalContributors} contributor${totalContributors === 1 ? '' : 's'} credited · ${totalFixesLinked} fix${totalFixesLinked === 1 ? '' : 'es'} linked — review Markdown and publish to notify reporters.`
      topPriorityTo = '/releases?tab=drafts'
    } else if (releases.length === 0 && fixedReportsCount > 0) {
      topPriority = 'no_releases'
      topPriorityLabel = `${fixedReportsCount} fixed report${fixedReportsCount === 1 ? '' : 's'} available — generate an AI changelog draft from the Draft tab.`
      topPriorityTo = '/releases?tab=draft'
    } else if (releases.length === 0 && fixedReportsCount === 0) {
      topPriority = 'no_fixes'
      topPriorityLabel = 'Mark reports as fixed in Reports before generating a release draft.'
      topPriorityTo = '/reports?status=fixed'
    } else if (fixedReportsCount > 0 && draftCount === 0) {
      topPriority = 'ready_to_draft'
      topPriorityLabel = `${fixedReportsCount} fixed report${fixedReportsCount === 1 ? '' : 's'} since last publish — generate a new AI changelog draft.`
      topPriorityTo = '/releases?tab=draft'
    } else {
      topPriority = 'healthy'
      topPriorityLabel = `${publishedCount} published · ${credits.length} credit${credits.length === 1 ? '' : 's'} · ${openFeedbackTickets} open feedback ticket${openFeedbackTickets === 1 ? '' : 's'}.`
      topPriorityTo = '/releases?tab=published'
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName: activeProject.project_name ?? null,
        projectCount: projectIds.length,
        draftCount,
        publishedCount,
        totalReleases: releases.length,
        totalFixesLinked,
        totalContributors,
        totalCredits: credits.length,
        creditsNotified,
        creditsPending,
        fulfilledTicketsShipped,
        fixedReportsCount,
        openFeedbackTickets,
        lastPublishedAt: lastPublished?.published_at ?? null,
        lastDraftAt: lastDraft?.created_at ?? null,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    })
  })

  // ─── List releases ────────────────────────────────────────────────────────
  app.get('/v1/admin/releases', jwtAuth, async (c) => {
    const db = getServiceClient()
    const projectId = c.req.query('projectId') ?? c.req.header('x-mushi-project-id') ?? null
    const status = c.req.query('status') // 'draft' | 'published'
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20'), 100)
    const offset = parseInt(c.req.query('offset') ?? '0')

    let query = db
      .from('releases')
      .select('id, project_id, version, title, status, published_at, credited_reporter_ids, fixed_report_ids, fulfilled_ticket_ids, created_at, updated_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (projectId) query = query.eq('project_id', projectId)
    if (status) query = query.eq('status', status)

    const { data, count, error } = await query
    if (error) return c.json({ ok: false, error: error.message }, 500)
    return c.json({ ok: true, data, meta: { total: count ?? 0, limit, offset } })
  })

  // ─── Draft a new release (via release-builder) ────────────────────────────
  const draftSchema = z.object({
    project_id: z.string().uuid(),
    version: z.string().min(1),
    title: z.string().optional(),
    window_start: z.string().optional(),
    window_end: z.string().optional(),
  })

  app.post('/v1/admin/releases/draft', jwtAuth, async (c) => {
    const body = draftSchema.safeParse(await c.req.json())
    if (!body.success) return c.json({ ok: false, error: body.error.flatten() }, 400)

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
          'x-mushi-admin': '1',
        },
        body: JSON.stringify(body.data),
      })
    } catch (err) {
      console.error('[releases/draft] fetch release-builder failed:', err)
      return c.json({ ok: false, error: 'Could not reach release-builder function' }, 500)
    }

    // The edge function may return plain-text "Internal Server Error" on crash —
    // guard against non-JSON so we surface a useful message instead of 500ing.
    let data: Record<string, unknown> = {}
    const rawText = await res.text()
    try {
      data = JSON.parse(rawText)
    } catch {
      console.error('[releases/draft] release-builder returned non-JSON:', rawText.slice(0, 200))
      return c.json({ ok: false, error: `release-builder error: ${rawText.slice(0, 100)}` }, 500)
    }
    if (!res.ok) return c.json({ ok: false, error: (data.error as string) ?? 'release-builder failed' }, 500)
    return c.json({ ok: true, data: (data as { data?: unknown }).data ?? data })
  })

  // ─── Release detail ────────────────────────────────────────────────────────
  app.get('/v1/admin/releases/:id', jwtAuth, async (c) => {
    const db = getServiceClient()
    const [releaseRes, creditsRes] = await Promise.all([
      db.from('releases').select('*').eq('id', c.req.param('id')).single(),
      db.from('release_credits')
        .select('id, end_user_id, report_id, contribution_type, display_name_at_time, notified_at')
        .eq('release_id', c.req.param('id')),
    ])

    if (releaseRes.error) return c.json({ ok: false, error: releaseRes.error.message }, 404)
    return c.json({ ok: true, data: { ...releaseRes.data, credits: creditsRes.data ?? [] } })
  })

  // ─── Edit release ─────────────────────────────────────────────────────────
  const patchReleaseSchema = z.object({
    title: z.string().min(1).optional(),
    body_md: z.string().optional(),
    version: z.string().min(1).optional(),
    fulfilled_ticket_ids: z.array(z.string().uuid()).optional(),
  })

  app.patch('/v1/admin/releases/:id', jwtAuth, async (c) => {
    const db = getServiceClient()
    const body = patchReleaseSchema.safeParse(await c.req.json())
    if (!body.success) return c.json({ ok: false, error: body.error.flatten() }, 400)

    const { data, error } = await db
      .from('releases')
      .update(body.data)
      .eq('id', c.req.param('id'))
      .eq('status', 'draft') // can only edit drafts
      .select()
      .single()

    if (error) return c.json({ ok: false, error: error.message }, 500)
    return c.json({ ok: true, data })
  })

  // ─── Delete draft release ─────────────────────────────────────────────────
  app.delete('/v1/admin/releases/:id', jwtAuth, async (c) => {
    const db = getServiceClient()
    const { error } = await db
      .from('releases')
      .delete()
      .eq('id', c.req.param('id'))
      .eq('status', 'draft')

    if (error) return c.json({ ok: false, error: error.message }, 500)
    return c.json({ ok: true })
  })

  // ─── Publish release + notify credited users ──────────────────────────────
  app.post('/v1/admin/releases/:id/publish', jwtAuth, async (c) => {
    const db = getServiceClient()

    // Mark as published
    const { data: release, error } = await db
      .from('releases')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', c.req.param('id'))
      .eq('status', 'draft')
      .select()
      .single()

    if (error) return c.json({ ok: false, error: error.message }, 500)
    if (!release) return c.json({ ok: false, error: 'Release not found or already published' }, 404)

    const publishedAt = release.published_at ?? new Date().toISOString()
    const ticketIds = (release.fulfilled_ticket_ids ?? []) as string[]
    if (ticketIds.length > 0) {
      const { error: ticketsError } = await db
        .from('support_tickets')
        .update({
          shipped_in_release_id: release.id,
          shipped_at: publishedAt,
          status: 'resolved',
        })
        .in('id', ticketIds)
        .is('shipped_in_release_id', null)
      if (ticketsError) {
        return c.json(
          {
            ok: false,
            error: `release published, but linking ${ticketIds.length} support ticket(s) failed: ${ticketsError.message}`,
          },
          500,
        )
      }
    }

    const { data: credits, error: creditsFetchError } = await db
      .from('release_credits')
      .select('id, end_user_id, display_name_at_time')
      .eq('release_id', release.id)
      .is('notified_at', null)
    if (creditsFetchError) {
      return c.json(
        { ok: false, error: `release published, but fetching credits failed: ${creditsFetchError.message}` },
        500,
      )
    }

    if ((credits ?? []).length > 0) {
      const { error: creditsUpdateError } = await db
        .from('release_credits')
        .update({ notified_at: new Date().toISOString() })
        .eq('release_id', release.id)
        .is('notified_at', null)
      if (creditsUpdateError) {
        return c.json(
          {
            ok: false,
            error: `release published, but marking ${(credits ?? []).length} credit(s) notified failed: ${creditsUpdateError.message}`,
          },
          500,
        )
      }
    }

    return c.json({
      ok: true,
      data: release,
      notified: (credits ?? []).length,
      tickets_fulfilled: ticketIds.length,
    })
  })

  // ─── SDK: get credits for the current user ────────────────────────────────
  app.get('/v1/sdk/me/credits', apiKeyAuth, async (c) => {
    const db = getServiceClient()
    const apiKey = c.req.header('x-mushi-api-key') ?? ''
    const projectKey = c.req.header('x-mushi-project') ?? ''
    const reporterToken = c.req.header('x-mushi-reporter-token') ?? ''
    const externalUserId = c.req.header('x-mushi-user-id') ?? ''

    if (!reporterToken && !externalUserId) {
      return c.json({ ok: true, data: [] })
    }

    // Find end_user
    let endUserId: string | null = null
    if (externalUserId) {
      const { data } = await db
        .from('end_users')
        .select('id')
        .eq('external_user_id', externalUserId)
        .maybeSingle()
      endUserId = data?.id as string ?? null
    }

    if (!endUserId && reporterToken) {
      const { data } = await db
        .from('end_users')
        .select('id')
        .eq('reporter_token_hash', reporterToken)
        .maybeSingle()
      endUserId = data?.id as string ?? null
    }

    if (!endUserId) return c.json({ ok: true, data: [] })

    // Get unread credits from published releases
    const { data } = await db
      .from('release_credits')
      .select('id, contribution_type, display_name_at_time, releases!inner(id, version, title, body_md, published_at)')
      .eq('end_user_id', endUserId)
      .is('notified_at', null) // unread only for the "new" toast

    return c.json({ ok: true, data: data ?? [] })
  })
}
