// ============================================================
// end-user-resolver.ts
//
// Resolves (or upserts) an end_users row for a given
// (organization_id, external_user_id) pair.
//
// This is the single funnel that turns the host app's opaque
// user identifier into a Mushi end_user.id used throughout the
// rewards pipeline. It:
//   1. Upserts the end_users row.
//   2. Propagates anti-fraud flags from reporter_devices when
//      a reporter_token_hash is supplied.
//   3. Refreshes last_seen_at with a 5-minute coalescing window
//      (mirrors private.touch_org_member_activity).
//   4. (P2) Validates a host-supplied JWT via verifyHostJwt.
// ============================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'

const rlog = log.child('end-user-resolver')

export interface EndUserTraits {
  email?: string | null
  name?: string | null
  /** Auth provider: 'supabase' | 'apple' | 'google' | 'custom' */
  provider?: string | null
}

export interface ResolveEndUserOptions {
  organizationId: string
  externalUserId: string
  traits?: EndUserTraits
  /** If supplied, anti-fraud flags from reporter_devices are carried forward. */
  reporterTokenHash?: string | null
  /** Whether the host SDK has the user opted in to rewards tracking. */
  optedInToRewards?: boolean
  /**
   * True only when the caller verified this identity (host JWT or a signed
   * X-Mushi-User-Token). Unverified calls may create a person but never
   * rewrite an existing person's name, email hash or provider (audit #31:
   * any public SDK key could otherwise rename users across the org).
   */
  identityVerified?: boolean
}

export interface ResolvedEndUser {
  id: string
  organizationId: string
  externalUserId: string
  optedInToRewards: boolean
  antiFraudFlags: string[]
}

/** SHA-256 hex of a string. Used for email_hash (never storing raw PII). */
async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function resolveEndUser(
  db: SupabaseClient,
  opts: ResolveEndUserOptions,
): Promise<ResolvedEndUser | null> {
  const { organizationId, externalUserId, traits, reporterTokenHash, optedInToRewards, identityVerified } = opts

  const emailHash = traits?.email
    ? await sha256Hex(traits.email.toLowerCase().trim())
    : null

  const nowIso = new Date().toISOString()
  const presentation: Record<string, unknown> = {}
  if (emailHash) presentation.email_hash = emailHash
  if (traits?.name) presentation.display_name = traits.name.slice(0, 120)
  if (traits?.provider) presentation.jwt_provider = traits.provider
  const activity: Record<string, unknown> = { last_seen_at: nowIso, updated_at: nowIso }
  if (typeof optedInToRewards === 'boolean') activity.opted_in_to_rewards = optedInToRewards

  // A new person may be created with the traits the host supplied. An existing
  // person's presentation fields change only for a verified identity; otherwise
  // only activity fields move. Never touches jwt_verified_at (P2).
  const { data: inserted, error: insertError } = await db
    .from('end_users')
    .upsert(
      { organization_id: organizationId, external_user_id: externalUserId, ...presentation, ...activity },
      { onConflict: 'organization_id,external_user_id', ignoreDuplicates: true },
    )
    .select('id, opted_in_to_rewards, anti_fraud_flags')
  if (insertError) {
    rlog.error('upsert_failed', { organizationId, error: insertError.message })
    return null
  }

  let row = (inserted as Array<{ id: string; opted_in_to_rewards: boolean | null; anti_fraud_flags: string[] | null }> | null)?.[0] ?? null
  if (!row) {
    const { data: updated, error } = await db
      .from('end_users')
      .update(identityVerified ? { ...presentation, ...activity } : activity)
      .eq('organization_id', organizationId)
      .eq('external_user_id', externalUserId)
      .select('id, opted_in_to_rewards, anti_fraud_flags')
      .single()
    if (error || !updated) {
      rlog.error('update_failed', { organizationId, error: error?.message })
      return null
    }
    row = updated
  }

  // Carry forward anti-fraud flags from reporter_devices if a token hash
  // is available and the device row is already flagged.
  if (reporterTokenHash) {
    await propagateAntiFraudFlags(db, organizationId, reporterTokenHash, row.id)
  }

  return {
    id: row.id,
    organizationId,
    externalUserId,
    optedInToRewards: row.opted_in_to_rewards ?? false,
    antiFraudFlags: row.anti_fraud_flags ?? [],
  }
}

/**
 * Check reporter_devices for existing fraud flags and merge them onto
 * the end_users row so the rewards pipeline inherits the abuse signal.
 */
async function propagateAntiFraudFlags(
  db: SupabaseClient,
  organizationId: string,
  reporterTokenHash: string,
  endUserId: string,
): Promise<void> {
  // Look up all projects for this org to search reporter_devices cross-project.
  const { data: projects } = await db
    .from('projects')
    .select('id')
    .eq('organization_id', organizationId)

  if (!projects?.length) return

  const projectIds = projects.map((p: { id: string }) => p.id)

  const { data: devices } = await db
    .from('reporter_devices')
    .select('flagged_as_suspicious, cross_account_flagged, flag_reason')
    .in('project_id', projectIds)
    .contains('reporter_tokens', [reporterTokenHash])
    .limit(20)

  if (!devices?.length) return

  const newFlags: string[] = []
  for (const d of devices as Array<{
    flagged_as_suspicious: boolean
    cross_account_flagged: boolean
    flag_reason: string | null
  }>) {
    if (d.flagged_as_suspicious) newFlags.push('suspicious')
    if (d.cross_account_flagged) newFlags.push('cross_account')
  }

  if (!newFlags.length) return

  // Merge with existing flags (no duplicates).
  const { data: eu } = await db
    .from('end_users')
    .select('anti_fraud_flags')
    .eq('id', endUserId)
    .single()

  const existing: string[] = eu?.anti_fraud_flags ?? []
  const merged = Array.from(new Set([...existing, ...newFlags]))

  await db
    .from('end_users')
    .update({ anti_fraud_flags: merged, updated_at: new Date().toISOString() })
    .eq('id', endUserId)
}
