// ============================================================
// rewards.ts — SDK activity ingest + reporter self-service +
// admin rewards-program management endpoints.
//
// SDK (public, apiKeyAuth):
//   POST /v1/sdk/activity          — batch activity ingest
//   GET  /v1/sdk/me/points         — reporter's point total
//   GET  /v1/sdk/me/tier           — reporter's current tier
//   GET  /v1/sdk/me/history        — points activity log
//   GET  /v1/sdk/me/export         — GDPR data export
//   DELETE /v1/sdk/me              — GDPR deletion
//   POST /v1/sdk/me/consent        — set/unset opt-in
//
// Admin (JWT, org-scoped):
//   GET  /v1/admin/rewards/rules          — list configured rules
//   PUT  /v1/admin/rewards/rules          — bulk upsert rules
//   GET  /v1/admin/rewards/tiers          — list tiers
//   PUT  /v1/admin/rewards/tiers          — bulk upsert tiers
//   GET  /v1/admin/rewards/leaderboard    — top contributors
//   GET  /v1/admin/rewards/contributors/:id — drill-down
//   GET  /v1/admin/rewards/webhooks       — list webhooks
//   POST /v1/admin/rewards/webhooks       — create webhook
//   DELETE /v1/admin/rewards/webhooks/:id — remove webhook
//   POST /v1/admin/rewards/webhooks/test  — test-fire webhook
//   GET  /v1/admin/rewards/overview       — KPI tile data
// ============================================================

import type { Hono } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { getServiceClient } from '../../_shared/db.ts'
import { apiKeyAuth, jwtAuth } from '../../_shared/auth.ts'
import { resolveEndUser } from '../../_shared/end-user-resolver.ts'
import { awardPointsForEndUser, invalidateRuleCache } from '../../_shared/reputation.ts'
import { dispatchRewardWebhook } from '../../_shared/reward-webhooks.ts'
import { verifyHostJwt } from '../../_shared/verify-host-jwt.ts'
import {
  stripeFromEnv,
  createConnectAccount,
  createConnectOnboardingLink,
  retrieveConnectAccount,
} from '../../_shared/stripe.ts'
import { evaluateQuestProgress } from '../../_shared/quest-tracker.ts'
import { log } from '../../_shared/logger.ts'

declare const Deno: { env: { get(name: string): string | undefined } }

const rlog = log.child('rewards-routes')

// ─── Zod schemas ─────────────────────────────────────────────

const activityEventSchema = z.object({
  action: z.string().min(1).max(64),
  metadata: z.record(z.unknown()).optional().default({}),
  /** ISO timestamp; defaults to server now() if omitted */
  occurred_at: z.string().optional(),
})

const activityBatchSchema = z.object({
  user_id: z.string().min(1).max(512),
  user_traits: z.object({
    email: z.string().email().optional(),
    name: z.string().max(120).optional(),
    provider: z.string().max(32).optional(),
  }).optional(),
  opted_in: z.boolean().optional(),
  reporter_token_hash: z.string().optional(),
  /** P2: host-app JWT for monetary verification. Optional — if present,
   *  server calls verifyHostJwt and updates end_users.jwt_verified_at. */
  host_jwt: z.string().optional(),
  events: z.array(activityEventSchema).min(1).max(100),
})

const rewardRuleUpsertSchema = z.object({
  action: z.string().min(1).max(64),
  base_points: z.number().int().min(-1000).max(10000),
  max_per_day: z.number().int().positive().nullable().default(null),
  max_per_user_lifetime: z.number().int().positive().nullable().default(null),
  multiplier_eligible: z.boolean().default(false),
  requires_jwt_verification: z.boolean().default(false),
  enabled: z.boolean().default(true),
  project_id: z.string().uuid().nullable().default(null),
})

const rewardTierUpsertSchema = z.object({
  slug: z.string().regex(/^[a-z0-9_]{1,32}$/),
  display_name: z.string().min(1).max(80),
  display_order: z.number().int().default(0),
  points_threshold: z.number().int().min(0),
  perks: z.record(z.unknown()).default({}),
  monetary_reward_usd: z.number().min(0).nullable().default(null),
  host_credit_payload: z.record(z.unknown()).nullable().default(null),
  enabled: z.boolean().default(true),
})

const webhookCreateSchema = z.object({
  url: z.string().url().refine((u) => u.startsWith('https://'), 'Must be HTTPS'),
  secret: z.string().min(16).max(256),
  events: z.array(z.string()).default(['reward.tier_changed']),
})

// ─── HMAC helper for webhook secrets ─────────────────────────
async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ─── Reporter HMAC auth helper (mirrors /v1/reporter pattern) ─
function resolveReporterToken(req: Request): string | null {
  const header = req.headers.get('x-reporter-token')
  if (header) return header
  const url = new URL(req.url)
  return url.searchParams.get('reporterToken')
}

// ─── Helper: get org_id for a project ────────────────────────
async function getOrgIdForProject(db: ReturnType<typeof getServiceClient>, projectId: string): Promise<string | null> {
  const { data } = await db
    .from('projects')
    .select('organization_id')
    .eq('id', projectId)
    .single()
  return data?.organization_id ?? null
}

// ─── Helper: resolve org_id from JWT user ────────────────────
// Takes the X-Mushi-Org-Id header (required for admin reward routes).
function getOrgIdFromContext(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-mushi-org-id') ?? c.req.header('X-Mushi-Org-Id') ?? null
}

// ─────────────────────────────────────────────────────────────
export function registerRewardsRoutes(app: Hono<any>): void {

  // ===========================================================
  // SDK: POST /v1/sdk/activity
  // Batch activity ingest from the host app SDK.
  // ===========================================================
  app.post('/v1/sdk/activity', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string
    let raw: unknown
    try { raw = await c.req.json() } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON', message: 'JSON body required' } }, 400)
    }

    const parsed = activityBatchSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({
        ok: false,
        error: {
          code: 'INVALID_ACTIVITY_BATCH',
          message: parsed.error.issues[0]?.message ?? 'validation failed',
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      }, 422)
    }

    const { user_id, user_traits, opted_in, reporter_token_hash, host_jwt, events } = parsed.data
    const db = getServiceClient()

    // Check rewards_enabled for this project
    const { data: ps } = await db
      .from('project_settings')
      .select('rewards_enabled')
      .eq('project_id', projectId)
      .single()

    if (!ps?.rewards_enabled) {
      // Silently accept but drop (keeps SDK from needing to know the project config)
      return c.json({ ok: true, data: { accepted: 0, total: events.length, reason: 'rewards_disabled' } })
    }

    // Resolve org
    const organizationId = await getOrgIdForProject(db, projectId)
    if (!organizationId) {
      return c.json({ ok: false, error: { code: 'PROJECT_NO_ORG', message: 'Project has no organization' } }, 422)
    }

    // Resolve / upsert end_user
    const endUser = await resolveEndUser(db, {
      organizationId,
      externalUserId: user_id,
      traits: user_traits,
      reporterTokenHash: reporter_token_hash,
      optedInToRewards: opted_in,
    })

    if (!endUser) {
      return c.json({ ok: false, error: { code: 'END_USER_RESOLVE_FAILED', message: 'Could not resolve end user' } }, 500)
    }

    // Drop if user has not opted in (GDPR compliance)
    if (!endUser.optedInToRewards) {
      return c.json({ ok: true, data: { accepted: 0, total: events.length, reason: 'not_opted_in' } })
    }

    // P2: attempt JWT verification if host_jwt is present
    if (host_jwt) {
      try {
        await verifyHostJwt({
          token: host_jwt,
          projectId,
          endUserId: endUser.id,
        })
      } catch (jwtErr) {
        // Non-fatal — activity is still accepted; jwt_verified_at remains null.
        // Monetary payouts require verified JWT but activity tracking does not.
        rlog.warn('host_jwt_verification_failed', { error: String(jwtErr), endUserId: endUser.id })
      }
    }

    // Award points for each event (in sequence to avoid race on velocity caps)
    let accepted = 0
    for (const event of events) {
      try {
        await awardPointsForEndUser(db, {
          projectId,
          organizationId,
          endUserId: endUser.id,
          action: event.action,
          metadata: event.metadata as Record<string, unknown>,
          reporterTokenHash: reporter_token_hash,
        })
        accepted++
      } catch (err) {
        rlog.warn('award_failed', { action: event.action, error: String(err) })
        continue
      }

      // P3: advance quest progress for this action (best-effort, non-blocking)
      evaluateQuestProgress({
        endUserId: endUser.id,
        organizationId,
        projectId,
        action: event.action,
        metadata: event.metadata as Record<string, unknown>,
        activityId: '',
      }).catch((err) => {
        rlog.warn('quest_eval_failed', { action: event.action, error: String(err) })
      })
    }

    return c.json({ ok: true, data: { accepted, total: events.length } }, 201)
  })

  // ===========================================================
  // SDK: POST /v1/sdk/me/consent
  // ===========================================================
  app.post('/v1/sdk/me/consent', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string
    let raw: unknown
    try { raw = await c.req.json() } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON' } }, 400)
    }
    const s = z.object({ user_id: z.string(), opted_in: z.boolean() }).safeParse(raw)
    if (!s.success) return c.json({ ok: false, error: { code: 'INVALID_BODY' } }, 422)

    const db = getServiceClient()
    const organizationId = await getOrgIdForProject(db, projectId)
    if (!organizationId) return c.json({ ok: false, error: { code: 'NO_ORG' } }, 422)

    const endUser = await resolveEndUser(db, {
      organizationId,
      externalUserId: s.data.user_id,
      optedInToRewards: s.data.opted_in,
    })

    return c.json({ ok: !!endUser, data: { opted_in: s.data.opted_in } })
  })

  // ===========================================================
  // SDK: GET /v1/sdk/me/points  (reporter token auth)
  // ===========================================================
  app.get('/v1/sdk/me/points', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string
    const userId = c.req.query('userId') ?? c.req.header('x-mushi-user-id')
    if (!userId) return c.json({ ok: false, error: { code: 'MISSING_USER_ID' } }, 400)

    const db = getServiceClient()
    const organizationId = await getOrgIdForProject(db, projectId)
    if (!organizationId) return c.json({ ok: false, error: { code: 'NO_ORG' } }, 422)

    const { data: eu } = await db
      .from('end_users')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('external_user_id', userId)
      .single()

    if (!eu) return c.json({ ok: true, data: { total_points: 0, points_30d: 0, points_lifetime: 0, tier: null, next_tier: null, report_submit_pts: 50 } })

    // Fetch point totals and all tiers in one pass so we can compute
    // current tier, next tier, and progress bar data in a single round-trip.
    const [ptsRes, tiersRes, ruleRes] = await Promise.all([
      db.from('end_user_points')
        .select('total_points, points_30d, points_lifetime')
        .eq('end_user_id', eu.id)
        .single(),
      db.from('reward_tiers')
        .select('slug, display_name, points_threshold, perks, multiplier')
        .eq('organization_id', organizationId)
        .order('points_threshold', { ascending: true }),
      db.from('reward_rules')
        .select('base_points')
        .eq('organization_id', organizationId)
        .eq('action', 'report_submit')
        .eq('enabled', true)
        .single(),
    ])

    const totalPoints = ptsRes.data?.total_points ?? 0
    const sortedTiers = tiersRes.data ?? []
    const currentTier = [...sortedTiers].reverse().find(t => t.points_threshold <= totalPoints) ?? null
    const nextTier = sortedTiers.find(t => t.points_threshold > totalPoints) ?? null
    const reportSubmitPts = ruleRes.data?.base_points ?? 50

    return c.json({
      ok: true,
      data: {
        total_points: totalPoints,
        points_30d: ptsRes.data?.points_30d ?? 0,
        points_lifetime: ptsRes.data?.points_lifetime ?? 0,
        tier: currentTier,
        next_tier: nextTier,
        report_submit_pts: reportSubmitPts,
      },
    })
  })

  // ===========================================================
  // SDK: GET /v1/sdk/me/tier
  // ===========================================================
  app.get('/v1/sdk/me/tier', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string
    const userId = c.req.query('userId') ?? c.req.header('x-mushi-user-id')
    if (!userId) return c.json({ ok: false, error: { code: 'MISSING_USER_ID' } }, 400)

    const db = getServiceClient()
    const organizationId = await getOrgIdForProject(db, projectId)
    if (!organizationId) return c.json({ ok: false, error: { code: 'NO_ORG' } }, 422)

    const { data: eu } = await db
      .from('end_users')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('external_user_id', userId)
      .single()

    if (!eu) return c.json({ ok: true, data: null })

    const { data: pts } = await db
      .from('end_user_points')
      .select('total_points, current_tier_id, reward_tiers(id, slug, display_name, points_threshold, perks)')
      .eq('end_user_id', eu.id)
      .single()

    return c.json({ ok: true, data: pts?.reward_tiers ?? null })
  })

  // ===========================================================
  // SDK: GET /v1/sdk/me/history
  // ===========================================================
  app.get('/v1/sdk/me/history', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string
    const userId = c.req.query('userId') ?? c.req.header('x-mushi-user-id')
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200)
    if (!userId) return c.json({ ok: false, error: { code: 'MISSING_USER_ID' } }, 400)

    const db = getServiceClient()
    const organizationId = await getOrgIdForProject(db, projectId)
    if (!organizationId) return c.json({ ok: false, error: { code: 'NO_ORG' } }, 422)

    const { data: eu } = await db
      .from('end_users')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('external_user_id', userId)
      .single()

    if (!eu) return c.json({ ok: true, data: { items: [], total: 0 } })

    const { data: rows, count } = await db
      .from('end_user_activity')
      .select('action, points_awarded, rejected_reason, metadata, created_at', { count: 'estimated' })
      .eq('end_user_id', eu.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    return c.json({ ok: true, data: { items: rows ?? [], total: count ?? 0 } })
  })

  // ===========================================================
  // SDK: GET /v1/sdk/me/export  (GDPR)
  // ===========================================================
  app.get('/v1/sdk/me/export', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string
    const userId = c.req.query('userId') ?? c.req.header('x-mushi-user-id')
    if (!userId) return c.json({ ok: false, error: { code: 'MISSING_USER_ID' } }, 400)

    const db = getServiceClient()
    const organizationId = await getOrgIdForProject(db, projectId)
    if (!organizationId) return c.json({ ok: false, error: { code: 'NO_ORG' } }, 422)

    const { data: eu } = await db
      .from('end_users')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('external_user_id', userId)
      .single()

    if (!eu) return c.json({ ok: true, data: null })

    const { data } = await db.rpc('export_end_user_data', { p_end_user_id: eu.id })
    return c.json({ ok: true, data })
  })

  // ===========================================================
  // SDK: DELETE /v1/sdk/me  (GDPR deletion)
  // ===========================================================
  app.delete('/v1/sdk/me', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string
    const userId = c.req.query('userId') ?? c.req.header('x-mushi-user-id')
    if (!userId) return c.json({ ok: false, error: { code: 'MISSING_USER_ID' } }, 400)

    const db = getServiceClient()
    const organizationId = await getOrgIdForProject(db, projectId)
    if (!organizationId) return c.json({ ok: false, error: { code: 'NO_ORG' } }, 422)

    const { error } = await db
      .from('end_users')
      .delete()
      .eq('organization_id', organizationId)
      .eq('external_user_id', userId)

    if (error) return c.json({ ok: false, error: { code: 'DELETE_FAILED', message: error.message } }, 500)
    return c.json({ ok: true, data: { deleted: true } })
  })

  // ===========================================================
  // P2 SDK: POST /v1/sdk/me/payout/onboard
  // Returns a Stripe Connect Express onboarding URL for the end user.
  // Requires JWT verification on the end user (jwt_verified_at must be set).
  // ===========================================================
  app.post('/v1/sdk/me/payout/onboard', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string
    const userId = c.req.query('userId') ?? c.req.header('x-mushi-user-id')
    if (!userId) return c.json({ ok: false, error: { code: 'MISSING_USER_ID' } }, 400)

    const db = getServiceClient()
    const organizationId = await getOrgIdForProject(db, projectId)
    if (!organizationId) return c.json({ ok: false, error: { code: 'NO_ORG' } }, 422)

    // Verify the org's plan allows monetary rewards (enterprise only)
    const { data: org } = await db
      .from('organizations')
      .select('id, billing_subscriptions(plan_id)')
      .eq('id', organizationId)
      .single() as { data: { id: string; billing_subscriptions: Array<{ plan_id: string }> } | null }

    const planId = org?.billing_subscriptions?.[0]?.plan_id ?? 'hobby'
    if (planId !== 'enterprise') {
      return c.json({
        ok: false,
        error: {
          code: 'PLAN_UPGRADE_REQUIRED',
          message: 'Monetary rewards via Stripe Connect require the Enterprise plan.',
        },
      }, 403)
    }

    // Check if JWT verified for this user
    const { data: eu } = await db
      .from('end_users')
      .select('id, jwt_verified_at, external_user_id')
      .eq('organization_id', organizationId)
      .eq('external_user_id', userId)
      .single()

    if (!eu) return c.json({ ok: false, error: { code: 'USER_NOT_FOUND' } }, 404)

    if (!eu.jwt_verified_at) {
      return c.json({
        ok: false,
        error: {
          code: 'JWT_VERIFICATION_REQUIRED',
          message: 'Identity must be verified before Stripe onboarding. Call verifyUserToken first.',
        },
      }, 403)
    }

    // Check if payout account already exists
    const { data: existingAccount } = await db
      .from('reward_payout_accounts')
      .select('stripe_connect_account_id, kyc_status, onboarding_url_expires_at')
      .eq('end_user_id', eu.id)
      .single()

    const cfg = stripeFromEnv()
    const returnUrl = Deno.env.get('APP_URL') ?? 'https://app.mushimushi.dev'

    let stripeAccountId: string
    let kycStatus: string

    if (existingAccount) {
      stripeAccountId = existingAccount.stripe_connect_account_id
      kycStatus = existingAccount.kyc_status

      // If already complete, return status without re-onboarding
      if (kycStatus === 'complete') {
        return c.json({ ok: true, data: { status: 'complete', message: 'KYC already complete. Payouts are enabled.' } })
      }
    } else {
      // Create a new Stripe Connect Express account
      const stripeAccount = await createConnectAccount(cfg, {
        endUserId: eu.id,
        metadata: { org_id: organizationId, project_id: projectId },
      })
      stripeAccountId = stripeAccount.id
      kycStatus = 'in_progress'

      await db.from('reward_payout_accounts').upsert({
        end_user_id: eu.id,
        stripe_connect_account_id: stripeAccountId,
        kyc_status: 'in_progress',
      })
    }

    // Generate a new onboarding link (short-lived, 5 min)
    const link = await createConnectOnboardingLink(cfg, {
      accountId: stripeAccountId,
      returnUrl: `${returnUrl}/rewards/payout/complete`,
      refreshUrl: `${returnUrl}/rewards/payout/onboard`,
    })

    await db.from('reward_payout_accounts')
      .update({ onboarding_url_expires_at: new Date(link.expires_at * 1000).toISOString() })
      .eq('end_user_id', eu.id)

    return c.json({
      ok: true,
      data: {
        onboarding_url: link.url,
        expires_at: new Date(link.expires_at * 1000).toISOString(),
        kyc_status: kycStatus,
      },
    })
  })

  // ===========================================================
  // P2 SDK: GET /v1/sdk/me/payout/status
  // Returns payout account KYC status and recent payouts.
  // ===========================================================
  app.get('/v1/sdk/me/payout/status', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string
    const userId = c.req.query('userId') ?? c.req.header('x-mushi-user-id')
    if (!userId) return c.json({ ok: false, error: { code: 'MISSING_USER_ID' } }, 400)

    const db = getServiceClient()
    const organizationId = await getOrgIdForProject(db, projectId)
    if (!organizationId) return c.json({ ok: false, error: { code: 'NO_ORG' } }, 422)

    const { data: eu } = await db
      .from('end_users')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('external_user_id', userId)
      .single()

    if (!eu) return c.json({ ok: true, data: { kyc_status: 'not_started', payouts: [] } })

    const [accountRes, payoutsRes] = await Promise.all([
      db.from('reward_payout_accounts')
        .select('kyc_status, kyc_completed_at')
        .eq('end_user_id', eu.id)
        .single(),
      db.from('reward_payouts')
        .select('id, amount_usd, currency, status, tier_slug, requested_at, paid_at')
        .eq('end_user_id', eu.id)
        .order('requested_at', { ascending: false })
        .limit(10),
    ])

    return c.json({
      ok: true,
      data: {
        kyc_status: accountRes.data?.kyc_status ?? 'not_started',
        kyc_completed_at: accountRes.data?.kyc_completed_at ?? null,
        payouts: payoutsRes.data ?? [],
      },
    })
  })

  // ===========================================================
  // ADMIN: GET /v1/admin/rewards/stats
  // Workspace health summary for the rewards program banner + KPI strip.
  // ===========================================================
  app.get('/v1/admin/rewards/stats', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    const projectIdHint =
      c.req.header('x-mushi-project-id') ?? c.req.header('X-Mushi-Project-Id') ?? null

    const empty = {
      organizationId: null as string | null,
      organizationName: null as string | null,
      projectId: null as string | null,
      projectName: null as string | null,
      projectRewardsEnabled: false,
      enabledRulesCount: 0,
      enabledTiersCount: 0,
      activeContributors30d: 0,
      pointsAwarded30d: 0,
      pendingPayoutLiabilityUsd: 0,
      activity24hTotal: 0,
      activity24hRejected: 0,
      rejectionRatePct24h: 0,
      webhooksConfigured: 0,
      webhooksFailing: 0,
      identityProvidersConfigured: 0,
      enabledQuestsCount: 0,
      openDisputesCount: 0,
      lastActivityAt: null as string | null,
      topPriority: 'no_org' as
        | 'no_org'
        | 'project_disabled'
        | 'webhooks_failing'
        | 'open_disputes'
        | 'no_rules'
        | 'high_rejection'
        | 'no_contributors'
        | 'healthy',
      topPriorityLabel: null as string | null,
      topPriorityTo: null as string | null,
    }

    if (!orgId) return c.json({ ok: true, data: empty })

    const db = getServiceClient()
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const [
      { data: orgRow },
      { count: rulesCount },
      { count: tiersCount },
      { data: agg30d },
      { data: agg24h },
      { data: webhooks },
      { data: projects },
      payoutLiabilityRes,
      { count: questsCount },
      { count: openDisputesCount },
      { data: lastActivityRow },
    ] = await Promise.all([
      db.from('organizations').select('id, name').eq('id', orgId).maybeSingle(),
      db
        .from('reward_rules')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('enabled', true),
      db
        .from('reward_tiers')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('enabled', true),
      db
        .from('end_user_activity')
        .select('end_user_id, points_awarded')
        .eq('organization_id', orgId)
        .gte('created_at', since30d)
        .limit(10000),
      db
        .from('end_user_activity')
        .select('rejected_reason')
        .eq('organization_id', orgId)
        .gte('created_at', since24h),
      db
        .from('reward_webhooks')
        .select('enabled, last_status')
        .eq('organization_id', orgId),
      db.from('projects').select('id, name').eq('organization_id', orgId),
      db
        .from('reward_payouts')
        .select('status, amount_usd.sum()')
        .eq('organization_id', orgId)
        .in('status', ['pending', 'processing'])
        .single(),
      db
        .from('reward_quests')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('enabled', true),
      db
        .from('reward_disputes')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('status', 'open'),
      db
        .from('end_user_activity')
        .select('created_at')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const distinctUsers = new Set<string>()
    let totalPts = 0
    for (const row of (agg30d ?? []) as Array<{ end_user_id: string; points_awarded: number | null }>) {
      if (row.end_user_id) distinctUsers.add(row.end_user_id)
      totalPts += row.points_awarded ?? 0
    }

    const rows24h = (agg24h ?? []) as Array<{ rejected_reason: string | null }>
    const activity24hTotal = rows24h.length
    const activity24hRejected = rows24h.filter((r) => r.rejected_reason).length
    const rejectionRatePct24h =
      activity24hTotal > 0 ? Math.round((activity24hRejected / activity24hTotal) * 100) : 0

    const webhookRows = (webhooks ?? []) as Array<{ enabled: boolean; last_status: number | null }>
    const webhooksConfigured = webhookRows.filter((w) => w.enabled).length
    const webhooksFailing = webhookRows.filter(
      (w) => w.enabled && w.last_status != null && w.last_status >= 400,
    ).length

    const projectRows = (projects ?? []) as Array<{ id: string; name: string }>
    const projectIds = projectRows.map((p) => p.id)
    let identityProvidersConfigured = 0
    if (projectIds.length > 0) {
      const { count } = await db
        .from('host_auth_providers')
        .select('id', { count: 'exact', head: true })
        .in('project_id', projectIds)
        .eq('enabled', true)
      identityProvidersConfigured = count ?? 0
    }

    const activeProject =
      projectIdHint && projectRows.some((p) => p.id === projectIdHint)
        ? projectRows.find((p) => p.id === projectIdHint)!
        : projectRows[0] ?? null

    let projectRewardsEnabled = false
    if (activeProject) {
      const { data: ps } = await db
        .from('project_settings')
        .select('rewards_enabled')
        .eq('project_id', activeProject.id)
        .maybeSingle()
      projectRewardsEnabled = Boolean((ps as { rewards_enabled?: boolean } | null)?.rewards_enabled)
    }

    const enabledRulesCount = rulesCount ?? 0
    const enabledTiersCount = tiersCount ?? 0
    const activeContributors30d = distinctUsers.size
    const pointsAwarded30d = totalPts
    const enabledQuestsCount = questsCount ?? 0
    const openDisputes = openDisputesCount ?? 0
    const lastActivityAt =
      (lastActivityRow as { created_at?: string } | null)?.created_at ?? null
    const projectName = activeProject?.name ?? null

    let topPriority = empty.topPriority
    let topPriorityLabel: string | null = null
    let topPriorityTo: string | null = null

    if (!projectRewardsEnabled) {
      topPriority = 'project_disabled'
      topPriorityLabel = `rewards_enabled is off for ${projectName ?? 'active project'} — SDK activity ingest returns early without awarding points.`
      topPriorityTo = '/settings?tab=dev'
    } else if (webhooksFailing > 0) {
      topPriority = 'webhooks_failing'
      topPriorityLabel = `${webhooksFailing} webhook${webhooksFailing === 1 ? '' : 's'} returned HTTP ≥400 on last delivery — tier-change events may not reach your host app.`
      topPriorityTo = '/rewards?tab=settings'
    } else if (openDisputes > 0) {
      topPriority = 'open_disputes'
      topPriorityLabel = `${openDisputes} open dispute${openDisputes === 1 ? '' : 's'} — review flagged rewards before the next payout run.`
      topPriorityTo = '/rewards?tab=settings'
    } else if (enabledRulesCount === 0) {
      topPriority = 'no_rules'
      topPriorityLabel = 'No activity rules enabled — SDK events will not award points until at least one rule is on.'
      topPriorityTo = '/rewards?tab=rules'
    } else if (rejectionRatePct24h >= 40 && activity24hTotal >= 5) {
      topPriority = 'high_rejection'
      topPriorityLabel = `${rejectionRatePct24h}% of ${activity24hTotal} SDK events rejected in 24h — check caps, fraud flags, or unknown actions on Overview.`
      topPriorityTo = '/rewards?tab=overview'
    } else if (activeContributors30d === 0) {
      topPriority = 'no_contributors'
      topPriorityLabel = `${enabledRulesCount} rules · ${enabledTiersCount} tiers configured — wire SDK identify() + activity() in ${projectName ?? 'your app'}.`
      topPriorityTo = '/rewards?tab=sandbox'
    } else {
      topPriority = 'healthy'
      topPriorityLabel = `${activeContributors30d} contributors (30d) · ${pointsAwarded30d.toLocaleString()} pts · ${enabledQuestsCount} active quest${enabledQuestsCount === 1 ? '' : 's'}.`
      topPriorityTo = '/rewards?tab=contributors'
    }

    return c.json({
      ok: true,
      data: {
        organizationId: orgId,
        organizationName: (orgRow as { name?: string } | null)?.name ?? null,
        projectId: activeProject?.id ?? null,
        projectName,
        projectRewardsEnabled,
        enabledRulesCount,
        enabledTiersCount,
        activeContributors30d,
        pointsAwarded30d,
        pendingPayoutLiabilityUsd:
          (payoutLiabilityRes.data as Record<string, number> | null)?.sum ?? 0,
        activity24hTotal,
        activity24hRejected,
        rejectionRatePct24h,
        webhooksConfigured,
        webhooksFailing,
        identityProvidersConfigured,
        enabledQuestsCount,
        openDisputesCount: openDisputes,
        lastActivityAt,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    })
  })

  // ===========================================================
  // ADMIN: GET /v1/admin/rewards/overview
  // ===========================================================
  app.get('/v1/admin/rewards/overview', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    const db = getServiceClient()
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    // Use raw SQL for the two aggregations that Supabase's query builder
    // handles poorly: COUNT(DISTINCT) and conditional SUM.
    const [rawAgg, tierRes, payoutLiabilityRes] = await Promise.all([
      db.rpc('exec_sql_overview' as never, {} as never).single().then(() => null).catch(() => null),
      db.from('end_user_points')
        .select('current_tier_id, reward_tiers(slug, display_name)')
        .eq('organization_id', orgId)
        .not('current_tier_id', 'is', null)
        .limit(500),
      db.from('reward_payouts')
        .select('status, amount_usd.sum()')
        .eq('organization_id', orgId)
        .in('status', ['pending', 'processing'])
        .single(),
    ])

    // Aggregate active contributors and points from end_user_activity manually
    const { data: aggData } = await db
      .from('end_user_activity')
      .select('end_user_id, points_awarded')
      .eq('organization_id', orgId)
      .gte('created_at', since30d)
      .limit(10000)

    const distinctUsers = new Set<string>()
    let totalPts = 0
    for (const row of (aggData ?? []) as Array<{ end_user_id: string; points_awarded: number | null }>) {
      if (row.end_user_id) distinctUsers.add(row.end_user_id)
      totalPts += row.points_awarded ?? 0
    }

    // Count tier holders
    const tierCounts: Record<string, number> = {}
    for (const row of (tierRes.data ?? []) as Array<{ reward_tiers: { slug: string; display_name: string } }>) {
      const slug = row.reward_tiers?.slug ?? 'unknown'
      tierCounts[slug] = (tierCounts[slug] ?? 0) + 1
    }

    return c.json({
      ok: true,
      data: {
        active_contributors_30d: distinctUsers.size,
        points_awarded_30d: totalPts,
        tier_distribution: tierCounts,
        pending_payout_liability_usd: (payoutLiabilityRes.data as Record<string, number> | null)?.sum ?? 0,
      },
    })
  })

  // ===========================================================
  // ADMIN: GET/PUT /v1/admin/rewards/rules
  // ===========================================================
  app.get('/v1/admin/rewards/rules', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    // Prefer explicit ?projectId query param, then X-Mushi-Project-Id header
    const projectId = c.req.query('projectId')
      ?? c.req.header('x-mushi-project-id')
      ?? c.req.header('X-Mushi-Project-Id')
      ?? null

    const db = getServiceClient()

    if (projectId) {
      const { data: projRules, error: e1 } = await db
        .from('reward_rules')
        .select('*')
        .eq('organization_id', orgId)
        .eq('project_id', projectId)
        .eq('enabled', true)
        .order('action', { ascending: true })

      if (e1) return c.json({ ok: false, error: { code: 'DB_ERROR', message: e1.message } }, 500)
      if ((projRules?.length ?? 0) > 0) return c.json({ ok: true, data: projRules ?? [] })
    }

    // Fall back to org-level rules (project_id IS NULL)
    const { data, error } = await db
      .from('reward_rules')
      .select('*')
      .eq('organization_id', orgId)
      .is('project_id', null)
      .eq('enabled', true)
      .order('action', { ascending: true })

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data: data ?? [] })
  })

  app.put('/v1/admin/rewards/rules', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    let raw: unknown
    try { raw = await c.req.json() } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON' } }, 400)
    }

    const parsed = z.array(rewardRuleUpsertSchema).safeParse(raw)
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'INVALID_RULES', issues: parsed.error.issues } }, 422)
    }

    const db = getServiceClient()
    const rows = parsed.data.map((r) => ({ ...r, organization_id: orgId }))

    const { data, error } = await db
      .from('reward_rules')
      .upsert(rows, { onConflict: 'organization_id,project_id,action', ignoreDuplicates: false })
      .select('*')

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

    // Invalidate rule cache for all affected projects
    for (const r of rows) {
      if (r.project_id) invalidateRuleCache(r.project_id)
    }

    return c.json({ ok: true, data: data ?? [] })
  })

  // ===========================================================
  // ADMIN: GET/PUT /v1/admin/rewards/tiers
  // ===========================================================
  app.get('/v1/admin/rewards/tiers', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    const db = getServiceClient()
    const { data, error } = await db
      .from('reward_tiers')
      .select('*')
      .eq('organization_id', orgId)
      .order('display_order', { ascending: true })

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data: data ?? [] })
  })

  app.put('/v1/admin/rewards/tiers', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    let raw: unknown
    try { raw = await c.req.json() } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON' } }, 400)
    }

    const parsed = z.array(rewardTierUpsertSchema).safeParse(raw)
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'INVALID_TIERS', issues: parsed.error.issues } }, 422)
    }

    const db = getServiceClient()
    const rows = parsed.data.map((t) => ({ ...t, organization_id: orgId }))

    const { data, error } = await db
      .from('reward_tiers')
      .upsert(rows, { onConflict: 'organization_id,slug', ignoreDuplicates: false })
      .select('*')

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data: data ?? [] })
  })

  // ===========================================================
  // SDK: GET /v1/sdk/hall-of-fame
  // Public (apiKeyAuth) leaderboard for the project — safe subset of data
  // with no PII. Powers the Hall of Fame OG image on the host app.
  // ===========================================================
  app.get('/v1/sdk/hall-of-fame', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string | undefined
    if (!projectId) return c.json({ ok: false, error: { code: 'MISSING_PROJECT_ID' } }, 400)

    const limit = Math.min(parseInt(c.req.query('limit') ?? '10', 10), 50)
    const db = getServiceClient()

    // Resolve org from project
    const { data: project } = await db.from('projects').select('organization_id, name').eq('id', projectId).single()
    if (!project) return c.json({ ok: false, error: { code: 'PROJECT_NOT_FOUND' } }, 404)

    const { data, error } = await db
      .from('end_user_points')
      .select(`
        end_user_id, points_30d, total_points, points_lifetime,
        end_users!inner(display_name, email_hash, last_seen_at, anti_fraud_flags),
        reward_tiers(slug, display_name)
      `)
      .eq('organization_id', project.organization_id)
      .order('total_points', { ascending: false })
      .limit(limit)

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

    // Strip any flagged users from the public hall of fame
    const clean = (data ?? [])
      .filter((r) => {
        const eu = r.end_users as unknown as { anti_fraud_flags: string[] }
        return !(eu?.anti_fraud_flags?.length > 0)
      })
      .map((r) => {
        const eu = r.end_users as unknown as { display_name: string | null; email_hash: string | null; last_seen_at: string | null }
        const tier = r.reward_tiers as unknown as { slug: string; display_name: string } | null
        return {
          display_name: eu?.display_name ?? 'Anonymous',
          email_hash: eu?.email_hash ?? null,
          tier_slug: tier?.slug ?? null,
          tier_name: tier?.display_name ?? null,
          points_30d: r.points_30d,
          total_points: r.total_points,
        }
      })

    return c.json({ ok: true, data: clean, meta: { project_name: project.name } })
  })

  // ===========================================================
  // ADMIN: GET /v1/admin/rewards/activity   (debug feed)
  // Returns the last 50 activity events for the org with basic
  // stats (total today, rejection rate, top actions) so operators
  // can debug point attribution without digging into individual
  // contributor drawers.
  // ===========================================================
  app.get('/v1/admin/rewards/activity', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    const db = getServiceClient()
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const [recentRes, statsRes] = await Promise.all([
      // Last 50 events with user display name
      db.from('end_user_activity')
        .select(`
          id,
          action,
          points_awarded,
          rejected_reason,
          metadata,
          created_at,
          end_users(external_user_id, display_name)
        `)
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(50),
      // 24h aggregates
      db.from('end_user_activity')
        .select('action, points_awarded, rejected_reason')
        .eq('organization_id', orgId)
        .gte('created_at', since24h),
    ])

    const statsRows = statsRes.data ?? []
    const totalToday = statsRows.length
    const rejectedToday = statsRows.filter((r) => r.rejected_reason).length
    const acceptedToday = totalToday - rejectedToday
    const pointsToday = statsRows.reduce((s, r) => s + (r.points_awarded ?? 0), 0)

    const actionCounts: Record<string, number> = {}
    for (const r of statsRows) {
      if (!r.rejected_reason) actionCounts[r.action] = (actionCounts[r.action] ?? 0) + 1
    }
    const topActions = Object.entries(actionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([action, count]) => ({ action, count }))

    return c.json({
      ok: true,
      data: {
        events: recentRes.data ?? [],
        stats_24h: {
          total: totalToday,
          accepted: acceptedToday,
          rejected: rejectedToday,
          points_awarded: pointsToday,
          rejection_rate_pct: totalToday > 0 ? Math.round((rejectedToday / totalToday) * 100) : 0,
          top_actions: topActions,
        },
      },
    })
  })

  // ===========================================================
  // ADMIN: GET /v1/admin/rewards/leaderboard
  // ===========================================================
  app.get('/v1/admin/rewards/leaderboard', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    const range = c.req.query('range') === 'all' ? 'all' : '30d'
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200)
    const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10), 0)
    const search = (c.req.query('search') ?? '').trim().toLowerCase()
    const tierSlug = c.req.query('tier') ?? ''
    const db = getServiceClient()

    const orderCol = range === '30d' ? 'points_30d' : 'total_points'

    // Build base query with optional tier filter
    let query = db
      .from('end_user_points')
      .select(`
        end_user_id, total_points, points_30d, points_lifetime, current_tier_id,
        end_users!inner(id, external_user_id, display_name, anti_fraud_flags, last_seen_at, first_seen_at),
        reward_tiers(slug, display_name)
      `, { count: 'exact' })
      .eq('organization_id', orgId)
      .order(orderCol, { ascending: false })

    // Tier filter
    if (tierSlug) {
      const { data: tierRow } = await db
        .from('reward_tiers')
        .select('id')
        .eq('organization_id', orgId)
        .eq('slug', tierSlug)
        .single()
      if (tierRow) {
        query = query.eq('current_tier_id', tierRow.id)
      } else if (tierSlug === 'none') {
        query = query.is('current_tier_id', null)
      }
    }

    // Server-side search on display_name / external_user_id via ilike
    if (search) {
      query = (query as typeof query).or(
        `display_name.ilike.%${search}%,external_user_id.ilike.%${search}%`,
        { referencedTable: 'end_users' },
      )
    }

    const { data, error, count } = await query
      .range(offset, offset + limit - 1)

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({
      ok: true,
      data: { data: data ?? [], meta: { range, limit, offset, total: count ?? 0 } },
    })
  })

  // ===========================================================
  // ADMIN: GET /v1/admin/rewards/contributors/:id
  // ===========================================================
  app.get('/v1/admin/rewards/contributors/:id', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    const endUserId = c.req.param('id')
    const db = getServiceClient()

    const [euRes, ptsRes, actRes] = await Promise.all([
      db.from('end_users').select('*').eq('id', endUserId).eq('organization_id', orgId).single(),
      db.from('end_user_points').select('*, reward_tiers(*)').eq('end_user_id', endUserId).single(),
      db.from('end_user_activity')
        .select('action, points_awarded, rejected_reason, metadata, created_at')
        .eq('end_user_id', endUserId)
        .order('created_at', { ascending: false })
        .limit(100),
    ])

    if (!euRes.data) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)

    return c.json({
      ok: true,
      data: {
        profile: euRes.data,
        points: ptsRes.data,
        activity: actRes.data ?? [],
      },
    })
  })

  // ===========================================================
  // ADMIN: GET /v1/admin/rewards/webhooks
  // ===========================================================
  app.get('/v1/admin/rewards/webhooks', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    const db = getServiceClient()
    const { data, error } = await db
      .from('reward_webhooks')
      .select('id, url, events, enabled, last_delivered_at, last_status, created_at')
      .eq('organization_id', orgId)

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data: data ?? [] })
  })

  // ===========================================================
  // ADMIN: POST /v1/admin/rewards/webhooks
  // ===========================================================
  app.post('/v1/admin/rewards/webhooks', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    let raw: unknown
    try { raw = await c.req.json() } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON' } }, 400)
    }
    const parsed = webhookCreateSchema.safeParse(raw)
    if (!parsed.success) return c.json({ ok: false, error: { code: 'INVALID_WEBHOOK' } }, 422)

    const db = getServiceClient()
    const secretHash = await sha256Hex(parsed.data.secret)
    const webhookId = crypto.randomUUID()

    // Store secret in env (Deno.env can't be mutated at runtime; so we store
    // a hint for the operator and record the hash for signature verification).
    // The actual raw secret must be set via MUSHI_REWARD_WEBHOOK_SECRET_<id> env var.
    rlog.info('webhook_created', { webhookId, orgId, urlPrefix: parsed.data.url.slice(0, 32) })

    const { data, error } = await db
      .from('reward_webhooks')
      .insert({
        id: webhookId,
        organization_id: orgId,
        url: parsed.data.url,
        secret_hash: secretHash,
        events: parsed.data.events,
      })
      .select('id, url, events, enabled, created_at')
      .single()

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({
      ok: true,
      data,
      meta: {
        secret_env_var: `MUSHI_REWARD_WEBHOOK_SECRET_${webhookId.replace(/-/g, '').toUpperCase()}`,
        message: 'Set the secret via Supabase project env vars to enable HMAC signature verification.',
      },
    }, 201)
  })

  // ===========================================================
  // ADMIN: DELETE /v1/admin/rewards/webhooks/:id
  // ===========================================================
  app.delete('/v1/admin/rewards/webhooks/:id', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    const id = c.req.param('id')
    const db = getServiceClient()

    const { error } = await db
      .from('reward_webhooks')
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId)

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data: { deleted: true } })
  })

  // ===========================================================
  // ADMIN: POST /v1/admin/rewards/webhooks/test
  // ===========================================================
  app.post('/v1/admin/rewards/webhooks/test', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    const db = getServiceClient()
    await dispatchRewardWebhook(db, orgId, {
      event: 'reward.tier_changed',
      end_user_id: 'test-user',
      tier_before: null,
      tier_after: { slug: 'contributor', display_name: 'Contributor', perks: {} },
      host_credit_payload: null,
      occurred_at: new Date().toISOString(),
    })

    return c.json({ ok: true, data: { message: 'Test webhook delivered (see last_status on each row for result)' } })
  })

  // ===========================================================
  // P3 ADMIN: GET /v1/admin/rewards/quests
  // List quests for the org.
  // ===========================================================
  app.get('/v1/admin/rewards/quests', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    const db = getServiceClient()
    const { data, error } = await db
      .from('reward_quests')
      .select('id, name, description, steps, completion_points, expires_after_days, enabled, repeatable, project_id, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data: data ?? [] })
  })

  // ===========================================================
  // P3 ADMIN: POST /v1/admin/rewards/quests
  // Create or update a quest.
  // ===========================================================
  const questUpsertSchema = z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(120),
    description: z.string().optional().nullable(),
    steps: z.array(z.object({
      action: z.string().min(1).max(64),
      label: z.string().min(1).max(120),
      metadata_match: z.record(z.unknown()).optional().nullable(),
    })).min(1).max(20),
    completion_points: z.number().int().min(0).default(0),
    expires_after_days: z.number().int().positive().nullable().default(null),
    enabled: z.boolean().default(true),
    repeatable: z.boolean().default(false),
    project_id: z.string().uuid().nullable().default(null),
  })

  app.post('/v1/admin/rewards/quests', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    let raw: unknown
    try { raw = await c.req.json() } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON' } }, 400)
    }
    const parsed = questUpsertSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'INVALID_QUEST', issues: parsed.error.issues } }, 422)
    }

    const db = getServiceClient()
    const questData = {
      organization_id: orgId,
      ...parsed.data,
    }

    let result
    if (parsed.data.id) {
      // Update — verify ownership
      const { data: existing } = await db.from('reward_quests').select('id').eq('id', parsed.data.id).eq('organization_id', orgId).single()
      if (!existing) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)

      const { data, error } = await db.from('reward_quests').update({ ...questData, updated_at: new Date().toISOString() }).eq('id', parsed.data.id).select('*').single()
      if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
      result = data
    } else {
      const { data, error } = await db.from('reward_quests').insert(questData).select('*').single()
      if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
      result = data
    }

    return c.json({ ok: true, data: result }, 201)
  })

  // ===========================================================
  // P3 ADMIN: DELETE /v1/admin/rewards/quests/:id
  // ===========================================================
  app.delete('/v1/admin/rewards/quests/:id', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    const id = c.req.param('id')
    const db = getServiceClient()

    const { error } = await db.from('reward_quests').delete().eq('id', id).eq('organization_id', orgId)
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data: { deleted: true } })
  })

  // ===========================================================
  // P2 ADMIN: GET /v1/admin/rewards/payouts
  // Payout ledger for the org — admin liability dashboard.
  // ===========================================================
  app.get('/v1/admin/rewards/payouts', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    const db = getServiceClient()
    const { data, error } = await db
      .from('reward_payouts')
      .select('id, amount_usd, currency, status, tier_slug, requested_at, paid_at, end_user_id, stripe_transfer_id, withheld_reason')
      .eq('organization_id', orgId)
      .order('requested_at', { ascending: false })
      .limit(100)

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data: data ?? [] })
  })

  // ===========================================================
  // P2 ADMIN: GET /v1/admin/rewards/identity-providers
  // List JWKS providers configured for this org's projects.
  // ===========================================================
  app.get('/v1/admin/rewards/identity-providers', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    const db = getServiceClient()
    // Fetch projects for this org, then join host_auth_providers
    const { data: projects } = await db
      .from('projects')
      .select('id')
      .eq('organization_id', orgId)

    const projectIds = (projects ?? []).map((p: { id: string }) => p.id)
    if (projectIds.length === 0) return c.json({ ok: true, data: [] })

    const { data, error } = await db
      .from('host_auth_providers')
      .select('id, project_id, provider, jwks_url, audience, issuer, enabled, created_at, updated_at')
      .in('project_id', projectIds)
      .order('created_at', { ascending: true })

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data: data ?? [] })
  })

  // ===========================================================
  // P2 ADMIN: POST /v1/admin/rewards/identity-providers
  // Add a new JWKS provider for a project.
  // ===========================================================
  const identityProviderCreateSchema = z.object({
    project_id: z.string().uuid(),
    provider: z.enum(['apple', 'google', 'supabase', 'custom']),
    jwks_url: z.string().url().refine((u) => u.startsWith('https://'), 'JWKS URL must be HTTPS'),
    audience: z.string().max(256).optional().nullable(),
    issuer: z.string().max(256).optional().nullable(),
    enabled: z.boolean().default(true),
  })

  app.post('/v1/admin/rewards/identity-providers', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    let raw: unknown
    try { raw = await c.req.json() } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON' } }, 400)
    }
    const parsed = identityProviderCreateSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'INVALID_PROVIDER', issues: parsed.error.issues } }, 422)
    }

    const db = getServiceClient()

    // Verify the project belongs to this org
    const { data: proj } = await db
      .from('projects')
      .select('id')
      .eq('id', parsed.data.project_id)
      .eq('organization_id', orgId)
      .single()

    if (!proj) return c.json({ ok: false, error: { code: 'PROJECT_NOT_FOUND' } }, 404)

    const { data, error } = await db
      .from('host_auth_providers')
      .upsert({
        project_id: parsed.data.project_id,
        provider: parsed.data.provider,
        jwks_url: parsed.data.jwks_url,
        audience: parsed.data.audience ?? null,
        issuer: parsed.data.issuer ?? null,
        enabled: parsed.data.enabled,
      }, { onConflict: 'project_id,provider' })
      .select('id, project_id, provider, jwks_url, audience, issuer, enabled, created_at, updated_at')
      .single()

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data }, 201)
  })

  // ===========================================================
  // P2 ADMIN: PATCH /v1/admin/rewards/identity-providers/:id
  // Toggle enabled or update fields.
  // ===========================================================
  app.patch('/v1/admin/rewards/identity-providers/:id', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    const id = c.req.param('id')
    let raw: unknown
    try { raw = await c.req.json() } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON' } }, 400)
    }

    const patchSchema = z.object({
      jwks_url: z.string().url().optional(),
      audience: z.string().max(256).nullable().optional(),
      issuer: z.string().max(256).nullable().optional(),
      enabled: z.boolean().optional(),
    })
    const parsed = patchSchema.safeParse(raw)
    if (!parsed.success) return c.json({ ok: false, error: { code: 'INVALID_PATCH' } }, 422)

    const db = getServiceClient()

    // Verify ownership via projects join
    const { data: existing } = await db
      .from('host_auth_providers')
      .select('id, project_id')
      .eq('id', id)
      .single()

    if (!existing) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)

    const { data: proj } = await db
      .from('projects')
      .select('id')
      .eq('id', existing.project_id)
      .eq('organization_id', orgId)
      .single()

    if (!proj) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)

    const { data, error } = await db
      .from('host_auth_providers')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, project_id, provider, jwks_url, audience, issuer, enabled, created_at, updated_at')
      .single()

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data })
  })

  // ===========================================================
  // P3 MCP: POST /v1/admin/rewards/bonus-points
  // Award ad-hoc bonus points to a contributor (MCP write surface).
  // ===========================================================
  app.post('/v1/admin/rewards/bonus-points', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    let raw: unknown
    try { raw = await c.req.json() } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON' } }, 400)
    }
    const schema = z.object({
      // Accept either the internal UUID or the external string ID
      end_user_id: z.string().uuid().optional(),
      external_user_id: z.string().min(1).optional(),
      points: z.number().int().min(1).max(50000),
      reason: z.string().max(200),
    }).refine((d) => d.end_user_id || d.external_user_id, {
      message: 'Provide either end_user_id or external_user_id',
    })
    const parsed = schema.safeParse(raw)
    if (!parsed.success) return c.json({ ok: false, error: { code: 'INVALID_BODY' } }, 422)

    const db = getServiceClient()
    let endUser: { id: string; project_id: string | null } | null = null

    if (parsed.data.end_user_id) {
      const { data } = await db.from('end_users').select('id, project_id')
        .eq('id', parsed.data.end_user_id).eq('organization_id', orgId).single()
      endUser = data
    } else {
      const { data } = await db.from('end_users').select('id, project_id')
        .eq('organization_id', orgId).eq('external_user_id', parsed.data.external_user_id!).single()
      endUser = data
    }
    if (!endUser) return c.json({ ok: false, error: { code: 'USER_NOT_FOUND' } }, 404)

    // bonus_manual bypasses DB rules — insert directly with the caller-supplied points
    const activityInsert = await db.from('end_user_activity').insert({
      end_user_id: endUser.id,
      organization_id: orgId,
      project_id: endUser.project_id ?? null,
      action: 'bonus_manual',
      metadata: { reason: parsed.data.reason, awarded_via: 'admin_console' },
      points_awarded: parsed.data.points,
    })
    if (activityInsert.error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: activityInsert.error.message } }, 500)

    // Update the denormalized totals
    const { data: pts } = await db.from('end_user_points').select('total_points, points_30d, points_lifetime').eq('end_user_id', endUser.id).single()
    const newTotal = (pts?.total_points ?? 0) + parsed.data.points
    await db.from('end_user_points').upsert({
      end_user_id: endUser.id,
      organization_id: orgId,
      total_points: newTotal,
      points_30d: (pts?.points_30d ?? 0) + parsed.data.points,
      points_lifetime: (pts?.points_lifetime ?? 0) + parsed.data.points,
      last_evaluated_at: new Date().toISOString(),
    }, { onConflict: 'end_user_id' })

    return c.json({ ok: true, data: { end_user_id: endUser.id, points_awarded: parsed.data.points, new_total: newTotal } })
  })

  // ===========================================================
  // P3 MCP: POST /v1/admin/rewards/set-tier
  // Manually override a contributor's tier (MCP write surface).
  // ===========================================================
  app.post('/v1/admin/rewards/set-tier', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    let raw: unknown
    try { raw = await c.req.json() } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON' } }, 400)
    }
    const schema = z.object({
      end_user_id: z.string().uuid().optional(),
      external_user_id: z.string().min(1).optional(),
      tier_slug: z.string().min(1),
      reason: z.string().max(200).optional(),
    }).refine((d) => d.end_user_id || d.external_user_id, {
      message: 'Provide either end_user_id or external_user_id',
    })
    const parsed = schema.safeParse(raw)
    if (!parsed.success) return c.json({ ok: false, error: { code: 'INVALID_BODY' } }, 422)

    const db = getServiceClient()
    let endUserId: string | null = null

    if (parsed.data.end_user_id) {
      const { data } = await db.from('end_users').select('id').eq('id', parsed.data.end_user_id).eq('organization_id', orgId).single()
      endUserId = data?.id ?? null
    } else {
      const { data } = await db.from('end_users').select('id').eq('organization_id', orgId).eq('external_user_id', parsed.data.external_user_id!).single()
      endUserId = data?.id ?? null
    }
    if (!endUserId) return c.json({ ok: false, error: { code: 'USER_NOT_FOUND' } }, 404)

    const { data: tier } = await db
      .from('reward_tiers')
      .select('id, slug, display_name')
      .eq('organization_id', orgId)
      .eq('slug', parsed.data.tier_slug)
      .single()
    if (!tier) return c.json({ ok: false, error: { code: 'TIER_NOT_FOUND' } }, 404)

    const { error } = await db
      .from('end_user_points')
      .update({ current_tier_id: tier.id, last_evaluated_at: new Date().toISOString() })
      .eq('end_user_id', endUserId)
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

    // Audit log the manual override in end_user_activity
    await db.from('end_user_activity').insert({
      end_user_id: endUserId,
      organization_id: orgId,
      action: 'tier_override_manual',
      metadata: { tier_slug: parsed.data.tier_slug, reason: parsed.data.reason ?? null, awarded_via: 'admin_console' },
      points_awarded: 0,
    })

    return c.json({ ok: true, data: { end_user_id: endUserId, tier: { id: tier.id, slug: tier.slug, display_name: tier.display_name } } })
  })

  // ===========================================================
  // P3 ADMIN: GET /v1/admin/rewards/retention-impact
  // Retention analytics: did Champion+ users retain longer?
  // ===========================================================
  app.get('/v1/admin/rewards/retention-impact', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    const db = getServiceClient()

    // Find the "Champion" tier threshold (highest enabled tier)
    const { data: tiers } = await db
      .from('reward_tiers')
      .select('id, slug, display_name, points_threshold')
      .eq('organization_id', orgId)
      .eq('enabled', true)
      .order('points_threshold', { ascending: false })

    const topTier = tiers?.[0]

    if (!topTier) return c.json({ ok: true, data: { cohorts: [], message: 'No tiers configured' } })

    // Cohort A: users who ever reached the top tier
    const { data: topTierUsers } = await db
      .from('end_user_points')
      .select('end_user_id, total_points')
      .eq('organization_id', orgId)
      .gte('total_points', topTier.points_threshold)
      .limit(500)

    const topUserIds = (topTierUsers ?? []).map((u) => u.end_user_id)

    // Last-seen spread for top-tier users vs rest
    const { data: topTierLastSeen } = topUserIds.length > 0
      ? await db
          .from('end_users')
          .select('id, first_seen_at, last_seen_at')
          .in('id', topUserIds)
      : { data: [] }

    const { data: allUsers } = await db
      .from('end_users')
      .select('id, first_seen_at, last_seen_at')
      .eq('organization_id', orgId)
      .limit(2000)

    const daysBetween = (a: string, b: string) =>
      Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 86400000)

    const median = (arr: number[]) => {
      if (!arr.length) return 0
      const sorted = [...arr].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
    }

    const topRetention = (topTierLastSeen ?? [])
      .map((u) => daysBetween(u.first_seen_at ?? u.last_seen_at, u.last_seen_at ?? u.first_seen_at))
    const topIds = new Set(topUserIds)
    const restRetention = (allUsers ?? [])
      .filter((u) => !topIds.has(u.id))
      .map((u) => daysBetween(u.first_seen_at ?? u.last_seen_at, u.last_seen_at ?? u.first_seen_at))

    return c.json({
      ok: true,
      data: {
        top_tier: { slug: topTier.slug, display_name: topTier.display_name, count: topUserIds.length, median_retention_days: Math.round(median(topRetention)) },
        all_others: { count: restRetention.length, median_retention_days: Math.round(median(restRetention)) },
        lift_pct: restRetention.length > 0 && median(restRetention) > 0
          ? Math.round(((median(topRetention) - median(restRetention)) / median(restRetention)) * 100)
          : null,
      },
    })
  })

  // ===========================================================
  // P3 ADMIN: POST /v1/admin/rewards/simulate
  // Sandbox: simulate tier transition for a hypothetical activity log.
  // ===========================================================
  app.post('/v1/admin/rewards/simulate', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    let raw: unknown
    try { raw = await c.req.json() } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON' } }, 400)
    }
    const schema = z.object({
      events: z.array(z.object({
        action: z.string(),
        count: z.number().int().min(1).max(10000).default(1),
      })).min(1).max(200),
    })
    const parsed = schema.safeParse(raw)
    if (!parsed.success) return c.json({ ok: false, error: { code: 'INVALID_BODY' } }, 422)

    const db = getServiceClient()
    const { data: rules } = await db
      .from('reward_rules')
      .select('action, base_points, max_per_day, multiplier_eligible, enabled')
      .eq('organization_id', orgId)
      .eq('enabled', true)

    const { data: tiers } = await db
      .from('reward_tiers')
      .select('id, slug, display_name, points_threshold, host_credit_payload')
      .eq('organization_id', orgId)
      .eq('enabled', true)
      .order('points_threshold', { ascending: true })

    const ruleMap = new Map((rules ?? []).map((r) => [r.action, r]))

    let totalPoints = 0
    const breakdown: Array<{ action: string; count: number; per_event: number; subtotal: number; capped: boolean; unknown: boolean }> = []

    for (const event of parsed.data.events) {
      const rule = ruleMap.get(event.action)
      if (!rule) {
        breakdown.push({ action: event.action, count: event.count, per_event: 0, subtotal: 0, capped: false, unknown: true })
        continue
      }
      const effectiveCount = rule.max_per_day != null ? Math.min(event.count, rule.max_per_day) : event.count
      const capped = effectiveCount < event.count
      const subtotal = effectiveCount * rule.base_points
      totalPoints += subtotal
      breakdown.push({ action: event.action, count: event.count, per_event: rule.base_points, subtotal, capped, unknown: false })
    }

    const reachedTier = (tiers ?? []).filter((t) => t.points_threshold <= totalPoints).at(-1)

    return c.json({
      ok: true,
      data: {
        total_points: totalPoints,
        breakdown,
        reached_tier: reachedTier ?? null,
        next_tier: (tiers ?? []).find((t) => t.points_threshold > totalPoints) ?? null,
      },
    })
  })

  // ===========================================================
  // P3 ADMIN: GET /v1/admin/rewards/disputes
  // List open disputes for the org.
  // ===========================================================
  app.get('/v1/admin/rewards/disputes', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    const db = getServiceClient()
    const { data, error } = await db
      .from('reward_disputes')
      .select('id, end_user_id, payout_id, activity_id, reason, status, resolution_notes, opened_at, resolved_at, end_users(external_user_id, display_name)')
      .eq('organization_id', orgId)
      .order('opened_at', { ascending: false })
      .limit(100)

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data: data ?? [] })
  })

  // ===========================================================
  // P3 ADMIN: POST /v1/admin/rewards/disputes/:id/resolve
  // Approve or deny a dispute.
  // ===========================================================
  app.post('/v1/admin/rewards/disputes/:id/resolve', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    const id = c.req.param('id')
    let raw: unknown
    try { raw = await c.req.json() } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON' } }, 400)
    }

    const resolveSchema = z.object({
      decision: z.enum(['approved', 'denied']),
      notes: z.string().max(1000).optional(),
    })
    const parsed = resolveSchema.safeParse(raw)
    if (!parsed.success) return c.json({ ok: false, error: { code: 'INVALID_BODY' } }, 422)

    const db = getServiceClient()

    // Verify ownership
    const { data: existing } = await db.from('reward_disputes').select('id, status, payout_id').eq('id', id).eq('organization_id', orgId).single()
    if (!existing) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)
    if (existing.status !== 'open' && existing.status !== 'under_review') {
      return c.json({ ok: false, error: { code: 'ALREADY_RESOLVED' } }, 409)
    }

    const { data, error } = await db
      .from('reward_disputes')
      .update({
        status: parsed.data.decision,
        resolution_notes: parsed.data.notes ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, status, resolution_notes')
      .single()

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

    // If denied and a payout was linked, cancel it
    if (parsed.data.decision === 'denied' && existing.payout_id) {
      await db.from('reward_payouts')
        .update({ status: 'cancelled', withheld_reason: `dispute_denied:${id}`, updated_at: new Date().toISOString() })
        .eq('id', existing.payout_id)
        .eq('status', 'pending')
    }

    return c.json({ ok: true, data })
  })

  // ===========================================================
  // P2 ADMIN: DELETE /v1/admin/rewards/identity-providers/:id
  // ===========================================================
  app.delete('/v1/admin/rewards/identity-providers/:id', jwtAuth, async (c) => {
    const orgId = getOrgIdFromContext(c)
    if (!orgId) return c.json({ ok: false, error: { code: 'MISSING_ORG_ID' } }, 400)

    const id = c.req.param('id')
    const db = getServiceClient()

    // Verify ownership
    const { data: existing } = await db
      .from('host_auth_providers')
      .select('id, project_id')
      .eq('id', id)
      .single()

    if (!existing) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404)

    const { data: proj } = await db
      .from('projects')
      .select('id')
      .eq('id', existing.project_id)
      .eq('organization_id', orgId)
      .single()

    if (!proj) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403)

    const { error } = await db
      .from('host_auth_providers')
      .delete()
      .eq('id', id)

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data: { deleted: true } })
  })
}
