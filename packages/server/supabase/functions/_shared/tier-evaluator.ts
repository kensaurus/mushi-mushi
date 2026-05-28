// ============================================================
// tier-evaluator.ts
//
// Evaluates whether an end_user has crossed a new tier
// threshold and, if so:
//   1. Updates end_user_points.current_tier_id.
//   2. Fires dispatchRewardEvent for 'reward.tier_changed'.
//   3. Delivers the host webhook via dispatchRewardWebhook.
//
// Called from the activity-ingest route after awardPointsForEndUser.
// Pure: reads reward_tiers + end_user_points, writes only when a
// transition happens.
// ============================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'
import { dispatchRewardWebhook } from './reward-webhooks.ts'

const tlog = log.child('tier-evaluator')

/** Hardcoded fallback tiers applied when the org has no reward_tiers rows. */
export const DEFAULT_TIERS = [
  { id: '__free__',        slug: 'free',        display_name: 'Explorer',    points_threshold: 0,    perks: {}, host_credit_payload: null },
  { id: '__explorer__',   slug: 'explorer',    display_name: 'Explorer',    points_threshold: 100,  perks: { badge: 'explorer' }, host_credit_payload: { perk: 'gems', amount: 500 } },
  { id: '__contributor__', slug: 'contributor', display_name: 'Contributor', points_threshold: 500,  perks: { badge: 'contributor' }, host_credit_payload: { perk: 'pro_coupon', months: 1 } },
  { id: '__champion__',   slug: 'champion',    display_name: 'Champion',    points_threshold: 2000, perks: { badge: 'champion' }, host_credit_payload: { perk: 'pro_annual' } },
]

interface TierRow {
  id: string
  slug: string
  display_name: string
  points_threshold: number
  perks: Record<string, unknown>
  host_credit_payload: Record<string, unknown> | null
  monetary_reward_usd: number | null
}

async function loadOrgTiers(db: SupabaseClient, organizationId: string): Promise<TierRow[]> {
  const { data, error } = await db
    .from('reward_tiers')
    .select('id, slug, display_name, points_threshold, perks, host_credit_payload, monetary_reward_usd')
    .eq('organization_id', organizationId)
    .eq('enabled', true)
    .order('points_threshold', { ascending: true })

  if (error) {
    tlog.warn('load_tiers_failed', { organizationId, error: error.message })
    return DEFAULT_TIERS as TierRow[]
  }

  return (data?.length ? data : DEFAULT_TIERS) as TierRow[]
}

function resolveTier(totalPoints: number, tiers: TierRow[]): TierRow | null {
  // Return the highest threshold the user has met.
  let matched: TierRow | null = null
  for (const t of tiers) {
    if (totalPoints >= t.points_threshold) matched = t
  }
  return matched
}

export async function evaluateTier(
  db: SupabaseClient,
  endUserId: string,
  organizationId: string,
): Promise<{ tierChanged: boolean; tier: TierRow | null }> {
  // 1. Fetch current points + tier
  const { data: pts, error: ptsErr } = await db
    .from('end_user_points')
    .select('total_points, current_tier_id')
    .eq('end_user_id', endUserId)
    .single()

  if (ptsErr || !pts) {
    tlog.warn('points_read_failed', { endUserId, error: ptsErr?.message })
    return { tierChanged: false, tier: null }
  }

  // 2. Load tier ladder
  const tiers = await loadOrgTiers(db, organizationId)
  const newTier = resolveTier(pts.total_points, tiers)

  if (!newTier) return { tierChanged: false, tier: null }

  // No change
  if (pts.current_tier_id === newTier.id) return { tierChanged: false, tier: newTier }

  // 3. Fetch previous tier for the webhook payload
  const oldTier = tiers.find((t) => t.id === pts.current_tier_id) ?? null

  // 4. Write new tier to end_user_points
  const { error: upErr } = await db
    .from('end_user_points')
    .update({
      current_tier_id: newTier.id,
      last_evaluated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('end_user_id', endUserId)

  if (upErr) {
    tlog.error('tier_update_failed', { endUserId, newTierId: newTier.id, error: upErr.message })
    return { tierChanged: false, tier: newTier }
  }

  tlog.info('tier_changed', {
    endUserId,
    from: oldTier?.slug ?? 'none',
    to: newTier.slug,
    points: pts.total_points,
  })

  // 5. Fire host webhooks (fire-and-forget; errors logged internally)
  dispatchRewardWebhook(db, organizationId, {
    event: 'reward.tier_changed',
    end_user_id: endUserId,
    tier_before: oldTier ? { slug: oldTier.slug, display_name: oldTier.display_name } : null,
    tier_after: { slug: newTier.slug, display_name: newTier.display_name, perks: newTier.perks },
    host_credit_payload: newTier.host_credit_payload,
    occurred_at: new Date().toISOString(),
  }).then(undefined, (err: unknown) => tlog.error('webhook_dispatch_failed', { endUserId, error: String(err) }))

  return { tierChanged: true, tier: newTier }
}
