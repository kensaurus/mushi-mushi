// ============================================================
// reputation.ts
//
// Points + reputation for both the legacy device-level
// (reporter_token_hash → reporter_reputation) and the new
// org-level (end_user_id → end_user_points) pipelines.
//
// The POINT_TABLE is now DB-driven: each project (or org)
// can configure reward_rules rows. When no DB rule exists for
// an action the legacy hardcoded fallback is used so existing
// projects keep working without migration overhead.
// ============================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'
import { createNotification, buildNotificationMessage } from './notifications.ts'
import { evaluateTier } from './tier-evaluator.ts'

const rlog = log.child('reputation')

// ──────────────────────────────────────────────────────────────
// Legacy hardcoded fallback (used when no reward_rules row found)
// ──────────────────────────────────────────────────────────────
const LEGACY_POINT_TABLE: Record<string, { base: number; useMultiplier: boolean }> = {
  submit:              { base: 10,  useMultiplier: true },
  confirmed:           { base: 50,  useMultiplier: false },
  fixed:               { base: 25,  useMultiplier: false },
  first_on_component:  { base: 15,  useMultiplier: true },
  screenshot:          { base: 5,   useMultiplier: false },
  element_select:      { base: 5,   useMultiplier: false },
  dismissed:           { base: -5,  useMultiplier: false },
  // New actions added by the rewards program (P1)
  report_submit:       { base: 10,  useMultiplier: true },
  report_confirmed:    { base: 50,  useMultiplier: false },
  report_fixed:        { base: 25,  useMultiplier: false },
  report_dismissed:    { base: -5,  useMultiplier: false },
  comment_posted:      { base: 8,   useMultiplier: false },
  screen_view_unique_per_day: { base: 2, useMultiplier: false },
  session_minute:      { base: 1,   useMultiplier: false },
  dom_screenshot_attached: { base: 5, useMultiplier: false },
  element_selected:    { base: 5,   useMultiplier: false },
  first_on_component_sdk: { base: 15, useMultiplier: true },
}

// In-memory rule cache: projectId → { action → rule_row }. 60-second TTL.
const ruleCache = new Map<string, { rules: Map<string, RuleRow>; expiresAt: number }>()

interface RuleRow {
  id: string
  base_points: number
  max_per_day: number | null
  max_per_user_lifetime: number | null
  multiplier_eligible: boolean
  requires_jwt_verification: boolean
}

async function loadProjectRules(
  db: SupabaseClient,
  projectId: string,
): Promise<Map<string, RuleRow>> {
  const now = Date.now()
  const cached = ruleCache.get(projectId)
  if (cached && cached.expiresAt > now) return cached.rules

  const { data, error } = await db
    .from('reward_rules')
    .select('id, action, base_points, max_per_day, max_per_user_lifetime, multiplier_eligible, requires_jwt_verification')
    .eq('project_id', projectId)
    .eq('enabled', true)

  if (error) {
    rlog.warn('load_rules_failed', { projectId, error: error.message })
    // Return empty map — callers fall back to legacy table.
    return new Map()
  }

  const m = new Map<string, RuleRow>()
  for (const row of (data ?? []) as Array<RuleRow & { action: string }>) {
    m.set(row.action, row)
  }
  ruleCache.set(projectId, { rules: m, expiresAt: now + 60_000 })
  return m
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val))
}

function computeReputation(confirmed: number, dismissed: number): number {
  const raw = confirmed / (confirmed + dismissed + 1)
  return clamp(raw, 0.1, 2.0)
}

interface LegacyPointAction {
  action: keyof typeof LEGACY_POINT_TABLE | string
}

// ──────────────────────────────────────────────────────────────
// Legacy path: device-level reporter_reputation (unchanged API)
// ──────────────────────────────────────────────────────────────
export async function awardPoints(
  db: SupabaseClient,
  projectId: string,
  reporterTokenHash: string,
  action: LegacyPointAction,
): Promise<{ points: number; totalPoints: number; reputation: number }> {
  // Try DB rules first; fall back to hardcoded table.
  const dbRules = await loadProjectRules(db, projectId)
  const dbRule = dbRules.get(action.action)
  const legacyConfig = LEGACY_POINT_TABLE[action.action]

  const base = dbRule?.base_points ?? legacyConfig?.base ?? 0
  const useMultiplier = dbRule?.multiplier_eligible ?? legacyConfig?.useMultiplier ?? false

  if (base === 0 && !legacyConfig) {
    return { points: 0, totalPoints: 0, reputation: 1.0 }
  }

  const { data: existing } = await db
    .from('reporter_reputation')
    .select('*')
    .eq('project_id', projectId)
    .eq('reporter_token_hash', reporterTokenHash)
    .single()

  const current = existing ?? {
    reputation_score: 1.0,
    total_points: 0,
    confirmed_bugs: 0,
    dismissed_reports: 0,
    total_reports: 0,
  }

  const multiplier = useMultiplier ? current.reputation_score : 1.0
  const points = Math.round(base * multiplier)

  const updates: Record<string, unknown> = {
    total_points: current.total_points + points,
    reputation_score: current.reputation_score,
  }

  if (action.action === 'submit' || action.action === 'report_submit') {
    updates.total_reports = current.total_reports + 1
  } else if (action.action === 'confirmed' || action.action === 'report_confirmed') {
    updates.confirmed_bugs = current.confirmed_bugs + 1
    updates.reputation_score = computeReputation(current.confirmed_bugs + 1, current.dismissed_reports)
  } else if (action.action === 'dismissed' || action.action === 'report_dismissed') {
    updates.dismissed_reports = current.dismissed_reports + 1
    updates.reputation_score = computeReputation(current.confirmed_bugs, current.dismissed_reports + 1)
  }

  if (existing) {
    await db.from('reporter_reputation').update(updates).eq('id', existing.id)
  } else {
    await db.from('reporter_reputation').insert({
      project_id: projectId,
      reporter_token_hash: reporterTokenHash,
      ...updates,
    })
  }

  return {
    points,
    totalPoints: updates.total_points as number,
    reputation: updates.reputation_score as number,
  }
}

export async function getReputation(
  db: SupabaseClient,
  projectId: string,
  reporterTokenHash: string,
): Promise<{ reputation: number; totalPoints: number; confirmedBugs: number; totalReports: number }> {
  const { data } = await db
    .from('reporter_reputation')
    .select('reputation_score, total_points, confirmed_bugs, total_reports')
    .eq('project_id', projectId)
    .eq('reporter_token_hash', reporterTokenHash)
    .single()

  return {
    reputation: data?.reputation_score ?? 1.0,
    totalPoints: data?.total_points ?? 0,
    confirmedBugs: data?.confirmed_bugs ?? 0,
    totalReports: data?.total_reports ?? 0,
  }
}

// ──────────────────────────────────────────────────────────────
// New path: org-level end_user_points (rewards program P1)
// ──────────────────────────────────────────────────────────────

export interface AwardActivityOptions {
  projectId: string
  organizationId: string
  endUserId: string
  action: string
  metadata?: Record<string, unknown>
  /** Reporter token hash for the legacy reporter_reputation row (optional) */
  reporterTokenHash?: string | null
  /** Report ID used for points_awarded notification (optional) */
  reportId?: string | null
}

export interface AwardActivityResult {
  pointsAwarded: number
  totalPoints: number
  rejectedReason: string | null
  tierChanged: boolean
}

/**
 * Awards points for a single activity action against the end_user_points
 * system. Enforces velocity caps from reward_rules, propagates to
 * tier-evaluator, and fires the points_awarded notification.
 *
 * Also keeps the legacy reporter_reputation row in sync when a
 * reporterTokenHash is supplied so existing admin views stay correct.
 */
export async function awardPointsForEndUser(
  db: SupabaseClient,
  opts: AwardActivityOptions,
): Promise<AwardActivityResult> {
  const { projectId, organizationId, endUserId, action, metadata, reporterTokenHash, reportId } = opts

  // 1. Load DB rule (fallback: legacy table)
  const dbRules = await loadProjectRules(db, projectId)
  const dbRule = dbRules.get(action)
  const legacyConfig = LEGACY_POINT_TABLE[action]

  const basePoints = dbRule?.base_points ?? legacyConfig?.base ?? 0
  const maxPerDay = dbRule?.max_per_day ?? null
  const maxLifetime = dbRule?.max_per_user_lifetime ?? null
  const multiplierEligible = dbRule?.multiplier_eligible ?? legacyConfig?.useMultiplier ?? false

  // 2. Anti-fraud: check velocity cap
  if (maxPerDay !== null) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count } = await db
      .from('end_user_activity')
      .select('id', { count: 'exact', head: true })
      .eq('end_user_id', endUserId)
      .eq('action', action)
      .gte('created_at', since)

    if ((count ?? 0) >= maxPerDay) {
      await db.from('end_user_activity').insert({
        end_user_id: endUserId,
        organization_id: organizationId,
        project_id: projectId,
        action,
        points_awarded: 0,
        rule_id: dbRule?.id ?? null,
        rejected_reason: `daily_cap_exceeded:${maxPerDay}`,
        metadata: metadata ?? {},
      })
      return { pointsAwarded: 0, totalPoints: 0, rejectedReason: `daily_cap:${maxPerDay}`, tierChanged: false }
    }
  }

  // 3. Anti-fraud: check lifetime cap
  if (maxLifetime !== null) {
    const { count } = await db
      .from('end_user_activity')
      .select('id', { count: 'exact', head: true })
      .eq('end_user_id', endUserId)
      .eq('action', action)
      .is('rejected_reason', null)

    if ((count ?? 0) >= maxLifetime) {
      await db.from('end_user_activity').insert({
        end_user_id: endUserId,
        organization_id: organizationId,
        project_id: projectId,
        action,
        points_awarded: 0,
        rule_id: dbRule?.id ?? null,
        rejected_reason: `lifetime_cap_exceeded:${maxLifetime}`,
        metadata: metadata ?? {},
      })
      return { pointsAwarded: 0, totalPoints: 0, rejectedReason: `lifetime_cap:${maxLifetime}`, tierChanged: false }
    }
  }

  // 4. Compute final points (reputation multiplier applied when eligible)
  let multiplier = 1.0
  if (multiplierEligible && reporterTokenHash) {
    const rep = await getReputation(db, projectId, reporterTokenHash)
    multiplier = rep.reputation
  }
  const pointsAwarded = Math.max(0, Math.round(basePoints * multiplier))

  // 5. Persist activity row (trigger updates end_user_points)
  const { error: insertErr } = await db.from('end_user_activity').insert({
    end_user_id: endUserId,
    organization_id: organizationId,
    project_id: projectId,
    action,
    points_awarded: pointsAwarded,
    rule_id: dbRule?.id ?? null,
    metadata: metadata ?? {},
  })

  if (insertErr) {
    rlog.error('activity_insert_failed', { endUserId, action, error: insertErr.message })
    return { pointsAwarded: 0, totalPoints: 0, rejectedReason: 'insert_error', tierChanged: false }
  }

  // 6. Read updated total (denormalized, fast)
  const { data: pts } = await db
    .from('end_user_points')
    .select('total_points')
    .eq('end_user_id', endUserId)
    .single()

  const totalPoints = pts?.total_points ?? pointsAwarded

  // 7. Fire points_awarded notification (was missing — now wired)
  if (pointsAwarded > 0 && reporterTokenHash && reportId) {
    createNotification(
      db,
      projectId,
      reportId,
      reporterTokenHash,
      'points_awarded',
      {
        message: buildNotificationMessage('points_awarded', { points: pointsAwarded }),
        points: pointsAwarded,
        reportId,
      },
    ).then(undefined, (err: unknown) => rlog.warn('notification_failed', { error: String(err) }))
  }

  // 8. Also keep legacy reporter_reputation in sync
  if (reporterTokenHash) {
    awardPoints(db, projectId, reporterTokenHash, { action }).then(undefined, (err: unknown) =>
      rlog.warn('legacy_rep_sync_failed', { error: String(err) }),
    )
  }

  // 9. Evaluate tier transition
  const { tierChanged } = await evaluateTier(db, endUserId, organizationId)

  return { pointsAwarded, totalPoints, rejectedReason: null, tierChanged }
}

/** Clears the per-project rule cache. Used by tests and admin-rule-save endpoint. */
export function invalidateRuleCache(projectId: string): void {
  ruleCache.delete(projectId)
}
