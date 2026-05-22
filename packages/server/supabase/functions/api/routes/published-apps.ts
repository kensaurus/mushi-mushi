// ============================================================
// published-apps.ts — Dev/PM console routes for managing the
// Mushi Bounties marketplace listing for a project.
//
// All routes require JWT auth + marketplace_publish entitlement.
//
//   GET  /v1/admin/published-apps/:projectId              — read listing
//   PUT  /v1/admin/published-apps/:projectId              — upsert listing
//   GET  /v1/admin/published-apps/:projectId/targeting    — read targeting
//   PUT  /v1/admin/published-apps/:projectId/targeting    — update targeting
//   GET  /v1/admin/published-apps/:projectId/bounties     — list bounty overrides
//   GET  /v1/admin/published-apps/:projectId/stats        — budget + submission stats
//   POST /v1/admin/published-apps/:projectId/publish      — flip to public
//   POST /v1/admin/published-apps/:projectId/pause        — flip to paused
// ============================================================

import type { Hono } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { getServiceClient } from '../../_shared/db.ts'
import { jwtAuth } from '../../_shared/auth.ts'
import { log } from '../../_shared/logger.ts'

declare const Deno: { env: { get(name: string): string | undefined } }

const rlog = log.child('published-apps-routes')

// ─── Zod schemas ─────────────────────────────────────────────

const AppUpsertSchema = z.object({
  name:           z.string().min(2).max(80),
  tagline:        z.string().max(140).optional(),
  description:    z.string().max(4000).optional(),
  hero_url:       z.string().url().optional().nullable(),
  screenshots_urls: z.array(z.string().url()).max(8).optional(),
  app_store_url:  z.string().url().optional().nullable(),
  play_store_url: z.string().url().optional().nullable(),
  web_url:        z.string().url().optional().nullable(),
  platforms:      z.array(z.string()).optional(),
  sentry_dsn:     z.string().optional().nullable(),
  auto_seer_analyze: z.boolean().optional(),
  slug:           z.string().regex(/^[a-z0-9][a-z0-9\-]{1,60}[a-z0-9]$/).optional(),
})

const TargetingSchema = z.object({
  min_age:         z.number().int().min(13).max(100).optional().nullable(),
  country_codes:   z.array(z.string().length(2)).optional(),
  languages:       z.array(z.string()).optional(),
  required_devices: z.array(z.record(z.unknown())).optional(),
  expertise_tags:  z.array(z.string()).optional(),
  reputation_min:  z.number().int().min(0).optional(),
})

// ─── Helper: check entitlement ───────────────────────────────

async function requireMarketplacePublish(
  supabase: ReturnType<typeof getServiceClient>,
  projectId: string,
): Promise<{ orgId: string } | null> {
  const { data: ps } = await supabase
    .from('project_settings')
    .select('organization_id')
    .eq('project_id', projectId)
    .single()

  if (!ps) return null

  const { data: plan } = await supabase.rpc('get_org_feature_flags', {
    p_organization_id: ps.organization_id,
  })

  if (!plan?.marketplace_publish) return null

  return { orgId: ps.organization_id }
}

// ─── Route registration ───────────────────────────────────────

export function registerPublishedAppsRoutes(app: Hono) {
  // GET /v1/admin/published-apps/:projectId
  app.get('/v1/admin/published-apps/:projectId', jwtAuth, async (c) => {
    const projectId = c.req.param('projectId')
    const supabase = getServiceClient()

    const gate = await requireMarketplacePublish(supabase, projectId)
    if (!gate) {
      return c.json({ error: 'not_found_or_not_entitled' }, 403)
    }

    const { data, error } = await supabase
      .from('published_apps')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle()

    if (error) {
      rlog.error('GET published-apps', { error: error.message })
      return c.json({ error: error.message }, 500)
    }

    return c.json(data)
  })

  // PUT /v1/admin/published-apps/:projectId
  app.put('/v1/admin/published-apps/:projectId', jwtAuth, async (c) => {
    const projectId = c.req.param('projectId')
    const userId = c.get('userId') as string
    const supabase = getServiceClient()

    const gate = await requireMarketplacePublish(supabase, projectId)
    if (!gate) return c.json({ error: 'not_found_or_not_entitled' }, 403)

    const body = await c.req.json()
    const parsed = AppUpsertSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

    // Ensure slug uniqueness if provided.
    if (parsed.data.slug) {
      const { data: existing } = await supabase
        .from('published_apps')
        .select('id, project_id')
        .eq('slug', parsed.data.slug)
        .neq('project_id', projectId)
        .maybeSingle()

      if (existing) return c.json({ error: 'slug_taken' }, 409)
    }

    const { data: current } = await supabase
      .from('published_apps')
      .select('id, slug')
      .eq('project_id', projectId)
      .maybeSingle()

    const slug = parsed.data.slug
      ?? current?.slug
      ?? parsed.data.name?.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/--+/g, '-').slice(0, 62)

    const payload = {
      project_id: projectId,
      organization_id: gate.orgId,
      owner_user_id: userId,
      slug,
      ...parsed.data,
    }

    const { data, error } = await supabase
      .from('published_apps')
      .upsert(payload, { onConflict: 'project_id' })
      .select()
      .single()

    if (error) {
      rlog.error('PUT published-apps', { error: error.message })
      return c.json({ error: error.message }, 500)
    }

    // Back-fill project_settings.marketplace_published_app_id.
    await supabase
      .from('project_settings')
      .update({ marketplace_published_app_id: data.id })
      .eq('project_id', projectId)

    return c.json(data)
  })

  // POST /v1/admin/published-apps/:projectId/publish
  app.post('/v1/admin/published-apps/:projectId/publish', jwtAuth, async (c) => {
    const projectId = c.req.param('projectId')
    const supabase = getServiceClient()

    const gate = await requireMarketplacePublish(supabase, projectId)
    if (!gate) return c.json({ error: 'not_found_or_not_entitled' }, 403)

    const { data, error } = await supabase
      .from('published_apps')
      .update({ visibility: 'public', published_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .select()
      .single()

    if (error) return c.json({ error: error.message }, 500)
    return c.json(data)
  })

  // POST /v1/admin/published-apps/:projectId/pause
  app.post('/v1/admin/published-apps/:projectId/pause', jwtAuth, async (c) => {
    const projectId = c.req.param('projectId')
    const supabase = getServiceClient()

    const gate = await requireMarketplacePublish(supabase, projectId)
    if (!gate) return c.json({ error: 'not_found_or_not_entitled' }, 403)

    const { data, error } = await supabase
      .from('published_apps')
      .update({ visibility: 'paused', paused_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .select()
      .single()

    if (error) return c.json({ error: error.message }, 500)
    return c.json(data)
  })

  // GET /v1/admin/published-apps/:projectId/targeting
  app.get('/v1/admin/published-apps/:projectId/targeting', jwtAuth, async (c) => {
    const projectId = c.req.param('projectId')
    const supabase = getServiceClient()

    const gate = await requireMarketplacePublish(supabase, projectId)
    if (!gate) return c.json({ error: 'not_found_or_not_entitled' }, 403)

    const { data: app } = await supabase
      .from('published_apps')
      .select('id')
      .eq('project_id', projectId)
      .maybeSingle()

    if (!app) return c.json(null)

    const { data } = await supabase
      .from('published_app_targeting')
      .select('*')
      .eq('app_id', app.id)
      .maybeSingle()

    return c.json(data)
  })

  // PUT /v1/admin/published-apps/:projectId/targeting
  app.put('/v1/admin/published-apps/:projectId/targeting', jwtAuth, async (c) => {
    const projectId = c.req.param('projectId')
    const supabase = getServiceClient()

    const gate = await requireMarketplacePublish(supabase, projectId)
    if (!gate) return c.json({ error: 'not_found_or_not_entitled' }, 403)

    const { data: app } = await supabase
      .from('published_apps')
      .select('id')
      .eq('project_id', projectId)
      .maybeSingle()

    if (!app) return c.json({ error: 'app_not_found' }, 404)

    const body = await c.req.json()
    const parsed = TargetingSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

    const { data, error } = await supabase
      .from('published_app_targeting')
      .upsert({ app_id: app.id, ...parsed.data }, { onConflict: 'app_id' })
      .select()
      .single()

    if (error) return c.json({ error: error.message }, 500)
    return c.json(data)
  })

  // GET /v1/admin/published-apps/:projectId/bounties
  app.get('/v1/admin/published-apps/:projectId/bounties', jwtAuth, async (c) => {
    const projectId = c.req.param('projectId')
    const supabase = getServiceClient()

    const gate = await requireMarketplacePublish(supabase, projectId)
    if (!gate) return c.json({ error: 'not_found_or_not_entitled' }, 403)

    const { data: app } = await supabase
      .from('published_apps')
      .select('id')
      .eq('project_id', projectId)
      .maybeSingle()

    if (!app) return c.json([])

    const { data } = await supabase
      .from('published_app_bounties')
      .select('*')
      .eq('app_id', app.id)
      .order('action')

    return c.json(data ?? [])
  })

  // GET /v1/admin/published-apps/:projectId/stats
  app.get('/v1/admin/published-apps/:projectId/stats', jwtAuth, async (c) => {
    const projectId = c.req.param('projectId')
    const supabase = getServiceClient()

    const gate = await requireMarketplacePublish(supabase, projectId)
    if (!gate) return c.json({ error: 'not_found_or_not_entitled' }, 403)

    const { data: app } = await supabase
      .from('published_apps')
      .select('id')
      .eq('project_id', projectId)
      .maybeSingle()

    if (!app) return c.json(null)

    const { data: ps } = await supabase
      .from('project_settings')
      .select('marketplace_monthly_budget_usd')
      .eq('project_id', projectId)
      .single()

    // Submission stats for last 30d.
    const { data: subs } = await supabase
      .from('tester_submissions')
      .select('id, status, points_awarded')
      .eq('app_id', app.id)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())

    const submissions_30d = subs?.length ?? 0
    const accepted_30d = subs?.filter((s) => s.status === 'accepted').length ?? 0
    const points_spent_30d = subs?.reduce((acc, s) => acc + (s.points_awarded ?? 0), 0) ?? 0

    // Active testers.
    const { count: active_testers } = await supabase
      .from('tester_app_subscriptions')
      .select('tester_id', { count: 'exact', head: true })
      .eq('app_id', app.id)
      .eq('status', 'active')

    // Budget check via RPC.
    const { data: budget } = await supabase.rpc('check_marketplace_budget', {
      p_project_id: projectId,
      p_requested_amount_usd: 0,
    })

    return c.json({
      submissions_30d,
      accepted_30d,
      active_testers: active_testers ?? 0,
      points_spent_30d,
      monthly_budget_usd: ps?.marketplace_monthly_budget_usd ?? 0,
      monthly_budget_used_pct: budget?.pct_used ?? 0,
    })
  })
}
