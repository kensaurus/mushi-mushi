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

export function registerReleasesRoutes(app: Hono) {
  // ─── List releases ────────────────────────────────────────────────────────
  app.get('/v1/admin/releases', jwtAuth, async (c) => {
    const db = getServiceClient()
    const projectId = c.req.query('projectId') ?? c.req.header('x-mushi-project-id') ?? null
    const status = c.req.query('status') // 'draft' | 'published'
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20'), 100)
    const offset = parseInt(c.req.query('offset') ?? '0')

    let query = db
      .from('releases')
      .select('id, project_id, version, title, status, published_at, credited_reporter_ids, fixed_report_ids, created_at, updated_at', { count: 'exact' })
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

    const res = await fetch(`${supabaseUrl}/functions/v1/release-builder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
        'x-mushi-admin': '1',
      },
      body: JSON.stringify(body.data),
    })

    const data = await res.json()
    if (!res.ok) return c.json({ ok: false, error: data.error ?? 'release-builder failed' }, 500)
    return c.json(data)
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

    // Get credits to notify
    const { data: credits } = await db
      .from('release_credits')
      .select('id, end_user_id, display_name_at_time')
      .eq('release_id', release.id)
      .is('notified_at', null)

    // Mark all credits as notified (the SDK will pick up the toast on next widget open)
    if ((credits ?? []).length > 0) {
      await db
        .from('release_credits')
        .update({ notified_at: new Date().toISOString() })
        .eq('release_id', release.id)
        .is('notified_at', null)
    }

    return c.json({
      ok: true,
      data: release,
      notified: (credits ?? []).length,
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
