// ============================================================
// community.ts — Cross-app community API routes for the Mushi SDK widget.
//
// Tester-authenticated (JWT + mushi_testers row required):
//   POST /v1/tester/link-reporter       — link anonymous reporter_token_hash
//                                         to the caller's mushi_testers identity
//   GET  /v1/tester/cross-app-reports   — all reports by this tester, across apps
//   GET  /v1/tester/reputation          — global rank + points
//   GET  /v1/public/tester-leaderboard  — top-N global leaderboard (no auth required)
//   GET  /v1/me/tester-status           — whether the caller has a mushi_testers row
//
// These endpoints are consumed by the in-widget Mushi community UI.
// ============================================================

import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { z } from 'npm:zod@3'
import { getServiceClient, getUserClient } from '../../_shared/db.ts'
import { jwtAuth } from '../../_shared/auth.ts'
import { log } from '../../_shared/logger.ts'

const rlog = log.child('community-routes')

export function registerCommunityRoutes(app: Hono<{ Variables: Variables }>) {

  // ── POST /v1/tester/magic-link ─────────────────────────────────────────────
  // Sends a magic-link email for in-widget Mushi account sign-in.
  // No authentication required — the email itself is the credential.
  app.post('/v1/tester/magic-link', async (c) => {
    const schema = z.object({ email: z.string().email() })
    let body: z.infer<typeof schema>
    try {
      body = schema.parse(await c.req.json())
    } catch {
      return c.json({ error: 'invalid_body' }, 400)
    }

    const supabase = getServiceClient()
    // Use admin OTP to send a magic link that creates the user if needed.
    // redirectTo goes to the Mushi tester dashboard where they can optionally
    // view/copy their session. The in-widget experience shows "check your email."
    const { error } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: body.email,
    })

    if (error) {
      rlog.error('magic-link send failed', { error: error.message, email: body.email })
      // Don't leak whether the address exists — always return ok.
      // Log internally but tell the client "sent" regardless.
    }

    return c.json({ ok: true })
  })

  // ── POST /v1/tester/link-reporter ──────────────────────────────────────────
  // Links an anonymous reporter_token_hash to the caller's mushi_testers row.
  // The SDK calls this once on every in-widget sign-in, passing the SHA-256 hash
  // of the local reporter_token (never the raw token).
  app.post('/v1/tester/link-reporter', jwtAuth, async (c) => {
    const schema = z.object({ reporter_token_hash: z.string().min(1).max(128) })
    let body: z.infer<typeof schema>
    try {
      body = schema.parse(await c.req.json())
    } catch {
      return c.json({ error: 'invalid_body' }, 400)
    }

    const userId = c.get('userId')
    const authHeader = c.req.header('Authorization')
    if (!userId || !authHeader) return c.json({ error: 'not_authenticated' }, 401)

    // User-scoped client so auth.uid() resolves inside the SECURITY DEFINER RPC.
    const supabase = getUserClient(authHeader)
    const { data, error } = await supabase.rpc('mushi_link_reporter_token', {
      p_reporter_token_hash: body.reporter_token_hash,
    })

    if (error) {
      rlog.error('mushi_link_reporter_token failed', { error: error.message, sub: userId })
      return c.json({ error: 'rpc_error', detail: error.message }, 500)
    }

    const result = data as { ok: boolean; linked?: number; error?: string }
    if (!result.ok) {
      return c.json({ error: result.error ?? 'link_failed' }, 400)
    }

    return c.json({ ok: true, linked: result.linked ?? 0 })
  })

  // ── GET /v1/tester/cross-app-reports ───────────────────────────────────────
  // Returns all reports filed by the caller's tester identity, across all projects.
  app.get('/v1/tester/cross-app-reports', jwtAuth, async (c) => {
    const limit  = Math.min(200, parseInt(c.req.query('limit')  ?? '50',  10) || 50)
    const offset = Math.max(0,   parseInt(c.req.query('offset') ?? '0',   10) || 0)

    const userId = c.get('userId')
    const authHeader = c.req.header('Authorization')
    if (!userId || !authHeader) return c.json({ error: 'not_authenticated' }, 401)

    const supabase = getUserClient(authHeader)
    const { data, error } = await supabase.rpc('mushi_get_my_cross_app_reports', {
      p_limit:  limit,
      p_offset: offset,
    })

    if (error) {
      rlog.error('mushi_get_my_cross_app_reports failed', { error: error.message })
      return c.json({ error: 'rpc_error', detail: error.message }, 500)
    }

    const result = data as { ok: boolean; reports: unknown[]; error?: string }
    if (!result.ok) {
      return c.json({ error: result.error ?? 'fetch_failed' }, 400)
    }

    return c.json({ reports: result.reports ?? [] })
  })

  // ── GET /v1/tester/reputation ───────────────────────────────────────────────
  // Returns the caller's global rank + points from the tester_leaderboard_30d view.
  app.get('/v1/tester/reputation', jwtAuth, async (c) => {
    const userId = c.get('userId')
    const authHeader = c.req.header('Authorization')
    if (!userId || !authHeader) return c.json({ error: 'not_authenticated' }, 401)

    const supabase = getUserClient(authHeader)
    const { data, error } = await supabase.rpc('mushi_get_my_reputation')

    if (error) {
      rlog.error('mushi_get_my_reputation failed', { error: error.message })
      return c.json({ error: 'rpc_error', detail: error.message }, 500)
    }

    const result = data as { ok: boolean; reputation: unknown; error?: string }
    if (!result.ok) {
      return c.json({ error: result.error ?? 'fetch_failed' }, 400)
    }

    return c.json({ reputation: result.reputation })
  })

  // ── GET /v1/public/tester-leaderboard ──────────────────────────────────────
  // Top-N global leaderboard from the public view (no auth required).
  app.get('/v1/public/tester-leaderboard', async (c) => {
    const limit = Math.min(100, parseInt(c.req.query('limit') ?? '20', 10) || 20)
    const supabase = getServiceClient()

    const { data, error } = await supabase
      .from('tester_leaderboard_30d_public')
      .select('public_handle, display_name, rank, total_points_30d, total_points_lifetime')
      .order('rank', { ascending: true })
      .limit(limit)

    if (error) {
      return c.json({ error: 'fetch_failed' }, 500)
    }

    // Map to the widget-expected shape (tester_id is not exposed in the public view)
    const leaderboard = (data ?? []).map((row, i) => ({
      tester_id: `lb_${row.rank ?? i}`,
      public_handle: row.public_handle ?? null,
      display_name: row.display_name ?? null,
      rank: row.rank ?? i + 1,
      points_30d: (row as Record<string, unknown>).total_points_30d as number ?? 0,
      total_points: (row as Record<string, unknown>).total_points_lifetime as number ?? 0,
    }))

    return c.json({ leaderboard })
  })

  // GET /v1/me/tester-status — owned by tester-marketplace.ts (rich camelCase payload).
}
