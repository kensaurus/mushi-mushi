// ============================================================
// tester-marketplace.ts — API routes for the Mushi Bounties
// tester-side experience.
//
// Public (no auth required):
//   GET /v1/public/marketplace/apps         — browse listing (SSR use)
//   GET /v1/public/marketplace/apps/:slug   — app detail
//   GET /v1/public/marketplace/leaderboard  — top 50 testers
//
// Tester-authenticated (JWT + mushi_testers row required):
//   GET  /v1/tester/me                          — profile + balance + reputation
//   GET  /v1/tester/apps                        — joined apps with per-app stats
//   GET  /v1/tester/apps/:slug                  — app detail (with tester-specific state)
//   POST /v1/tester/apps/:slug/join             — join a test program
//   POST /v1/tester/apps/:slug/leave            — leave a test program
//   GET  /v1/tester/submissions                 — paginated submission list
//   POST /v1/tester/submissions                 — submit a bug (proxies ingestReport)
//   GET  /v1/tester/wallet/catalog              — redemption catalog
//   POST /v1/tester/wallet/redeem               — redeem points
//   GET  /v1/tester/wallet/history              — ledger + redemption history
//
// Dev-side reviewer actions (JWT, org-scoped):
//   POST /v1/admin/tester-submissions/:id/accept
//   POST /v1/admin/tester-submissions/:id/informative
//   POST /v1/admin/tester-submissions/:id/duplicate
//   POST /v1/admin/tester-submissions/:id/spam
//
// Me tester status (JWT):
//   GET /v1/me/tester-status
// ============================================================

import type { Hono, Context } from 'npm:hono@4'
import type { ContentfulStatusCode } from 'npm:hono@4/utils/http-status'
import type { Variables } from '../types.ts'
import { z } from 'npm:zod@3'
import { getServiceClient } from '../../_shared/db.ts'
import { jwtAuth } from '../../_shared/auth.ts'
import { log } from '../../_shared/logger.ts'
import { requireSuperAdmin } from '../../_shared/super-admin.ts'
import { accessibleProjectIds } from '../../_shared/project-access.ts'
import {
  REDEMPTION_CATALOG,
  resolveCatalogItem,
  severityToBountyAction,
  lookupBountyPoints,
  requireSubmissionProjectAccess,
  awardPointsChecked,
  validateRedeemRequestBody,
  resolveBudgetProjectId,
  checkGiftCardKycAndCap,
  checkPayoutSanctions,
  checkDailyBountyCap,
  buildWalletCatalogItems,
  KYC_THRESHOLD_USD,
  KYC_ANNUAL_CAP_USD,
} from '../../_shared/tester-marketplace-helpers.ts'

declare const Deno: { env: { get(name: string): string | undefined } }

const rlog = log.child('tester-marketplace-routes')

// ─── OFAC-denied country codes (simplified list) ─────────────

// Wave 9: Import centralized sanctions module (replaces inline OFAC set).
import { checkSanctions } from '../../_shared/sanctions.ts'
import { hashTesterTin, normalizeTin } from '../../_shared/tin-hash.ts'

// ─── Helper: forward submission event to developer's Sentry DSN ──────────────
// Parses the DSN to extract the store endpoint and sends a minimal Sentry
// error event so the developer gets an alert in their own Sentry project.

async function forwardToSentryDsn(
  dsn: string,
  payload: {
    testerHandle: string | null
    submissionId: string
    title: string
    description: string
    severity: string | undefined
    submissionType: string
    appId: string
  },
): Promise<void> {
  // DSN format: https://<key>@<host>/<project_id>
  const dsnMatch = dsn.match(/^https?:\/\/([^@]+)@([^/]+)\/(\d+)$/)
  if (!dsnMatch) return

  const [, key, host, projectId] = dsnMatch
  const storeUrl = `https://${host}/api/${projectId}/store/?sentry_version=7&sentry_key=${key}`

  const sentryEvent = {
    event_id: payload.submissionId.replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    level: payload.severity ?? 'error',
    platform: 'other',
    logger: 'mushi-bounties',
    message: `[Mushi Bounties] ${payload.title}`,
    extra: {
      mushi_bounties: true,
      submission_id: payload.submissionId,
      submission_type: payload.submissionType,
      app_id: payload.appId,
      tester_handle: payload.testerHandle ?? 'anonymous',
      description: payload.description,
    },
    tags: {
      source: 'mushi-bounties',
      submission_type: payload.submissionType,
    },
  }

  await fetch(storeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sentry-Auth': `Sentry sentry_version=7,sentry_key=${key}` },
    body: JSON.stringify(sentryEvent),
  })
}

// ─── Helper: resolve tester from JWT ─────────────────────────

async function resolveTester(
  supabase: ReturnType<typeof getServiceClient>,
  authUserId: string,
): Promise<{ id: string; country_code: string | null; public_handle: string | null } | null> {
  const { data } = await supabase
    .from('mushi_testers')
    .select('id, country_code, public_handle')
    .eq('auth_user_id', authUserId)
    .maybeSingle()
  return data ?? null
}

/** Idempotent tester bootstrap — mirrors private.handle_new_tester_user(). */
async function provisionTesterAccount(
  supabase: ReturnType<typeof getServiceClient>,
  authUserId: string,
  opts?: { marketingOptIn?: boolean; acceptedTerms?: boolean },
): Promise<{ id: string; created: boolean } | null> {
  const { data: existing } = await supabase
    .from('mushi_testers')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (existing?.id) {
    return { id: existing.id, created: false }
  }

  if (opts?.acceptedTerms !== true) {
    return null
  }

  const now = new Date().toISOString()
  const { data: row, error } = await supabase
    .from('mushi_testers')
    .insert({
      auth_user_id: authUserId,
      marketing_opt_in: opts?.marketingOptIn ?? false,
      terms_accepted_at: now,
    })
    .select('id')
    .single()

  if (error || !row?.id) {
    rlog.error('provision_tester_failed', { authUserId, error: error?.message })
    return null
  }

  await supabase.from('mushi_tester_profiles').upsert(
    { tester_id: row.id },
    { onConflict: 'tester_id' },
  )
  await supabase.from('tester_balances').upsert(
    { tester_id: row.id, current_points: 0, total_points_lifetime: 0, total_points_30d: 0 },
    { onConflict: 'tester_id' },
  )
  await supabase.from('tester_reputation').upsert(
    { tester_id: row.id, score: 0 },
    { onConflict: 'tester_id' },
  )

  return { id: row.id, created: true }
}

// ─── Route registration ───────────────────────────────────────

export function registerTesterMarketplaceRoutes(app: Hono<{ Variables: Variables }>) {

  // ── Public routes ────────────────────────────────────────────

  // GET /v1/public/marketplace/apps
  app.get('/v1/public/marketplace/apps', async (c) => {
    const supabase = getServiceClient()
    const platform = c.req.query('platform') || undefined
    const minPointsParam = c.req.query('min_points')
    const minPoints = minPointsParam ? parseInt(minPointsParam, 10) : undefined

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('published_apps')
      .select('id, slug, name, tagline, hero_url, platforms, published_at, published_app_bounties(points_per_event, enabled)')
      .eq('visibility', 'public')
      .order('published_at', { ascending: false })
      .limit(100)

    // Postgres array containment: platform must be in the platforms array
    if (platform) {
      query = query.contains('platforms', [platform])
    }

    const { data } = await query

    // Compute max_bounty_points per app and apply min_points filter in-memory
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let apps = ((data ?? []) as any[]).map((a: any) => {
      const bounties: Array<{ points_per_event: number; enabled: boolean }> =
        a.published_app_bounties ?? []
      const maxBountyPoints =
        bounties.filter(b => b.enabled).reduce((m, b) => Math.max(m, b.points_per_event), 0)
      const { published_app_bounties: _drop, ...rest } = a
      return { ...rest, max_bounty_points: maxBountyPoints }
    })

    if (minPoints !== undefined && !isNaN(minPoints)) {
      apps = apps.filter((a: any) => a.max_bounty_points >= minPoints)
    }

    return c.json(apps)
  })

  // GET /v1/public/marketplace/apps/:slug
  app.get('/v1/public/marketplace/apps/:slug', async (c) => {
    const slug = c.req.param('slug')!
    const supabase = getServiceClient()
    const { data } = await supabase
      .from('published_apps')
      .select(`
        id, slug, name, tagline, description, hero_url, screenshots_urls,
        platforms, app_store_url, play_store_url, web_url, published_at,
        published_app_targeting (*),
        published_app_bounties (action, points_per_event, enabled)
      `)
      .eq('slug', slug)
      .eq('visibility', 'public')
      .single()
    if (!data) return c.json({ error: 'not_found' }, 404)
    return c.json(data)
  })

  // GET /v1/public/marketplace/leaderboard
  app.get('/v1/public/marketplace/leaderboard', async (c) => {
    const supabase = getServiceClient()
    const { data } = await supabase
      .from('tester_leaderboard_30d_public')
      .select('*')
      .limit(50)
    return c.json(data ?? [])
  })

  // GET /v1/public/roadmap/:projectSlug — public feature board (anon)
  app.get('/v1/public/roadmap/:projectSlug', async (c) => {
    const slug = c.req.param('projectSlug')!
    const supabase = getServiceClient()
    const { data: project } = await supabase
      .from('projects')
      .select('id, name, slug')
      .eq('slug', slug)
      .maybeSingle()
    if (!project) return c.json({ error: 'not_found' }, 404)

    // Curated PII-free projection: never expose user_email / user_id /
    // admin_response on the public (anon) roadmap. Only the idea + vote stats.
    const { data: tickets, error } = await supabase
      .from('feature_requests_with_stats')
      .select('id, subject, body, status, vote_count, comment_count, created_at, shipped_at, shipped_note')
      .eq('project_id', project.id)
      .order('vote_count', { ascending: false })
      .limit(100)
    if (error) return c.json({ error: error.message }, 500)

    // The view's vote_count only counts authenticated `feature_request_votes`.
    // Anonymous roadmap votes land in `feature_request_reporter_votes`, so merge
    // them in — otherwise a public vote returns 200 but never changes the count.
    const ids = (tickets ?? []).map((t) => t.id as string)
    const reporterVotes = new Map<string, number>()
    if (ids.length) {
      const { data: rv } = await supabase
        .from('feature_request_reporter_votes')
        .select('request_id')
        .in('request_id', ids)
      for (const row of rv ?? []) {
        const rid = row.request_id as string
        reporterVotes.set(rid, (reporterVotes.get(rid) ?? 0) + 1)
      }
    }
    const merged = (tickets ?? [])
      .map((t) => ({
        ...t,
        vote_count: (Number(t.vote_count) || 0) + (reporterVotes.get(t.id as string) ?? 0),
      }))
      .sort((a, b) => b.vote_count - a.vote_count)
    return c.json({ project, tickets: merged })
  })

  // POST /v1/public/roadmap/:projectSlug/:id/vote — anonymous one-click vote
  app.post('/v1/public/roadmap/:projectSlug/:id/vote', async (c) => {
    const slug = c.req.param('projectSlug')!
    const requestId = c.req.param('id')!
    const body = await c.req.json().catch(() => ({})) as { visitorId?: string }
    const visitor = body.visitorId?.trim() || c.req.header('x-forwarded-for') || 'anon'
    const enc = new TextEncoder()
    const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(`roadmap:${visitor}`))
    const tokenHash = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, '0')).join('')

    const supabase = getServiceClient()
    const { data: project } = await supabase.from('projects').select('id').eq('slug', slug).maybeSingle()
    if (!project) return c.json({ error: 'not_found' }, 404)

    // This endpoint is unauthenticated/public — never trust the :id param. Confirm
    // the feature ticket actually belongs to this project before recording a vote,
    // otherwise a foreign/invalid id could pollute another project's tallies.
    const { data: ticket } = await supabase
      .from('support_tickets')
      .select('id')
      .eq('id', requestId)
      .eq('project_id', project.id)
      .eq('category', 'feature')
      .maybeSingle()
    if (!ticket) return c.json({ error: 'not_found' }, 404)

    const { data: existing } = await supabase
      .from('feature_request_reporter_votes')
      .select('id')
      .eq('request_id', requestId)
      .eq('reporter_token_hash', tokenHash)
      .maybeSingle()

    if (existing) {
      await supabase.from('feature_request_reporter_votes').delete().eq('id', existing.id)
      return c.json({ voted: false, action: 'removed' })
    }

    const { error: insErr } = await supabase.from('feature_request_reporter_votes').insert({
      request_id: requestId,
      project_id: project.id,
      reporter_token_hash: tokenHash,
    })
    if (insErr) return c.json({ error: insErr.message }, 500)
    return c.json({ voted: true, action: 'added' })
  })

  // ── Tester-authenticated routes ──────────────────────────────

  // GET /v1/me/tester-status — camelCase response consumed by TesterHomePage
  app.get('/v1/me/tester-status', jwtAuth, async (c) => {
    const authUserId = c.get('userId') as string
    const supabase = getServiceClient()
    const tester = await resolveTester(supabase, authUserId)

    if (!tester) {
      return c.json({ ok: true, data: {
        isTester: false,
        is_tester: false,
        handle: null,
        public_handle: null,
        display_name: null,
        reputation: 0,
        balance: 0,
        totalEarned: 0,
        totalRedeemed: 0,
        acceptedSubmissions: 0,
        joinedApps: 0,
      } })
    }

    const [{ data: testerRow }, { data: balance }, { data: rep }, { count: joinedApps }, { count: acceptedSubs }] = await Promise.all([
      supabase.from('mushi_testers').select('public_handle, display_name').eq('id', tester.id).single(),
      supabase.from('tester_balances').select('current_points, total_points_lifetime').eq('tester_id', tester.id).single(),
      supabase.from('tester_reputation').select('score').eq('tester_id', tester.id).single(),
      supabase.from('tester_app_subscriptions').select('app_id', { count: 'exact', head: true }).eq('tester_id', tester.id).eq('status', 'active'),
      supabase.from('tester_submissions').select('id', { count: 'exact', head: true }).eq('tester_id', tester.id).eq('status', 'accepted'),
    ])

    const totalEarned = balance?.total_points_lifetime ?? 0
    const currentPts = balance?.current_points ?? 0

    return c.json({ ok: true, data: {
      isTester: true,
      is_tester: true,
      handle: testerRow?.public_handle ?? testerRow?.display_name ?? null,
      public_handle: testerRow?.public_handle ?? null,
      display_name: testerRow?.display_name ?? null,
      reputation: rep?.score ?? 0,
      balance: currentPts,
      totalEarned,
      totalRedeemed: Math.max(0, totalEarned - currentPts),
      acceptedSubmissions: acceptedSubs ?? 0,
      joinedApps: joinedApps ?? 0,
    } })
  })

  // POST /v1/tester/enroll — opt-in for existing auth users (e.g. admin → bounties)
  app.post('/v1/tester/enroll', jwtAuth, async (c) => {
    const authUserId = c.get('userId') as string
    const supabase = getServiceClient()
    let body: { marketingOptIn?: boolean; acceptedTerms?: boolean } = {}
    try {
      body = await c.req.json()
    } catch {
      /* empty body ok */
    }

    if (body.acceptedTerms !== true) {
      return c.json({
        ok: false,
        error: { code: 'terms_required', message: 'You must accept the tester terms to enroll.' },
      }, 400)
    }

    const provisioned = await provisionTesterAccount(supabase, authUserId, {
      marketingOptIn: body.marketingOptIn === true,
      acceptedTerms: true,
    })
    if (!provisioned) {
      return c.json({ ok: false, error: { code: 'enroll_failed', message: 'Could not create tester account.' } }, 500)
    }

    return c.json({ ok: true, data: { enrolled: true, created: provisioned.created } })
  })

  // GET /v1/tester/me — camelCase response consumed by TesterSettingsPage
  app.get('/v1/tester/me', jwtAuth, async (c) => {
    const authUserId = c.get('userId') as string
    const supabase = getServiceClient()
    const tester = await resolveTester(supabase, authUserId)
    if (!tester) return c.json({ error: 'not_a_tester' }, 403)

    const [{ data: testerRow }, { data: profile }, { data: kyc }] = await Promise.all([
      supabase
        .from('mushi_testers')
        .select('public_handle, display_name, country_code, public_leaderboard')
        .eq('id', tester.id)
        .single(),
      supabase
        .from('mushi_tester_profiles')
        .select('bio, expertise_tags')
        .eq('tester_id', tester.id)
        .single(),
      supabase
        .from('tester_kyc')
        .select('withholding_status, tax_form_collected_at')
        .eq('tester_id', tester.id)
        .single(),
    ])

    return c.json({ ok: true, data: {
      handle: testerRow?.public_handle ?? testerRow?.display_name ?? null,
      bio: profile?.bio ?? null,
      expertiseTags: profile?.expertise_tags ?? [],
      country: testerRow?.country_code ?? null,
      kycStatus: kyc?.withholding_status ?? 'none',
      kycClearedAt: kyc?.tax_form_collected_at ?? null,
      privacyPublicHandle: testerRow?.public_leaderboard ?? true,
      privacyPublicLeaderboard: testerRow?.public_leaderboard ?? true,
    } })
  })

  // PUT /v1/tester/me — update profile (handle, bio, expertise_tags, country, privacy flags)
  app.put('/v1/tester/me', jwtAuth, async (c) => {
    const authUserId = c.get('userId') as string
    const supabase = getServiceClient()
    const tester = await resolveTester(supabase, authUserId)
    if (!tester) return c.json({ error: 'not_a_tester' }, 403)

    const body = await c.req.json() as Record<string, unknown>

    const testerUpdates: Record<string, unknown> = {}
    const profileUpdates: Record<string, unknown> = {}

    // handle → public_handle column
    if (typeof body.handle === 'string') testerUpdates.public_handle = body.handle.replace(/\s+/g, '-').toLowerCase().slice(0, 32)
    if (typeof body.country === 'string') testerUpdates.country_code = body.country.toUpperCase().slice(0, 2)
    if (typeof body.privacyPublicLeaderboard === 'boolean') testerUpdates.public_leaderboard = body.privacyPublicLeaderboard
    if (typeof body.privacyPublicHandle === 'boolean') {
      testerUpdates.public_leaderboard = body.privacyPublicHandle
    }

    if (typeof body.bio === 'string') profileUpdates.bio = body.bio.slice(0, 500)
    if (Array.isArray(body.expertiseTags)) profileUpdates.expertise_tags = body.expertiseTags.slice(0, 10)

    if (Object.keys(testerUpdates).length > 0) {
      await supabase.from('mushi_testers').update(testerUpdates).eq('id', tester.id)
    }
    if (Object.keys(profileUpdates).length > 0) {
      await supabase.from('mushi_tester_profiles').upsert({ tester_id: tester.id, ...profileUpdates }, { onConflict: 'tester_id' })
    }
    return c.json({ ok: true })
  })

  // GET /v1/tester/wallet — combined wallet state for TesterWalletPage
  app.get('/v1/tester/wallet', jwtAuth, async (c) => {
    const authUserId = c.get('userId') as string
    const supabase = getServiceClient()
    const tester = await resolveTester(supabase, authUserId)
    if (!tester) return c.json({ error: 'not_a_tester' }, 403)

    const [
      { data: balance },
      { data: kyc },
      { data: ledger },
      { data: ytdRows },
      { data: pendingRows },
      { data: tremendousEtaRows },
    ] = await Promise.all([
      supabase.from('tester_balances').select('current_points, total_points_lifetime').eq('tester_id', tester.id).maybeSingle(),
      supabase.from('tester_kyc').select('withholding_status, tax_form_collected_at').eq('tester_id', tester.id).maybeSingle(),
      supabase.from('tester_credit_ledger').select('id, delta_points, reason, created_at').eq('tester_id', tester.id).order('created_at', { ascending: false }).limit(20),
      // YTD gift-card USD (same logic as the redeem gate — cannot diverge)
      supabase.from('tester_redemptions')
        .select('face_value_usd')
        .eq('tester_id', tester.id)
        .eq('kind', 'gift_card')
        .in('status', ['complete', 'processing', 'pending'])
        .gte('requested_at', `${new Date().getFullYear()}-01-01`),
      // Pending and processing redemptions for in-flight display
      supabase.from('tester_redemptions')
        .select('id, kind, points_spent, face_value_usd, status, requested_at, processed_at')
        .eq('tester_id', tester.id)
        .in('status', ['pending', 'processing'])
        .order('requested_at', { ascending: false })
        .limit(10),
      // Compute mean gift-card fulfillment latency from recent Tremendous orders
      supabase.from('tremendous_orders')
        .select('created_at, last_synced_at')
        .eq('status', 'complete')
        .not('last_synced_at', 'is', null)
        .order('last_synced_at', { ascending: false })
        .limit(20),
    ])

    const ytdUsd = (ytdRows ?? []).reduce((acc, r) => acc + (r.face_value_usd ?? 0), 0)
    const kycStatus = kyc?.withholding_status ?? 'none'

    // Derive median gift-card ETA in hours from completed Tremendous orders
    let nextRedemptionEtaHours: number | null = null
    if (tremendousEtaRows && tremendousEtaRows.length >= 3) {
      const latencies = tremendousEtaRows
        .filter(o => o.last_synced_at && o.created_at)
        .map(o => (new Date(o.last_synced_at!).getTime() - new Date(o.created_at).getTime()) / 3_600_000)
      if (latencies.length > 0) {
        latencies.sort((a, b) => a - b)
        const mid = Math.floor(latencies.length / 2)
        const median = latencies.length % 2 === 0
          ? (latencies[mid - 1] + latencies[mid]) / 2
          : latencies[mid]
        nextRedemptionEtaHours = Math.round(Math.max(1, median))
      }
    }

    const catalog = buildWalletCatalogItems(kycStatus, nextRedemptionEtaHours)

    const walletCurrentPts = balance?.current_points ?? 0
    const walletTotalEarned = balance?.total_points_lifetime ?? 0
    return c.json({ ok: true, data: {
      balance: walletCurrentPts,
      totalEarned: walletTotalEarned,
      totalRedeemed: walletTotalEarned - walletCurrentPts,
      ytdGiftCardUsd: ytdUsd,
      kycThresholdUsd: KYC_THRESHOLD_USD,
      kycCapUsd: KYC_ANNUAL_CAP_USD,
      kycRequired: ytdUsd >= 400,
      kycCleared: kycStatus === 'cleared',
      nextRedemptionEtaHours,
      // In-flight redemptions the tester can track
      pendingRedemptions: (pendingRows ?? []).map(r => ({
        id: r.id,
        kind: r.kind,
        pointsSpent: r.points_spent,
        faceValueUsd: r.face_value_usd ?? null,
        status: r.status,
        requestedAt: r.requested_at,
        processedAt: r.processed_at ?? null,
      })),
      recentLedger: (ledger ?? []).map(e => ({
        id: e.id,
        type: (e.delta_points > 0 ? 'credit' : 'debit') as 'credit' | 'debit',
        points: Math.abs(e.delta_points),
        reason: e.reason,
        createdAt: e.created_at,
      })),
      catalog,
    } })
  })

  // PUT /v1/tester/kyc — KYC metadata submission (Wave 9)
  // Receives tax form kind + TIN (over HTTPS). Server HMACs with TESTER_TIN_PEPPER
  // before storage so a DB-only leak cannot be brute-forced offline.
  // Sets withholding_status='pending' until a reviewer clears it.
  app.put('/v1/tester/kyc', jwtAuth, async (c) => {
    const authUserId = c.get('userId') as string
    const supabase = getServiceClient()
    const tester = await resolveTester(supabase, authUserId)
    if (!tester) return c.json({ error: 'not_a_tester' }, 403)

    const body = await c.req.json()
    const { jurisdiction, taxFormKind, legalName, tin } = body as {
      jurisdiction?: string
      taxFormKind?: string
      legalName?: string
      tin?: string
    }

    if (!jurisdiction || !taxFormKind || !tin?.trim()) {
      return c.json({ error: 'jurisdiction, taxFormKind, and tin are required' }, 400)
    }

    const pepper = Deno.env.get('TESTER_TIN_PEPPER')
    if (!pepper || pepper.length < 32) {
      rlog.error('TESTER_TIN_PEPPER not configured or too short')
      return c.json({ error: 'kyc_unavailable' }, 503)
    }

    const tinProvidedHash = await hashTesterTin(normalizeTin(tin), pepper)

    // Upsert KYC row. withholding_status starts as 'pending' until manually reviewed.
    const { error } = await supabase
      .from('tester_kyc')
      .upsert(
        {
          tester_id: tester.id,
          jurisdiction,
          tax_form_kind: taxFormKind,
          tin_provided_hash: tinProvidedHash,
          withholding_status: 'pending',
          tax_form_collected_at: new Date().toISOString(),
          sanctions_screened_at: new Date().toISOString(),
        },
        { onConflict: 'tester_id' },
      )

    if (error) return c.json({ error: error.message }, 500)

    rlog.info('Tester KYC submitted', { testerId: tester.id, taxFormKind, jurisdiction })
    return c.json({ ok: true, status: 'pending_review' })
  })

  // POST /v1/tester/export — GDPR data portability
  app.post('/v1/tester/export', jwtAuth, async (c) => {
    const authUserId = c.get('userId') as string
    const supabase = getServiceClient()
    const tester = await resolveTester(supabase, authUserId)
    if (!tester) return c.json({ error: 'not_a_tester' }, 403)

    const { data: exportData } = await supabase.rpc('export_tester_data', { p_tester_id: tester.id })
    return c.json({ ok: true, data: exportData ?? {} })
  })

  // POST /v1/tester/delete — GDPR right-to-erasure
  app.post('/v1/tester/delete', jwtAuth, async (c) => {
    const authUserId = c.get('userId') as string
    const supabase = getServiceClient()
    const tester = await resolveTester(supabase, authUserId)
    if (!tester) return c.json({ error: 'not_a_tester' }, 403)

    await supabase.rpc('delete_tester_data', { p_tester_id: tester.id })
    return c.json({ ok: true })
  })

  // GET /v1/tester/apps — all public apps + per-app enrichment via get_tester_apps_enriched()
  // The RPC aggregates bounty schedule, 30d activity signals, tester-personal stats,
  // and fit flags in a single round trip (replaces the prior N+1 approach).
  app.get('/v1/tester/apps', jwtAuth, async (c) => {
    const authUserId = c.get('userId') as string
    const supabase = getServiceClient()
    const tester = await resolveTester(supabase, authUserId)
    if (!tester) return c.json({ error: 'not_a_tester' }, 403)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase RPC returns opaque jsonb
    const { data: raw, error } = await (supabase as any).rpc('get_tester_apps_enriched', { p_tester_id: tester.id })
    if (error) {
      rlog.error('get_tester_apps_enriched RPC failed', { error: error.message })
      return c.json({ error: error.message }, 500)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apps: any[] = Array.isArray(raw) ? raw : []

    return c.json({ ok: true, data: apps.map(app => ({
      id: app.id,
      slug: app.slug,
      name: app.name,
      tagline: app.tagline,
      description: app.description ?? null,
      heroUrl: app.hero_url ?? null,
      screenshotsUrls: app.screenshots_urls ?? [],
      platforms: app.platforms ?? [],
      webUrl: app.web_url ?? null,
      appStoreUrl: app.app_store_url ?? null,
      playStoreUrl: app.play_store_url ?? null,
      publishedAt: app.published_at,
      // bounty info
      maxBountyPoints: app.max_bounty_points ?? 0,
      bountySchedule: app.bounty_schedule ?? [],
      // targeting
      reputationMin: app.reputation_min ?? 0,
      targetCountries: app.country_codes?.length > 0 ? app.country_codes : null,
      languages: app.languages ?? [],
      expertiseTags: app.expertise_tags ?? [],
      // subscription
      joined: app.joined ?? false,
      joinedAt: app.joined_at ?? null,
      // activity signals
      accepted30d: app.accepted_30d ?? 0,
      submitted30d: app.submitted_30d ?? 0,
      acceptRate30d: app.submitted_30d > 0
        ? Math.round((app.accepted_30d / app.submitted_30d) * 100)
        : null,
      lastAcceptedAt: app.last_accepted_at ?? null,
      avgResponseHours: app.avg_response_hours ?? null,
      // tester personal stats
      mySubmissions: app.my_submissions ?? 0,
      myAccepted: app.my_accepted ?? 0,
      myPointsEarned: app.my_points_earned ?? 0,
      // fit flag
      meetsReputationGate: app.meets_reputation_gate ?? true,
      myReputationScore: app.my_reputation_score ?? 0,
    })) })
  })

  // GET /v1/tester/apps/:slug
  app.get('/v1/tester/apps/:slug', jwtAuth, async (c) => {
    const slug = c.req.param('slug')!
    const authUserId = c.get('userId') as string
    const supabase = getServiceClient()
    const tester = await resolveTester(supabase, authUserId)
    if (!tester) return c.json({ error: 'not_a_tester' }, 403)

    const { data: app } = await supabase
      .from('published_apps')
      .select(`*, published_app_bounties (action, points_per_event, enabled, daily_cap, lifetime_cap_per_tester)`)
      .eq('slug', slug)
      .eq('visibility', 'public')
      .single()

    if (!app) return c.json({ error: 'not_found' }, 404)

    // Overlay tester-specific state.
    const { data: sub } = await supabase
      .from('tester_app_subscriptions')
      .select('status, joined_at')
      .eq('tester_id', tester.id)
      .eq('app_id', app.id)
      .maybeSingle()

    // Per-app leaderboard (top 10).
    const { data: leaders } = await supabase
      .from('tester_submissions')
      .select('tester_id, points_awarded')
      .eq('app_id', app.id)
      .eq('status', 'accepted')
      .limit(100)

    const leaderMap = new Map<string, number>()
    for (const l of leaders ?? []) {
      leaderMap.set(l.tester_id, (leaderMap.get(l.tester_id) ?? 0) + l.points_awarded)
    }
    const topTesterIds = [...leaderMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id]) => id)

    const { data: handles } = await supabase
      .from('mushi_testers')
      .select('id, public_handle, display_name')
      .in('id', topTesterIds)

    const leaderboard = topTesterIds.map((id) => ({
      handle: handles?.find((h) => h.id === id)?.public_handle ?? '???',
      points: leaderMap.get(id) ?? 0,
    }))

    return c.json({ ok: true, data: { app, subscription: sub, leaderboard } })
  })

  // POST /v1/tester/apps/:idOrSlug/join — accepts app UUID or slug
  app.post('/v1/tester/apps/:idOrSlug/join', jwtAuth, async (c) => {
    const slug = c.req.param('idOrSlug')!
    const authUserId = c.get('userId') as string
    const supabase = getServiceClient()
    const tester = await resolveTester(supabase, authUserId)
    if (!tester) return c.json({ error: 'not_a_tester' }, 403)

    // OFAC check (Wave 9 sanctions geofence).
    const sanctionsResult = checkSanctions(tester.country_code)
    if (sanctionsResult.blocked) {
      return c.json({ error: 'region_not_supported', reason: sanctionsResult.reason }, 403)
    }

    // Accept either UUID or slug.
    const isUuid = /^[0-9a-f-]{36}$/i.test(slug ?? '')
    const appQuery = supabase
      .from('published_apps')
      .select('id, published_app_targeting (reputation_min)')
      .eq('visibility', 'public')
    const { data: app } = await (isUuid ? appQuery.eq('id', slug) : appQuery.eq('slug', slug)).single()

    if (!app) return c.json({ error: 'app_not_found' }, 404)

    // Reputation gate.
    const repMin = (app.published_app_targeting as { reputation_min?: number } | null)?.reputation_min ?? 0
    if (repMin > 0) {
      const { data: rep } = await supabase
        .from('tester_reputation')
        .select('score')
        .eq('tester_id', tester.id)
        .single()
      if ((rep?.score ?? 0) < repMin) {
        return c.json({ error: 'reputation_too_low', required: repMin }, 403)
      }
    }

    const { data, error } = await supabase
      .from('tester_app_subscriptions')
      .upsert(
        { tester_id: tester.id, app_id: app.id, status: 'active', joined_at: new Date().toISOString() },
        { onConflict: 'tester_id,app_id' },
      )
      .select()
      .single()

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data: data }, 201)
  })

  // POST /v1/tester/apps/:slug/leave
  app.post('/v1/tester/apps/:slug/leave', jwtAuth, async (c) => {
    const slug = c.req.param('slug')!
    const authUserId = c.get('userId') as string
    const supabase = getServiceClient()
    const tester = await resolveTester(supabase, authUserId)
    if (!tester) return c.json({ ok: false, error: { code: 'not_a_tester' } }, 403)

    const { data: app } = await supabase
      .from('published_apps')
      .select('id')
      .eq('slug', slug)
      .single()

    if (!app) return c.json({ ok: false, error: { code: 'app_not_found' } }, 404)

    await supabase
      .from('tester_app_subscriptions')
      .update({ status: 'removed', left_at: new Date().toISOString() })
      .eq('tester_id', tester.id)
      .eq('app_id', app.id)

    return c.json({ ok: true, data: { success: true } })
  })

  // GET /v1/tester/submissions
  app.get('/v1/tester/submissions', jwtAuth, async (c) => {
    const authUserId = c.get('userId') as string
    const page = Number(c.req.query('page') ?? '1')
    const limit = 20
    const supabase = getServiceClient()
    const tester = await resolveTester(supabase, authUserId)
    if (!tester) return c.json({ error: 'not_a_tester' }, 403)

    const { data, count } = await supabase
      .from('tester_submissions')
      .select('*, app:published_apps(id, slug, name)', { count: 'exact' })
      .eq('tester_id', tester.id)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    // Normalize to camelCase for React consumers.
    const normalized = (data ?? []).map(s => ({
      id: s.id,
      appId: (s.app as unknown as { id: string } | null)?.id ?? s.app_id,
      appName: (s.app as unknown as { name: string } | null)?.name ?? s.app_id,
      title: s.title ?? s.description?.slice(0, 80) ?? '(no title)',
      description: s.description ?? '',
      status: s.status as string,
      pointsAwarded: s.points_awarded ?? null,
      submittedAt: s.created_at,
      reviewedAt: s.reviewed_at ?? null,
      reviewerNote: s.reviewer_note ?? null,
    }))
    return c.json({ ok: true, data: { items: normalized, total: count ?? 0 } })
  })

  // POST /v1/tester/submissions
  // Proxies into ingestReport() with tester context.
  app.post('/v1/tester/submissions', jwtAuth, async (c) => {
    const authUserId = c.get('userId') as string
    const supabase = getServiceClient()
    const tester = await resolveTester(supabase, authUserId)
    if (!tester) return c.json({ error: 'not_a_tester' }, 403)

    const body = await c.req.json()
    // Accept both camelCase (from React SPA) and snake_case (from CLI/API consumers)
    const appId: string = (body.appId ?? body.app_id ?? '') as string
    const appSlug: string = (body.app_slug ?? '') as string
    const submissionType: string = (body.submission_type ?? body.submissionType ?? 'bug') as string
    const severity: string | undefined = (body.severity ?? undefined) as string | undefined
    const description: string = (body.description ?? '') as string
    const title: string = (body.title ?? description.slice(0, 80)) as string
    const screenshotUrl: string | undefined = (body.screenshotUrl ?? body.screenshot_url ?? undefined) as string | undefined

    if (!appId && !appSlug) return c.json({ ok: false, error: { code: 'MISSING_PARAM', message: 'app_id or app_slug required' } }, 400)
    if (!description) return c.json({ error: 'description required' }, 400)

    // Confirm tester is subscribed to this app.
    const appQuery = supabase
      .from('published_apps')
      .select('id, project_id, sentry_dsn')
      .eq('visibility', 'public')
    const { data: app } = await (appId
      ? appQuery.eq('id', appId)
      : appQuery.eq('slug', appSlug)
    ).single()

    if (!app) return c.json({ error: 'app_not_found' }, 404)

    const { data: sub } = await supabase
      .from('tester_app_subscriptions')
      .select('status')
      .eq('tester_id', tester.id)
      .eq('app_id', app.id)
      .single()

    if (!sub || sub.status !== 'active') {
      return c.json({ error: 'not_subscribed' }, 403)
    }

    // Wave 8: Tester velocity check via shared anti-gaming module.
    // 20 global / 5 per-app per 24h. Excess withholds points, not rejected outright.
    const { checkTesterVelocity } = await import('../../_shared/anti-gaming.ts')
    const velocityResult = await checkTesterVelocity(
      supabase,
      tester.id,
      app.id,
      app.project_id,
    )
    // velocityResult.withheld means we'll create the submission but won't auto-award points.
    const withheldByVelocity = velocityResult.withheld

    const bountyAction = severityToBountyAction(severity, submissionType)
    const bounty = await lookupBountyPoints(supabase, app.id, bountyAction)
    const expectedPoints = withheldByVelocity ? 0 : bounty.points

    // Create the tester_submissions row.
    // If velocity cap is exceeded, the submission is still created but marked withheld
    // so points are not auto-awarded until a reviewer approves.
    const { data: submission, error: subErr } = await supabase
      .from('tester_submissions')
      .insert({
        tester_id: tester.id,
        app_id: app.id,
        submission_type: submissionType,
        severity,
        description,
        title,
        screenshot_url: screenshotUrl ?? null,
        points_awarded: expectedPoints,
        status: withheldByVelocity ? 'spam' : 'pending', // 'spam' withholds auto-award; reviewer can override
      })
      .select()
      .single()

    if (subErr) {
      rlog.error('Failed to insert tester_submission', { error: subErr.message })
      return c.json({ error: subErr.message }, 500)
    }

    // Wave 6: Wire into ingestReport() so the submission lands in the reports
    // table tagged with tester_id / tester_submission_id. The app's Sentry DSN
    // is injected via project_settings so classify-report routes it to the right
    // Sentry project automatically.
    try {
      const { ingestReport } = await import('../helpers.ts')
      const ingestResult = await ingestReport(
        supabase,
        app.project_id,
        {
          description,
          category: submissionType === 'bug' ? 'bug' : 'other',
          reporterToken: `tester:${tester.id}`,
          environment: {},
        },
        {
          testerId: tester.id,
          testerSubmissionId: submission.id,
          userAgent: c.req.header('user-agent'),
        },
      )

      if (ingestResult.ok && ingestResult.reportId) {
        // Back-patch the report_id so the submission and report are linked.
        await supabase
          .from('tester_submissions')
          .update({ report_id: ingestResult.reportId })
          .eq('id', submission.id)
      } else {
        rlog.warn('ingestReport failed for tester submission', { error: ingestResult.error, submissionId: submission.id })
      }
    } catch (err) {
      // Non-blocking: the submission row is created even if ingestReport fails.
      rlog.error('ingestReport threw for tester submission', { error: String(err), submissionId: submission.id })
    }

    // Wave 6: If the published app has a Sentry DSN, forward a Sentry event
    // directly to the developer's Sentry project so they get alerted
    // through their own Sentry workflow. Non-blocking fire-and-forget.
    if (app.sentry_dsn) {
      forwardToSentryDsn(app.sentry_dsn, {
        testerHandle: tester.public_handle,
        submissionId: submission.id,
        title,
        description,
        severity,
        submissionType,
        appId: app.id,
      }).catch(err => {
        rlog.warn('Sentry DSN forward failed', { error: String(err), submissionId: submission.id })
      })
    }

    rlog.info('Tester submission created', {
      submission_id: submission.id,
      tester_id: tester.id,
      app_id: app.id,
      sentry_dsn: app.sentry_dsn ? '[set]' : '[not set]',
    })

    return c.json({ ok: true, data: submission }, 201)
  })

  // GET /v1/tester/wallet/catalog
  app.get('/v1/tester/wallet/catalog', jwtAuth, async (c) => {
    const options = Object.entries(REDEMPTION_CATALOG).map(([id, entry]) => ({
      id,
      sku: entry.sku ?? entry.kind,
      label: entry.label,
      description: entry.description,
      points_spent: entry.points_spent,
      face_value_usd: entry.face_value_usd ?? null,
      premium_multiplier: entry.premiumMultiplier ?? 1,
      kind: entry.kind,
    }))
    return c.json({ ok: true, data: options })
  })

  // POST /v1/tester/wallet/redeem
  app.post('/v1/tester/wallet/redeem', jwtAuth, async (c) => {
    const authUserId = c.get('userId') as string
    const supabase = getServiceClient()
    const tester = await resolveTester(supabase, authUserId)
    if (!tester) return c.json({ error: 'not_a_tester' }, 403)

    const body = await c.req.json() as {
      catalogItemId?: string
      clientEventId?: string
      kind?: string
      points_spent?: number
      face_value_usd?: number
    }

    const validated = validateRedeemRequestBody(body)
    if (!validated.ok) {
      return c.json({
        ok: false,
        error: { code: validated.code, message: validated.message },
      }, validated.status as ContentfulStatusCode)
    }

    const { catalogItemId, clientEventId, entry } = validated
    const { kind, points_spent: effectivePointsSpent, face_value_usd: faceValueUsd, sku } = entry
    const premiumMultiplier = entry.premiumMultiplier ?? (kind === 'mushi_pro_credit' ? 1.3 : 1.0)
    const idempotencyKey = `redeem:${tester.id}:${catalogItemId}:${clientEventId}`

    const sanctions = checkPayoutSanctions(tester.country_code)
    if (!sanctions.ok) {
      return c.json({ ok: false, error: { code: sanctions.code, message: sanctions.message } }, 403)
    }

    if (kind === 'gift_card' && faceValueUsd) {
      const kycGate = await checkGiftCardKycAndCap(supabase, tester.id, faceValueUsd)
      if (!kycGate.ok) {
        return c.json({ ok: false, error: { code: kycGate.code, message: kycGate.message } }, kycGate.status as ContentfulStatusCode)
      }

      const budgetProjectId = await resolveBudgetProjectId(supabase, tester.id)
      if (budgetProjectId) {
        const { data: budget } = await supabase.rpc('check_marketplace_budget', {
          p_project_id: budgetProjectId,
          p_requested_amount_usd: faceValueUsd,
        })
        if (budget?.would_exceed === true) {
          return c.json({
            ok: false,
            error: { code: 'budget_exceeded', message: 'This app\'s monthly gift-card budget is exhausted.' },
          }, 402)
        }
      }
    }

    const { data: existingRedemption } = await supabase
      .from('tester_redemptions')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()

    if (existingRedemption) {
      return c.json({ ok: true, data: existingRedemption }, 202)
    }

    const { data: balance } = await supabase
      .from('tester_balances')
      .select('current_points')
      .eq('tester_id', tester.id)
      .maybeSingle()

    if ((balance?.current_points ?? 0) < effectivePointsSpent) {
      return c.json({ ok: false, error: { code: 'insufficient_balance', message: 'Insufficient balance' } }, 400)
    }

    const deduct = await awardPointsChecked(supabase, {
      testerId: tester.id,
      deltaPoints: -effectivePointsSpent,
      reason: 'redemption',
      idempotencyKey: `deduct:${idempotencyKey}`,
    })

    if (!deduct.ok) {
      return c.json({
        ok: false,
        error: { code: deduct.error ?? 'deduction_failed', message: 'Could not deduct points for redemption.' },
      }, 400)
    }

    const { data: redemption, error: redErr } = await supabase
      .from('tester_redemptions')
      .insert({
        tester_id: tester.id,
        kind,
        points_spent: effectivePointsSpent,
        face_value_usd: faceValueUsd ?? null,
        premium_multiplier: premiumMultiplier,
        status: 'pending',
        idempotency_key: idempotencyKey,
      })
      .select()
      .single()

    if (redErr) {
      await awardPointsChecked(supabase, {
        testerId: tester.id,
        deltaPoints: effectivePointsSpent,
        reason: 'reversal',
        idempotencyKey: `refund:redeem-failed:${idempotencyKey}`,
      })
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: redErr.message } }, 500)
    }

    if (kind === 'gift_card' && faceValueUsd && sku) {
      await supabase.from('tremendous_orders').insert({
        tester_id: tester.id,
        redemption_id: redemption.id,
        status: 'pending',
        amount_usd: faceValueUsd,
        sku,
      })
    }

    if (kind !== 'gift_card') {
      try {
        const { stripeFromEnv, createCustomerBalanceCredit } = await import('../../_shared/stripe.ts')
        const stripeCfg = stripeFromEnv()

        const { data: userSubscription } = await supabase
          .from('subscriptions')
          .select('stripe_customer_id')
          .eq('user_id', authUserId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (stripeCfg && userSubscription?.stripe_customer_id) {
          const faceValueCents = Math.round(effectivePointsSpent * premiumMultiplier)
          await createCustomerBalanceCredit(stripeCfg, {
            customerId: userSubscription.stripe_customer_id,
            amountCents: faceValueCents,
            currency: 'usd',
            description: `Mushi Bounties: ${effectivePointsSpent.toLocaleString()} points → Mushi Pro credit (${premiumMultiplier}× premium)`,
            idempotencyKey: `mbounty:credit:${redemption.id}`,
          })
        }
      } catch (err) {
        rlog.warn('Stripe Pro credit failed — refunding points', {
          error: String(err),
          redemptionId: redemption.id,
        })
        await supabase.from('tester_redemptions').update({ status: 'failed', failure_reason: 'stripe_credit_failed' }).eq('id', redemption.id)
        await awardPointsChecked(supabase, {
          testerId: tester.id,
          deltaPoints: effectivePointsSpent,
          reason: 'reversal',
          idempotencyKey: `refund:stripe-failed:${idempotencyKey}`,
        })
        return c.json({ ok: false, error: { code: 'fulfillment_failed', message: 'Could not apply Pro credit.' } }, 500)
      }

      await supabase
        .from('tester_redemptions')
        .update({ status: 'complete', processed_at: new Date().toISOString() })
        .eq('id', redemption.id)
    }

    return c.json({ ok: true, data: redemption }, 202)
  })

  // GET /v1/tester/wallet/history
  app.get('/v1/tester/wallet/history', jwtAuth, async (c) => {
    const authUserId = c.get('userId') as string
    const supabase = getServiceClient()
    const tester = await resolveTester(supabase, authUserId)
    if (!tester) return c.json({ error: 'not_a_tester' }, 403)

    const [{ data: ledger }, { data: redemptions }] = await Promise.all([
      supabase
        .from('tester_credit_ledger')
        .select('*')
        .eq('tester_id', tester.id)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('tester_redemptions')
        .select('*')
        .eq('tester_id', tester.id)
        .order('requested_at', { ascending: false })
        .limit(20),
    ])

    return c.json({ ok: true, data: { ledger: ledger ?? [], redemptions: redemptions ?? [] } })
  })

  // ── Dev-side reviewer actions ────────────────────────────────

  const ReviewSchema = z.object({
    notes: z.string().max(2000).optional(),
    note: z.string().max(2000).optional(), // alias used by TesterSubmissionCard
  })

  // GET /v1/admin/tester-submissions — org-scoped reviewer queue
  app.get('/v1/admin/tester-submissions', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.query('projectId')
    const status = c.req.query('status') ?? 'pending'
    const page = Number(c.req.query('page') ?? '1')
    const limit = 20

    if (!projectId) {
      return c.json({ ok: false, error: { code: 'missing_param', message: 'projectId is required' } }, 400)
    }

    const supabase = getServiceClient()
    const allowed = await accessibleProjectIds(supabase, userId)
    if (!allowed.includes(projectId)) {
      return c.json({ ok: false, error: { code: 'forbidden', message: 'Forbidden' } }, 403)
    }

    const { data: app } = await supabase
      .from('published_apps')
      .select('id, name')
      .eq('project_id', projectId)
      .maybeSingle()

    if (!app) return c.json({ ok: true, data: { items: [], total: 0 } })

    let query = supabase
      .from('tester_submissions')
      .select(`
        id, title, description, status, severity, submission_type, points_awarded,
        created_at, reviewed_at, reviewer_note,
        mushi_testers!tester_submissions_tester_id_fkey ( public_handle, display_name )
      `, { count: 'exact' })
      .eq('app_id', app.id)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (status !== 'all') {
      query = query.eq('status', status)
    }

    const { data, count } = await query

    const items = (data ?? []).map((s) => {
      const tester = s.mushi_testers as { public_handle?: string; display_name?: string } | null
      return {
        id: s.id,
        title: s.title,
        description: s.description,
        status: s.status,
        severity: s.severity,
        submission_type: s.submission_type,
        points_awarded: s.points_awarded ?? 0,
        submitted_at: s.created_at,
        reviewed_at: s.reviewed_at,
        reviewer_note: s.reviewer_note,
        tester_handle: tester?.public_handle ?? tester?.display_name ?? null,
        app_name: app.name,
      }
    })

    return c.json({ ok: true, data: { items, total: count ?? 0 } })
  })

  // deno-lint-ignore no-explicit-any
  async function handleReview(
    c: Context<any>,
    action: 'accepted' | 'informative' | 'duplicate' | 'spam',
  ) {
    const id = c.req.param('id')!
    const userId = c.get('userId') as string
    const supabase = getServiceClient()
    const body = await c.req.json().catch(() => ({}))
    const parsed = ReviewSchema.safeParse(body)

    const access = await requireSubmissionProjectAccess(supabase, userId, id)
    if (!access.ok) {
      return c.json({ ok: false, error: { code: access.error } }, access.status)
    }

    const { data: sub } = await supabase
      .from('tester_submissions')
      .select('id, tester_id, app_id, points_awarded, severity, submission_type, status')
      .eq('id', id)
      .single()

    if (!sub) return c.json({ error: 'submission_not_found' }, 404)

    const bountyAction = severityToBountyAction(sub.severity, sub.submission_type)
    const bounty = await lookupBountyPoints(supabase, sub.app_id, bountyAction)
    const basePoints = sub.points_awarded > 0 ? sub.points_awarded : bounty.points

    const pointsMap: Record<typeof action, number> = {
      accepted: basePoints,
      informative: Math.floor(basePoints * 0.5),
      duplicate: 0,
      spam: 0,
    }
    const repMap: Record<typeof action, { kind: string; delta: number }> = {
      accepted:    { kind: 'submission_accepted',    delta: 7 },
      informative: { kind: 'submission_informative', delta: 0 },
      duplicate:   { kind: 'submission_duplicate',   delta: 2 },
      spam:        { kind: 'submission_spam',        delta: -10 },
    }

    let points = pointsMap[action]
    const repEvent = repMap[action]

    if (action === 'accepted' && points > 0) {
      const withinCap = await checkDailyBountyCap(supabase, sub.tester_id, sub.app_id, bountyAction, bounty.dailyCap)
      if (!withinCap) {
        return c.json({
          ok: false,
          error: { code: 'daily_cap_exceeded', message: 'Daily acceptance cap reached for this bounty tier.' },
        }, 429)
      }
    }

    const reviewerNote = parsed.success ? (parsed.data.notes ?? parsed.data.note) : undefined
    await supabase
      .from('tester_submissions')
      .update({
        status: action,
        reviewer_user_id: userId,
        reviewer_note: reviewerNote,
        notes: reviewerNote,
        accepted_at: action === 'accepted' ? new Date().toISOString() : undefined,
        reviewed_at: new Date().toISOString(),
        triaged_at: new Date().toISOString(),
        points_awarded: points,
      })
      .eq('id', id)

    if (points > 0) {
      const awarded = await awardPointsChecked(supabase, {
        testerId: sub.tester_id,
        deltaPoints: points,
        reason: 'submission_accepted',
        idempotencyKey: `review:${id}:${action}`,
        submissionId: sub.id,
        appId: sub.app_id,
      })
      if (!awarded.ok && !awarded.idempotentSkip) {
        return c.json({ ok: false, error: { code: 'award_failed', message: awarded.error ?? 'Could not award points' } }, 500)
      }
    }

    await supabase.from('tester_reputation_events').insert({
      tester_id: sub.tester_id,
      kind: repEvent.kind,
      delta_score: repEvent.delta,
      submission_id: sub.id,
      notes: `Reviewer action: ${action}`,
    })

    return c.json({ ok: true, data: { success: true, action, points_awarded: points } })
  }

  app.post('/v1/admin/tester-submissions/:id/accept',      jwtAuth, (c) => handleReview(c, 'accepted'))
  app.post('/v1/admin/tester-submissions/:id/informative', jwtAuth, (c) => handleReview(c, 'informative'))
  app.post('/v1/admin/tester-submissions/:id/duplicate',   jwtAuth, (c) => handleReview(c, 'duplicate'))
  app.post('/v1/admin/tester-submissions/:id/spam',        jwtAuth, (c) => handleReview(c, 'spam'))

  // ── Withheld redemptions admin endpoints (AntiGamingPage) ────────────────────
  // GET /v1/admin/tester-redemptions/withheld — list redemptions with status='withheld'
  app.get('/v1/admin/tester-redemptions/withheld', jwtAuth, requireSuperAdmin, async (c) => {
    const supabase = getServiceClient()
    const { data, count } = await supabase
      .from('tester_redemptions')
      .select(`
        id,
        tester_id,
        kind,
        points_spent,
        face_value_usd,
        requested_at,
        mushi_testers!tester_redemptions_tester_id_fkey ( public_handle )
      `, { count: 'exact' })
      .eq('status', 'withheld')
      .order('requested_at', { ascending: false })
      .limit(50)

    return c.json({ ok: true, data: { count: count ?? 0, items: data ?? [] } })
  })

  // POST /v1/admin/tester-redemptions/:id/approve — approve a withheld redemption
  app.post('/v1/admin/tester-redemptions/:id/approve', jwtAuth, requireSuperAdmin, async (c) => {
    const id = c.req.param('id')!
    const supabase = getServiceClient()

    const { data: redemption } = await supabase
      .from('tester_redemptions')
      .select('id, tester_id, kind, points_spent, face_value_usd, status')
      .eq('id', id)
      .eq('status', 'withheld')
      .single()

    if (!redemption) return c.json({ error: 'withheld_redemption_not_found' }, 404)

    await supabase
      .from('tester_redemptions')
      .update({ status: 'pending' })
      .eq('id', id)

    // If gift_card, make sure a tremendous_orders row exists (it may have been
    // created already but with status='withheld' — re-open it).
    if (redemption.kind === 'gift_card') {
      await supabase
        .from('tremendous_orders')
        .update({ status: 'pending', external_id: null })
        .eq('redemption_id', id)
    } else {
      // Non-gift-card (mushi_pro_credit, app_slot, api_quota): complete immediately.
      await supabase
        .from('tester_redemptions')
        .update({ status: 'complete', processed_at: new Date().toISOString() })
        .eq('id', id)
    }

    rlog.info('Withheld redemption approved by admin', { redemptionId: id })
    return c.json({ ok: true })
  })

  // POST /v1/admin/tester-redemptions/:id/deny — deny + refund a withheld redemption
  app.post('/v1/admin/tester-redemptions/:id/deny', jwtAuth, requireSuperAdmin, async (c) => {
    const id = c.req.param('id')!
    const supabase = getServiceClient()

    const { data: redemption } = await supabase
      .from('tester_redemptions')
      .select('id, tester_id, points_spent, status')
      .eq('id', id)
      .eq('status', 'withheld')
      .single()

    if (!redemption) return c.json({ error: 'withheld_redemption_not_found' }, 404)

    // Mark as failed.
    await supabase
      .from('tester_redemptions')
      .update({ status: 'failed', failure_reason: 'denied_by_reviewer' })
      .eq('id', id)

    // Refund the points.
    await supabase.rpc('award_tester_points', {
      p_tester_id: redemption.tester_id,
      p_delta_points: redemption.points_spent,
      p_reason: 'reversal',
      p_idempotency_key: `refund:withheld:${id}`,
    })

    rlog.info('Withheld redemption denied + refunded by admin', { redemptionId: id })
    return c.json({ ok: true })
  })

  // ── Tremendous webhook receiver ──────────────────────────────────────────────
  // Tremendous sends signed POST events when an order status changes.
  // HMAC-SHA256 signed with the secret stored in TREMENDOUS_WEBHOOK_SECRET.
  app.post('/v1/webhooks/tremendous', async (c) => {
    const supabase = getServiceClient()

    // Verify HMAC signature.
    const envVars = (c.get as (key: string) => unknown)('env') as Record<string, string> | undefined
    const secret = envVars?.TREMENDOUS_WEBHOOK_SECRET
      ?? Deno.env.get('TREMENDOUS_WEBHOOK_SECRET')
      ?? ''

    if (!secret) {
      rlog.warn('Tremendous webhook rejected — TREMENDOUS_WEBHOOK_SECRET not configured')
      return c.json({ error: 'webhook_not_configured' }, 503)
    }

    {
      const sig = c.req.header('Tremendous-Signature') ?? ''
      const body = await c.req.text()
      // Verify using Web Crypto HMAC.
      const encoder = new TextEncoder()
      const keyData = encoder.encode(secret)
      const msgData = encoder.encode(body)
      const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
      const sigBytes = Uint8Array.from(
        sig.replace('sha256=', '').match(/.{1,2}/g)?.map(b => parseInt(b, 16)) ?? [],
      )
      const valid = await crypto.subtle.verify('HMAC', key, sigBytes, msgData)
      if (!valid) {
        rlog.warn('Tremendous webhook signature mismatch')
        return c.json({ error: 'invalid_signature' }, 401)
      }

      // Re-parse body since we consumed it as text.
      let event: Record<string, unknown>
      try { event = JSON.parse(body) } catch { return c.json({ error: 'invalid_json' }, 400) }
      await handleTremendousEvent(supabase, event)
    }

    return c.json({ ok: true })
  })
}

// ─── Handle a Tremendous webhook event ───────────────────────────────────────

async function handleTremendousEvent(
  supabase: ReturnType<typeof getServiceClient>,
  event: Record<string, unknown>,
): Promise<void> {
  const eventType = event.event as string | undefined
  const order = event.order as Record<string, unknown> | undefined
  if (!order) return

  const externalId = order.id as string | undefined
  if (!externalId) return

  // Map Tremendous order statuses to our internal statuses.
  const statusMap: Record<string, string> = {
    EXECUTED: 'complete',
    DECLINED: 'failed',
    REFUNDED: 'reversed',
    CANCELED: 'failed',
  }

  const tremendousStatus = (order.status as string | undefined) ?? ''
  const internalStatus = statusMap[tremendousStatus] ?? 'processing'

  rlog.info('Tremendous webhook received', { eventType, externalId, tremendousStatus, internalStatus })

  const { data: ordRow } = await supabase
    .from('tremendous_orders')
    .select('id, redemption_id, tester_id')
    .eq('external_id', externalId)
    .single()

  if (!ordRow) {
    rlog.warn('Tremendous webhook: unknown external_id', { externalId })
    return
  }

  await supabase
    .from('tremendous_orders')
    .update({
      status: internalStatus,
      raw_payload: event,
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', ordRow.id)

  await supabase
    .from('tester_redemptions')
    .update({
      status: internalStatus,
      ...(internalStatus === 'complete' ? { processed_at: new Date().toISOString() } : {}),
      ...(internalStatus === 'failed' ? { failure_reason: `Tremendous status: ${tremendousStatus}` } : {}),
    })
    .eq('id', ordRow.redemption_id)

  // On failure, refund the tester's points.
  if (internalStatus === 'failed' || internalStatus === 'reversed') {
    const { data: redemption } = await supabase
      .from('tester_redemptions')
      .select('points_spent')
      .eq('id', ordRow.redemption_id)
      .single()

    if (redemption?.points_spent) {
      await supabase.rpc('award_tester_points', {
        p_tester_id: ordRow.tester_id,
        p_delta_points: redemption.points_spent,
        p_reason: 'reversal',
        p_idempotency_key: `refund:${ordRow.redemption_id}:${internalStatus}`,
      })
    }
  }
}
