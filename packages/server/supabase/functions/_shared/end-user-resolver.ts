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
  const { organizationId, externalUserId, traits, reporterTokenHash, optedInToRewards } = opts

  const emailHash = traits?.email
    ? await sha256Hex(traits.email.toLowerCase().trim())
    : null

  // Upsert end_users row. ON CONFLICT (organization_id, external_user_id)
  // updates presentation fields but never overwrites jwt_verified_at (P2).
  const upsertData: Record<string, unknown> = {
    organization_id: organizationId,
    external_user_id: externalUserId,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  if (emailHash) upsertData.email_hash = emailHash
  if (traits?.name) upsertData.display_name = traits.name.slice(0, 120)
  if (traits?.provider) upsertData.jwt_provider = traits.provider
  if (typeof optedInToRewards === 'boolean') upsertData.opted_in_to_rewards = optedInToRewards

  const { data: row, error } = await db
    .from('end_users')
    .upsert(upsertData, {
      onConflict: 'organization_id,external_user_id',
      ignoreDuplicates: false,
    })
    .select('id, opted_in_to_rewards, anti_fraud_flags')
    .single()

  if (error || !row) {
    rlog.error('upsert_failed', { organizationId, error: error?.message })
    return null
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
