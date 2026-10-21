/**
 * FILE: packages/server/supabase/functions/api/routes/byok-spend-down.ts
 * PURPOSE: Spend-down mode settings and status for Cursor keys (ADR 0028).
 *
 *   GET   /v1/admin/byok/spend-down                 every Cursor key this app
 *         can use, with its spend-down settings, window, today's count, the
 *         apps it pays for (each with its stop-loss pause state), the last
 *         7 days' scoreboard (runs → PRs → Opus verdicts → merged, review
 *         cost) and the last worker tick. `mcp:read`.
 *   PATCH /v1/admin/byok/keys/:keyId/spend-down     turn it on or off and set
 *         the credit expiry, model, daily limit and window. A shared key is
 *         an organization owner's or admin's call in the console (ADR 0023);
 *         an app's own key is its owner's or admin's. `mcp:write`.
 *
 * The worker (`spend-down-worker`) does the dispatching; these routes only
 * read and store settings.
 */

import type { Context, Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { requireFeature } from '../../_shared/entitlements.ts'
import { logAudit } from '../../_shared/audit.ts'
import { dbError, resolveOwnedProject } from '../shared.ts'
import { byokKeyIdSchema } from '../../_shared/byok-validation.ts'
import { canManageSharedKeys, keyOwnerFilter } from '../../_shared/byok-scope.ts'
import { parseByokExpiry } from '../../_shared/byok-expiry.ts'
import { parseCursorModelSpec } from '../../_shared/cursor-cloud.ts'
import {
  SPEND_DOWN_DEFAULT_DAILY_LIMIT,
  SPEND_DOWN_DEFAULT_WINDOW_DAYS,
  SPEND_DOWN_SCOREBOARD_DAYS,
  remainingToday,
  spendDownScoreboard,
  spendDownStopLoss,
  spendDownWindow,
  type SpendDownKey,
  type SpendDownStopLoss,
} from '../../_shared/spend-down.ts'
import { keyDispatchesToday, keyProjects, keyScoreboardRuns, projectYieldSamples } from '../../_shared/spend-down-db.ts'

const KEY_COLUMNS =
  'id, label, key_hint, provider_slug, project_id, organization_id, status, credits_expire_at, spend_down_enabled, spend_down_model, spend_down_daily_limit, spend_down_window_days, spend_down_last_run_at, spend_down_last_summary'

type KeyRow = SpendDownKey & {
  label: string | null
  key_hint: string | null
  spend_down_last_run_at: string | null
  spend_down_last_summary: unknown
}

function bad(c: Context, code: string, message: string, status: 400 | 403 | 404 = 400) {
  return c.json({ ok: false, error: { code, message } }, status)
}

/** Shared keys: organization owner or admin, in the console only (ADR 0023). */
async function canManageOrgKeys(c: Context, db: ReturnType<typeof getServiceClient>, orgId: string): Promise<boolean> {
  if (c.get('authMethod') !== 'jwt') return false
  const userId = c.get('userId') as string | undefined
  if (!userId) return false
  const { data, error } = await db
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return false
  return canManageSharedKeys((data?.role as string | undefined) ?? null)
}

export function registerByokSpendDownRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/byok/spend-down', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()
    const apiKeyProjectId = c.get('authMethod') === 'apiKey' ? (c.get('projectId') as string | undefined) : undefined
    const resolved = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: { keys: [] } }),
      ...(apiKeyProjectId ? { overrideProjectId: apiKeyProjectId } : {}),
    })
    if ('response' in resolved) return resolved.response
    const project = resolved.project

    const { data, error } = await db
      .from('byok_keys')
      .select(KEY_COLUMNS)
      .eq('provider_slug', 'cursor')
      .or(keyOwnerFilter({ projectId: project.id, organizationId: (project.organization_id as string | null) ?? null }))
    if (error) return dbError(c, error)

    const now = new Date()
    const keys = []
    for (const row of (data ?? []) as KeyRow[]) {
      const window = spendDownWindow(row, now)
      let dispatchedToday = 0
      let projects: Array<{ id: string; name: string; stopLoss: SpendDownStopLoss }> = []
      let scoreboard: ReturnType<typeof spendDownScoreboard> & { days: number; since: string }
      try {
        dispatchedToday = await keyDispatchesToday(db, row.id, now)
        const served = await keyProjects(db, row)
        if (served.ids.length > 0) {
          const { data: names } = await db.from('projects').select('id, name').in('id', served.ids)
          projects = await Promise.all(
            ((names ?? []) as Array<{ id: string; name: string }>).map(async (p) => ({
              id: p.id,
              name: p.name,
              stopLoss: spendDownStopLoss(await projectYieldSamples(db, p.id)),
            })),
          )
        }
        scoreboard = {
          days: SPEND_DOWN_SCOREBOARD_DAYS,
          since: new Date(now.getTime() - SPEND_DOWN_SCOREBOARD_DAYS * 86_400_000).toISOString(),
          ...spendDownScoreboard(await keyScoreboardRuns(db, row.id, now)),
        }
      } catch (err) {
        return c.json({ ok: false, error: { code: 'DB_ERROR', message: err instanceof Error ? err.message : String(err) } }, 500)
      }
      keys.push({
        id: row.id,
        label: row.label,
        keyHint: row.key_hint,
        scope: row.organization_id ? 'organization' : 'project',
        status: row.status,
        enabled: row.spend_down_enabled,
        creditsExpireAt: row.credits_expire_at,
        model: row.spend_down_model,
        dailyLimit: row.spend_down_daily_limit,
        windowDays: row.spend_down_window_days,
        state: window.state,
        startsAt: window.startsAt,
        dispatchedToday,
        remainingToday: window.state === 'active' ? remainingToday(row, dispatchedToday) : 0,
        projects,
        scoreboard,
        lastRunAt: row.spend_down_last_run_at,
        lastSummary: row.spend_down_last_summary ?? null,
      })
    }
    return c.json({ ok: true, data: { projectId: project.id, keys } })
  })

  app.patch(
    '/v1/admin/byok/keys/:keyId/spend-down',
    adminOrApiKey({ scope: 'mcp:write' }),
    requireFeature('byok'),
    async (c) => {
      const userId = c.get('userId') as string
      const keyId = c.req.param('keyId')!
      if (!byokKeyIdSchema.safeParse(keyId).success) return bad(c, 'INVALID_KEY_ID', 'keyId must be a UUID.')
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>

      const patch: Record<string, unknown> = {}
      if (body.enabled !== undefined) {
        if (typeof body.enabled !== 'boolean') return bad(c, 'VALIDATION_ERROR', 'enabled must be true or false.')
        patch.spend_down_enabled = body.enabled
      }
      if (body.creditsExpireAt !== undefined) {
        const expiry = parseByokExpiry(body.creditsExpireAt)
        if (!expiry.ok) return bad(c, 'INVALID_EXPIRY', expiry.message)
        patch.credits_expire_at = expiry.value
      }
      if (body.model !== undefined) {
        if (body.model === null || body.model === '') patch.spend_down_model = null
        else if (typeof body.model !== 'string' || !parseCursorModelSpec(body.model)) {
          return bad(c, 'INVALID_CURSOR_MODEL', 'model must be a Cursor model id, optionally with ?param=value pairs.')
        } else patch.spend_down_model = body.model.trim()
      }
      for (const [field, column, min, max] of [
        ['dailyLimit', 'spend_down_daily_limit', 1, 200],
        ['windowDays', 'spend_down_window_days', 1, 90],
      ] as const) {
        if (body[field] === undefined) continue
        const n = body[field]
        if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
          return bad(c, 'VALIDATION_ERROR', `${field} must be a whole number from ${min} to ${max}.`)
        }
        patch[column] = n
      }
      if (Object.keys(patch).length === 0) return bad(c, 'VALIDATION_ERROR', 'Nothing to change.')

      const db = getServiceClient()
      const apiKeyProjectId = c.get('authMethod') === 'apiKey' ? (c.get('projectId') as string | undefined) : undefined
      const resolved = await resolveOwnedProject(c, db, userId, apiKeyProjectId ? { overrideProjectId: apiKeyProjectId } : {})
      if ('response' in resolved) return resolved.response
      const project = resolved.project
      const orgId = (project.organization_id as string | null) ?? null

      const { data: key, error: keyErr } = await db
        .from('byok_keys')
        .select('id, provider_slug, project_id, organization_id, credits_expire_at')
        .eq('id', keyId)
        .or(keyOwnerFilter({ projectId: project.id, organizationId: orgId }))
        .maybeSingle()
      if (keyErr) return dbError(c, keyErr)
      if (!key) return bad(c, 'NOT_FOUND', 'No such key for this app.', 404)
      if (key.provider_slug !== 'cursor') {
        return bad(c, 'NOT_CURSOR_KEY', 'Spend-down works with Cursor keys only.')
      }
      if (key.organization_id) {
        if (!(await canManageOrgKeys(c, db, key.organization_id as string))) {
          return bad(c, 'SHARED_KEY_ADMIN_ONLY', 'Only an organization owner or admin can change a shared key, in the console.', 403)
        }
      } else {
        const role = (project as { organization_role?: string | null }).organization_role ?? null
        if (role !== 'owner' && role !== 'admin') {
          return bad(c, 'FORBIDDEN', "Only this app's owner or admin can change its key.", 403)
        }
      }
      const willBeEnabled = (patch.spend_down_enabled as boolean | undefined) ?? undefined
      const expiryAfter = 'credits_expire_at' in patch ? patch.credits_expire_at : key.credits_expire_at
      if (willBeEnabled === true && !expiryAfter) {
        return bad(c, 'EXPIRY_REQUIRED', 'Set the date the credits expire before turning spend-down on.')
      }
      if (willBeEnabled === undefined && 'credits_expire_at' in patch && !expiryAfter) {
        // Clearing the date turns spend-down off: the database refuses on-without-a-date.
        patch.spend_down_enabled = false
      }

      const { data, error } = await db
        .from('byok_keys')
        .update(patch)
        .eq('id', keyId)
        .select('id, spend_down_enabled, credits_expire_at, spend_down_model, spend_down_daily_limit, spend_down_window_days')
        .maybeSingle()
      if (error) return dbError(c, error)
      if (!data) return bad(c, 'NOT_FOUND', 'No such key for this app.', 404)

      await logAudit(db, project.id, userId, 'settings.updated', 'byok', keyId, {
        provider: 'cursor',
        spendDown: patch,
      }).catch(() => {})
      return c.json({
        ok: true,
        data: {
          id: data.id,
          enabled: data.spend_down_enabled,
          creditsExpireAt: data.credits_expire_at,
          model: data.spend_down_model,
          dailyLimit: data.spend_down_daily_limit ?? SPEND_DOWN_DEFAULT_DAILY_LIMIT,
          windowDays: data.spend_down_window_days ?? SPEND_DOWN_DEFAULT_WINDOW_DAYS,
        },
      })
    },
  )
}
