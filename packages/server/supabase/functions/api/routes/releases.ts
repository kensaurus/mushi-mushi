// ============================================================
// releases.ts — Release drafting, publishing, and attribution
//
// Admin (JWT, org-scoped):
//   GET  /v1/admin/releases             — list releases for a project
//   POST /v1/admin/releases/draft       — trigger release-builder edge function
//   GET  /v1/admin/releases/:id         — release detail with credits
//   PATCH /v1/admin/releases/:id        — edit body, title, status
//   DELETE /v1/admin/releases/:id       — delete draft (not published)
//   POST /v1/admin/releases/:id/publish — publish; resolve fixed_report_ids,
//                                          message each reporter, credit after delivery
//
// SDK (apiKeyAuth):
//   GET /v1/sdk/me/credits              — releases where the user is credited
// ============================================================

import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { z } from 'npm:zod@3'
import { getServiceClient } from '../../_shared/db.ts'
import { jwtAuth, apiKeyAuth } from '../../_shared/auth.ts'
import { resolveEndUser } from '../../_shared/end-user-resolver.ts'
import {
  assertTargetProjectAccess,
  callerProjectIds,
  intersectOrgAndProjectScope,
  jsonForbidden,
  jsonNotFound,
  parseUuidParam,
  resolveOwnedProject,
} from '../shared.ts'
import { log } from '../../_shared/logger.ts'
import { reporterKey } from '../../_shared/reporter-token.ts'
import { buildNotificationMessage, createNotification, notifyFollowers } from '../../_shared/notifications.ts'
import { runStatusTransitionSideEffects } from '../../_shared/report-transition.ts'
import { toStoredStatus } from '../../_shared/report-status.ts'
import { awardPoints } from '../../_shared/reputation.ts'

async function assertReleaseRowAccess(
  c: Parameters<typeof assertTargetProjectAccess>[0],
  db: ReturnType<typeof getServiceClient>,
  userId: string,
  releaseId: string,
): Promise<
  | { ok: true; projectId: string }
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
  return { ok: true, projectId: release.project_id as string }
}

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
        projectName: activeProject.name ?? null,
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

    const db = getServiceClient()
    const userId = c.get('userId') as string
    const access = await assertTargetProjectAccess(c, db, userId, body.data.project_id)
    if (!access.ok) return access.response

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
      return c.json({ ok: false, error: 'Could not reach release-builder function' }, 500)
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
      return c.json({ ok: false, error: `release-builder error: ${rawText.slice(0, 100)}` }, 500)
    }
    if (!res.ok) return c.json({ ok: false, error: (data.error as string) ?? 'release-builder failed' }, 500)
    return c.json({ ok: true, data: (data as { data?: unknown }).data ?? data })
  })

  // ─── Release detail ────────────────────────────────────────────────────────
  app.get('/v1/admin/releases/:id', jwtAuth, async (c) => {
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
    const userId = c.get('userId') as string
    const idParsed = parseUuidParam(c, 'id')
    if (!idParsed.ok) return idParsed.error
    const rowAccess = await assertReleaseRowAccess(c, db, userId, idParsed.value)
    if (!rowAccess.ok) return rowAccess.response

    const body = patchReleaseSchema.safeParse(await c.req.json())
    if (!body.success) return c.json({ ok: false, error: body.error.flatten() }, 400)

    const { data, error } = await db
      .from('releases')
      .update(body.data)
      .eq('id', c.req.param('id')!)
      .eq('status', 'draft') // can only edit drafts
      .select()
      .single()

    if (error) return c.json({ ok: false, error: error.message }, 500)
    return c.json({ ok: true, data })
  })

  // ─── Delete draft release ─────────────────────────────────────────────────
  app.delete('/v1/admin/releases/:id', jwtAuth, async (c) => {
    const db = getServiceClient()
    const userId = c.get('userId') as string
    const idParsed = parseUuidParam(c, 'id')
    if (!idParsed.ok) return idParsed.error
    const rowAccess = await assertReleaseRowAccess(c, db, userId, idParsed.value)
    if (!rowAccess.ok) return rowAccess.response

    const { error } = await db
      .from('releases')
      .delete()
      .eq('id', c.req.param('id')!)
      .eq('status', 'draft')

    if (error) return c.json({ ok: false, error: error.message }, 500)
    return c.json({ ok: true })
  })

  // ─── Publish release + notify credited users ──────────────────────────────
  app.post('/v1/admin/releases/:id/publish', jwtAuth, async (c) => {
    const db = getServiceClient()
    const userId = c.get('userId') as string
    const idParsed = parseUuidParam(c, 'id')
    if (!idParsed.ok) return idParsed.error
    const rowAccess = await assertReleaseRowAccess(c, db, userId, idParsed.value)
    if (!rowAccess.ok) return rowAccess.response

    // Mark as published
    const { data: release, error } = await db
      .from('releases')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', c.req.param('id')!)
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
        // fulfilled_ticket_ids is caller-supplied: only this project's tickets.
        .eq('project_id', release.project_id)
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

    // ── Reports this release fixed (Plan 018 §5) ─────────────────────────────
    // Each report in fixed_report_ids moves to the stored fixed state with the
    // version stamped, and its reporter gets ONE `released` message ("Shipped
    // in vX — does it work for you now?"), keyed by the release id so a retry
    // can not send it twice. In review mode the message is held in the Outbox.
    const fixedIds = [...new Set((release.fixed_report_ids ?? []) as string[])]
    const delivery = {
      reports_listed: fixedIds.length,
      reports_resolved: 0,
      reports_not_found: 0,
      reporters_notified: 0,
      reporters_held: 0,
      reporters_failed: 0,
      reports_without_reporter: 0,
      credits_stamped: 0,
      credits_pending: 0,
    }
    if (fixedIds.length > 0) {
      // fixed_report_ids is caller-editable: only this project's reports.
      const { data: fixedReports, error: fixedErr } = await db
        .from('reports')
        .select('id, status, reporter_token_hash')
        .in('id', fixedIds)
        .eq('project_id', release.project_id)
      if (fixedErr) {
        return c.json(
          { ok: false, error: `release published, but loading its ${fixedIds.length} fixed report(s) failed: ${fixedErr.message}` },
          500,
        )
      }
      delivery.reports_not_found = fixedIds.length - (fixedReports ?? []).length
      const message = buildNotificationMessage('released', { version: release.version })

      for (const report of (fixedReports ?? []) as Array<{ id: string; status: string; reporter_token_hash: string | null }>) {
        const { error: updErr } = await db
          .from('reports')
          .update({ status: 'fixed', fixed_in_version: release.version, fixed_release_id: release.id })
          .eq('id', report.id)
          .eq('project_id', release.project_id)
        if (updErr) {
          log.error('release_report_resolve_failed', { releaseId: release.id, reportId: report.id, error: updErr.message })
          delivery.reporters_failed++
          continue
        }
        delivery.reports_resolved++

        if (toStoredStatus(report.status) !== 'fixed') {
          // Plugins, linked issues; the reporter hears `released` below, not `fixed`.
          runStatusTransitionSideEffects(db, {
            reportId: report.id,
            projectId: release.project_id,
            reporterTokenHash: report.reporter_token_hash,
            previousStatus: report.status,
            newStatus: 'fixed',
            actor: { kind: 'admin', id: userId },
            notifyReporter: false,
          })
          if (report.reporter_token_hash) {
            await awardPoints(db, release.project_id, report.reporter_token_hash, { action: 'fixed' }).catch((e) =>
              log.warn('release_points_award_failed', { reportId: report.id, err: String(e) }),
            )
          }
        }

        if (!report.reporter_token_hash) {
          delivery.reports_without_reporter++
          continue
        }
        const payload = { message, reportId: report.id, version: release.version }
        const results = [
          await createNotification(db, release.project_id, report.id, report.reporter_token_hash, 'released', payload, {
            reviewable: true,
            dedupeKey: release.id,
          }),
          ...(await notifyFollowers(db, release.project_id, report.id, 'released', payload, {
            reviewable: true,
            dedupeKey: release.id,
          })),
        ]
        for (const r of results) {
          if (r.held) delivery.reporters_held++
          else if (r.delivered.includes('in_app') || r.duplicate.includes('in_app')) delivery.reporters_notified++
          else delivery.reporters_failed++
        }
      }
    }

    // ── Credits: stamp notified_at only where a delivered ledger row exists ──
    // Until 2026-10 this stamped every credit without sending anything.
    const { data: credits, error: creditsFetchError } = await db
      .from('release_credits')
      .select('id, report_id')
      .eq('release_id', release.id)
      .is('notified_at', null)
    if (creditsFetchError) {
      return c.json(
        { ok: false, error: `release published, but fetching credits failed: ${creditsFetchError.message}` },
        500,
      )
    }
    const creditReportIds = [
      ...new Set(
        ((credits ?? []) as Array<{ report_id: string | null }>)
          .map((cr) => cr.report_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ]
    const deliveredReportIds = new Set<string>()
    if (creditReportIds.length > 0) {
      const { data: ledger, error: ledgerErr } = await db
        .from('notification_deliveries')
        .select('report_id')
        .eq('notification_type', 'released')
        .eq('channel', 'in_app')
        .eq('status', 'sent')
        .eq('dedupe_key', release.id)
        .in('report_id', creditReportIds)
      if (ledgerErr) {
        return c.json(
          { ok: false, error: `release published, but reading the delivery ledger failed: ${ledgerErr.message}` },
          500,
        )
      }
      for (const row of (ledger ?? []) as Array<{ report_id: string }>) deliveredReportIds.add(row.report_id)
    }
    const stampIds = ((credits ?? []) as Array<{ id: string; report_id: string | null }>)
      .filter((cr) => cr.report_id && deliveredReportIds.has(cr.report_id))
      .map((cr) => cr.id)
    delivery.credits_pending = (credits ?? []).length - stampIds.length
    if (stampIds.length > 0) {
      const { error: creditsUpdateError, count } = await db
        .from('release_credits')
        .update({ notified_at: new Date().toISOString() }, { count: 'exact' })
        .in('id', stampIds)
        .is('notified_at', null)
      if (creditsUpdateError) {
        return c.json(
          {
            ok: false,
            error: `release published, but marking ${stampIds.length} credit(s) notified failed: ${creditsUpdateError.message}`,
          },
          500,
        )
      }
      delivery.credits_stamped = count ?? 0
    }

    return c.json({
      ok: true,
      data: release,
      // Credits whose reporter actually received the release message.
      notified: delivery.credits_stamped,
      tickets_fulfilled: ticketIds.length,
      delivery,
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
