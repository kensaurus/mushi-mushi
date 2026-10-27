/**
 * FILE: packages/server/supabase/functions/api/routes/byok-review-followups.ts
 * PURPOSE: Review follow-ups (ADR 0032): settings, the Cursor model list for
 *          the picker, and the follow-up scoreboard.
 *
 *   GET   /v1/admin/byok/review-followups   the organization's settings, the
 *         Cursor keys it may run follow-ups on, the last 7 days' scoreboard
 *         and the latest follow-ups, both over the apps the caller can
 *         access. Console (jwtAuth).
 *   PATCH /v1/admin/byok/review-followups   on/off, the key (a shared key of
 *         the organization or a key of one of its apps; null = the key each
 *         app's fixes use), the model (id?param=value; null = the app's
 *         model) and the daily limit (1-200). Organization owners and admins,
 *         in the console.
 *   GET   /v1/admin/byok/cursor/models?keyId=   Cursor GET /v1/models for
 *         that key (cached an hour per key), or for the key this app would
 *         use without keyId. An app key of another app needs an organization
 *         owner or admin. Console (jwtAuth).
 *
 * The scoreboard lives in review-followup-stats.ts; GET
 * /v1/admin/byok/spend-down and MCP get_spend_down_status add it as
 * `reviewFollowups`.
 */

import type { Context, Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { jwtAuth } from '../../_shared/auth.ts'
import { logAudit } from '../../_shared/audit.ts'
import { dbError, resolveOwnedProject } from '../shared.ts'
import { byokKeyIdSchema } from '../../_shared/byok-validation.ts'
import { canManageSharedKeys, keyOwnerFilter, keyOwnerForProject } from '../../_shared/byok-scope.ts'
import { resolveCursorApiKey } from '../../_shared/agent-adapters.ts'
import { CursorApiError, listCursorModelsV1, parseCursorModelSpec } from '../../_shared/cursor-cloud.ts'
import {
  FOLLOWUP_DAILY_LIMIT_MAX,
  FOLLOWUP_DAILY_LIMIT_MIN,
  FOLLOWUP_REASONS,
  type FollowupReason,
} from '../../_shared/review-followup.ts'
import {
  cursorKeyById,
  cursorModelsCached,
  FOLLOWUP_SETTINGS_COLUMNS,
  followupSettingsFromRow,
  notMigrated,
  orgCursorKeys,
} from '../../_shared/review-followup-db.ts'
import { followupScopeProjectIds, reviewFollowupStatsFor } from './review-followup-stats.ts'

type Db = ReturnType<typeof getServiceClient>

function bad(c: Context, code: string, message: string, status: 400 | 403 | 404 = 400) {
  return c.json({ ok: false, error: { code, message } }, status)
}

async function orgRole(c: Context, db: Db, orgId: string): Promise<string | null> {
  const userId = c.get('userId') as string | undefined
  if (!userId) return null
  const { data, error } = await db
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return null
  return (data?.role as string | undefined) ?? null
}

const RECENT_COLUMNS =
  'id, project_id, fix_attempt_id, pr_url, status, skip_reason, error, model, key_id, findings_count, findings_dropped, head_sha_before, head_sha_after, verdict_after, created_at, dispatched_at, finished_at'

async function sendModels(c: Context, cacheKey: string, apiKey: string) {
  try {
    const models = await cursorModelsCached(cacheKey, apiKey, new Date(), (k) => listCursorModelsV1({ apiKey: k }))
    return c.json({ ok: true, data: { models } })
  } catch (err) {
    const status = err instanceof CursorApiError ? err.status : 0
    const message = err instanceof Error ? err.message : String(err)
    return c.json(
      { ok: false, error: { code: 'CURSOR_MODELS_FAILED', message: `Cursor did not return its models (${status || 'network'}): ${message.slice(0, 200)}` } },
      502,
    )
  }
}

export function registerByokReviewFollowupRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/byok/review-followups', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()
    const resolved = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: null }),
    })
    if ('response' in resolved) return resolved.response
    const project = resolved.project
    const orgId = (project.organization_id as string | null) ?? null
    if (!orgId) return c.json({ ok: true, data: null })

    const { data: orgRow, error: orgErr } = await db.from('organizations').select(FOLLOWUP_SETTINGS_COLUMNS).eq('id', orgId).maybeSingle()
    if (orgErr) {
      if (notMigrated(orgErr as { code?: string })) return c.json({ ok: true, data: { available: false } })
      return dbError(c, orgErr)
    }
    const settings = followupSettingsFromRow(orgRow as Record<string, unknown> | null)
    const role = await orgRole(c, db, orgId)
    try {
      // The organization's keys plus the caller's own universal keys (ADR
      // 0031) when the caller owns the organization, so they serve its apps.
      const [{ keys, ownerIds }, scope] = await Promise.all([
        orgCursorKeys(db, orgId, { universalForUserId: userId }),
        followupScopeProjectIds(c, db, project),
      ])
      // The chosen key may be another owner's universal key: list it too, so
      // the picker can show what is set.
      if (settings.keyId && !keys.some((k) => k.id === settings.keyId) && ownerIds.length > 0) {
        const { data: chosen } = await db
          .from('byok_keys')
          .select('id, label, key_hint, project_id, organization_id, owner_user_id, status, test_status')
          .eq('id', settings.keyId)
          .eq('provider_slug', 'cursor')
          .in('owner_user_id', ownerIds)
          .maybeSingle()
        if (chosen) keys.push(chosen as (typeof keys)[number])
      }
      const [scoreboard, names] = await Promise.all([
        reviewFollowupStatsFor(db, scope),
        db.from('projects').select('id, name').eq('organization_id', orgId),
      ])
      const canManage = canManageSharedKeys(role)
      // Owners and admins see every app's key and name (they choose the key
      // for the whole organization); others only the apps they can open and
      // the organization's shared keys.
      const visible = new Set(scope)
      const appName = new Map(
        ((names.data ?? []) as Array<{ id: string; name: string }>)
          .filter((p) => canManage || visible.has(p.id))
          .map((p) => [p.id, p.name]),
      )
      const shownKeys = keys.filter((k) => canManage || !k.project_id || visible.has(k.project_id))
      let recent: unknown[] = []
      if (scope.length > 0) {
        const { data } = await db
          .from('fix_review_followups')
          .select(RECENT_COLUMNS)
          .in('project_id', scope)
          .order('created_at', { ascending: false })
          .limit(10)
        recent = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
          ...r,
          appName: appName.get(String(r.project_id)) ?? null,
          reason: r.skip_reason ? FOLLOWUP_REASONS[r.skip_reason as FollowupReason] ?? String(r.skip_reason) : null,
        }))
      }
      return c.json({
        ok: true,
        data: {
          available: true,
          organizationId: orgId,
          canManage,
          settings,
          keys: shownKeys.map((k) => ({
            id: k.id,
            label: k.label,
            keyHint: k.key_hint,
            scope: k.owner_user_id ? 'universal' : k.organization_id ? 'organization' : 'project',
            mine: !!k.owner_user_id && k.owner_user_id === userId,
            appName: k.project_id ? appName.get(k.project_id) ?? null : null,
            status: k.status,
          })),
          scoreboard,
          recent,
        },
      })
    } catch (err) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: err instanceof Error ? err.message : String(err) } }, 500)
    }
  })

  app.patch('/v1/admin/byok/review-followups', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') return bad(c, 'VALIDATION_ERROR', 'enabled must be true or false.')
      patch.review_followup_enabled = body.enabled
      // Turning on (again) clears why Mushi had turned them off.
      if (body.enabled) patch.review_followup_off_reason = null
    }
    if (body.model !== undefined) {
      if (body.model === null || body.model === '') patch.review_followup_model = null
      else if (typeof body.model !== 'string' || body.model.length > 300 || !parseCursorModelSpec(body.model)) {
        return bad(c, 'INVALID_CURSOR_MODEL', 'model must be a Cursor model id, optionally with ?param=value pairs.')
      } else patch.review_followup_model = body.model.trim()
    }
    if (body.escalationModel !== undefined) {
      // The model for a PR's last follow-up round (ADR 0032 amendment, 2026-10-23).
      if (body.escalationModel === null || body.escalationModel === '') patch.review_followup_escalation_model = null
      else if (
        typeof body.escalationModel !== 'string' ||
        body.escalationModel.length > 300 ||
        !parseCursorModelSpec(body.escalationModel)
      ) {
        return bad(c, 'INVALID_CURSOR_MODEL', 'escalationModel must be a Cursor model id, optionally with ?param=value pairs.')
      } else patch.review_followup_escalation_model = body.escalationModel.trim()
    }
    if (body.dailyLimit !== undefined) {
      const n = body.dailyLimit
      if (typeof n !== 'number' || !Number.isInteger(n) || n < FOLLOWUP_DAILY_LIMIT_MIN || n > FOLLOWUP_DAILY_LIMIT_MAX) {
        return bad(c, 'VALIDATION_ERROR', `dailyLimit must be a whole number from ${FOLLOWUP_DAILY_LIMIT_MIN} to ${FOLLOWUP_DAILY_LIMIT_MAX}.`)
      }
      patch.review_followup_daily_limit = n
    }
    if (body.keyId !== undefined) {
      if (body.keyId !== null && (typeof body.keyId !== 'string' || !byokKeyIdSchema.safeParse(body.keyId).success)) {
        return bad(c, 'INVALID_KEY_ID', 'keyId must be a UUID, or null for the key each app uses.')
      }
      patch.review_followup_key_id = body.keyId
    }
    if (Object.keys(patch).length === 0) return bad(c, 'VALIDATION_ERROR', 'Nothing to change.')

    const db = getServiceClient()
    const resolved = await resolveOwnedProject(c, db, userId)
    if ('response' in resolved) return resolved.response
    const project = resolved.project
    const orgId = (project.organization_id as string | null) ?? null
    if (!orgId) return bad(c, 'NO_ORGANIZATION', 'This app has no organization.')
    // Follow-ups spend a key across every app of the organization: owners and admins only.
    if (!canManageSharedKeys(await orgRole(c, db, orgId))) {
      return bad(c, 'ORG_ADMIN_ONLY', 'Only an organization owner or admin can change review follow-ups.', 403)
    }
    if (typeof patch.review_followup_key_id === 'string') {
      // The same rule the worker applies: a shared key of this organization,
      // a key of one of its apps, or a universal key (ADR 0031) whose owner
      // owns this organization.
      const check = await cursorKeyById(db, patch.review_followup_key_id, orgId, { requireActive: false })
      if (!check.ok && check.reason === 'key_not_allowed') {
        return bad(c, 'KEY_NOT_ALLOWED', 'Pick a Cursor key shared by this organization, owned by one of its apps, or a universal key of one of its owners.')
      }
    }

    // Discovery reaches 3 days before the moment follow-ups were turned on
    // (ADR 0032): stamp it only on the off → on change.
    if (patch.review_followup_enabled === true) {
      const { data: current, error: curErr } = await db.from('organizations').select('review_followup_enabled').eq('id', orgId).maybeSingle()
      if (curErr) return dbError(c, curErr)
      if ((current as { review_followup_enabled?: boolean } | null)?.review_followup_enabled !== true) {
        patch.review_followup_enabled_at = new Date().toISOString()
      }
    }
    const { data, error } = await db
      .from('organizations')
      .update(patch)
      .eq('id', orgId)
      .select(FOLLOWUP_SETTINGS_COLUMNS)
      .maybeSingle()
    if (error) return dbError(c, error)
    if (!data) return bad(c, 'NOT_FOUND', 'Organization not found.', 404)
    await logAudit(db, project.id, userId, 'settings.updated', 'organization', orgId, { reviewFollowups: patch }).catch(() => {})
    return c.json({ ok: true, data: { settings: followupSettingsFromRow(data as Record<string, unknown>) } })
  })

  app.get('/v1/admin/byok/cursor/models', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()
    const resolved = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => bad(c, 'NO_PROJECT', 'No project selected'),
    })
    if ('response' in resolved) return resolved.response
    const project = resolved.project
    const keyId = c.req.query('keyId')?.trim() ?? ''

    if (!keyId) {
      const apiKey = await resolveCursorApiKey(db, project.id)
      if (!apiKey) return bad(c, 'NO_CURSOR_KEY', 'Add a Cursor API key under Settings → AI keys first.')
      return sendModels(c, `app:${project.id}`, apiKey)
    }
    if (!byokKeyIdSchema.safeParse(keyId).success) return bad(c, 'INVALID_KEY_ID', 'keyId must be a UUID.')
    const orgId = (project.organization_id as string | null) ?? null

    // A key this app already uses (its own, its organization's shared key, or
    // a universal key of the organization's owners, ADR 0031): any member.
    const { data: own, error } = await db
      .from('byok_keys')
      .select('id')
      .eq('id', keyId)
      .or(keyOwnerFilter(await keyOwnerForProject(db, { id: project.id, organization_id: orgId })))
      .maybeSingle()
    if (error) return dbError(c, error)
    // Another app's key (for the organization's follow-ups): owners and admins.
    if (!own && !(orgId && canManageSharedKeys(await orgRole(c, db, orgId)))) {
      return bad(c, 'NOT_FOUND', 'No such key for this app.', 404)
    }
    if (!orgId) return bad(c, 'NOT_FOUND', 'No such key for this app.', 404)
    const key = await cursorKeyById(db, keyId, orgId, { requireActive: false })
    if (!key.ok) {
      return key.reason === 'key_not_allowed'
        ? bad(c, 'NOT_FOUND', 'No such Cursor key for this organization.', 404)
        : bad(c, 'NO_CURSOR_KEY', 'This Cursor key has no secret stored.')
    }
    return sendModels(c, key.cacheKey, key.apiKey)
  })
}
