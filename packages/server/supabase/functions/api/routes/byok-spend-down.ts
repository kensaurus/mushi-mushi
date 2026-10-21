/**
 * FILE: packages/server/supabase/functions/api/routes/byok-spend-down.ts
 * PURPOSE: Spend-down mode settings and status for Cursor keys (ADR 0028).
 *
 *   GET   /v1/admin/byok/spend-down                 every Cursor key this app
 *         can use, with its spend-down settings, window, today's count, the
 *         apps it pays for that the caller can open (each with its stop-loss
 *         state), the last 7 days' scoreboard (key-wide totals; rows for the
 *         caller's apps: runs → PRs → Opus verdicts → merged, latest review
 *         cost per PR) and the last worker tick. `mcp:read`.
 *   POST  /v1/admin/byok/spend-down/projects/:projectId/resume  clear the
 *         stop-loss for one app (samples before now are ignored). Console
 *         only (jwtAuth), the app's owner or admin.
 *   PATCH /v1/admin/byok/keys/:keyId/spend-down     turn it on or off and set
 *         the credit expiry, model, daily limit and window. A shared key is
 *         an organization owner's or admin's call in the console (ADR 0023);
 *         a universal key only its owner's, in the console (ADR 0031); an
 *         app's own key is its owner's or admin's. `mcp:write`.
 *
 * The worker (`spend-down-worker`) does the dispatching; these routes only
 * read and store settings.
 */

import type { Context, Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts'
import { requireFeature } from '../../_shared/entitlements.ts'
import { logAudit } from '../../_shared/audit.ts'
import { dbError, resolveOwnedProject, userCanAccessProject } from '../shared.ts'
import { byokKeyIdSchema } from '../../_shared/byok-validation.ts'
import {
  canManageSharedKeys,
  keyOwnerFilter,
  keyOwnerForProject,
  ownerUserColumnReady,
  rowScope,
  withOwnerUserColumn,
} from '../../_shared/byok-scope.ts'
import { parseByokExpiry } from '../../_shared/byok-expiry.ts'
import { parseCursorModelSpec } from '../../_shared/cursor-cloud.ts'
import {
  SPEND_DOWN_DEFAULT_DAILY_LIMIT,
  SPEND_DOWN_DEFAULT_WINDOW_DAYS,
  SPEND_DOWN_SCOREBOARD_DAYS,
  remainingToday,
  effectiveStopLossResets,
  previousPauseStates,
  spendDownScoreboard,
  spendDownStopLoss,
  scopeSpendDownView,
  spendDownWindow,
  type SpendDownKey,
  type SpendDownStopLoss,
} from '../../_shared/spend-down.ts'
import {
  cachedYieldSamples,
  keyDispatchesToday,
  keyProjects,
  keyScoreboardRuns,
  stopLossResets,
  type SpendDownYieldCache,
} from '../../_shared/spend-down-db.ts'

/** owner_user_id is added by withOwnerUserColumn once migration 20261021090000 is applied. */
const KEY_COLUMNS =
  'id, label, key_hint, provider_slug, project_id, organization_id, status, credits_expire_at, spend_down_enabled, spend_down_model, spend_down_daily_limit, spend_down_window_days, spend_down_last_run_at, spend_down_last_summary'

/**
 * The apps a caller may see a universal key pay for when they do not own it:
 * those of the requesting app's organization, or the app alone (ADR 0031).
 */
async function sameOrganizationProjectIds(
  db: ReturnType<typeof getServiceClient>,
  project: { id: string; organization_id?: string | null },
): Promise<Set<string>> {
  const orgId = (project.organization_id as string | null | undefined) ?? null
  if (!orgId) return new Set([project.id])
  const { data } = await db.from('projects').select('id').eq('organization_id', orgId)
  return new Set([project.id, ...((data ?? []) as Array<{ id: string }>).map((p) => p.id)])
}

type KeyRow = SpendDownKey & {
  label: string | null
  key_hint: string | null
  spend_down_last_run_at: string | null
  spend_down_last_summary: unknown
}

function bad(c: Context, code: string, message: string, status: 400 | 403 | 404 = 400) {
  return c.json({ ok: false, error: { code, message } }, status)
}

/** The last tick's summary with only the apps the caller can open. */
function visibleSummary(summary: unknown, visible: Set<string>): unknown {
  if (!summary || typeof summary !== 'object') return summary ?? null
  const projects = (summary as { projects?: unknown }).projects
  if (!Array.isArray(projects)) return summary
  return {
    ...(summary as Record<string, unknown>),
    projects: projects.filter((p) => visible.has(String((p as { projectId?: unknown })?.projectId))),
  }
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
    const isApiKey = c.get('authMethod') === 'apiKey'
    const apiKeyProjectId = isApiKey ? (c.get('projectId') as string | undefined) : undefined
    const resolved = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: { keys: [] } }),
      ...(apiKeyProjectId ? { overrideProjectId: apiKeyProjectId } : {}),
    })
    if ('response' in resolved) return resolved.response
    const project = resolved.project

    const { data, error } = await db
      .from('byok_keys')
      .select(withOwnerUserColumn(KEY_COLUMNS, await ownerUserColumnReady(db)))
      .eq('provider_slug', 'cursor')
      // Own, organization (ADR 0023) and universal keys of its owners (ADR 0031).
      .or(keyOwnerFilter(await keyOwnerForProject(db, project)))
    if (error) return dbError(c, error)

    // A shared key pays for apps across the organization. Per-app detail
    // (names, stop-loss, scoreboard rows, last-tick stops) is limited to the
    // apps this caller can open: an API key its own app only, a console user
    // the apps they own or are a member of. Key-wide counts (today's
    // dispatches, the scoreboard totals) stay key-wide, as dispatchedToday
    // always was.
    // Role per app, for a console user: Resume is shown to owners and admins only.
    const access = new Map<string, Promise<string | null>>()
    const roleIn = (projectId: string): Promise<string | null> => {
      if (isApiKey) return Promise.resolve(projectId === (apiKeyProjectId ?? project.id) ? 'api_key' : null)
      let hit = access.get(projectId)
      if (!hit) {
        hit = userCanAccessProject(db, userId, projectId)
          .then((r) => (r.allowed ? r.role ?? 'member' : null))
          .catch(() => null)
        access.set(projectId, hit)
      }
      return hit
    }

    const now = new Date()
    const yieldCache: SpendDownYieldCache = new Map()
    const keys = []
    let sameOrg: Set<string> | null = null
    for (const row of (data ?? []) as unknown as KeyRow[]) {
      const window = spendDownWindow(row, now)
      const ownedByMe = Boolean(row.owner_user_id) && c.get('authMethod') === 'jwt' && userId === row.owner_user_id
      // Someone else's universal key spans its owner's organizations: on top
      // of the apps this caller can open, they see only this organization's
      // apps and its share of the counts (ADR 0031).
      const foreignUniversal = Boolean(row.owner_user_id) && !ownedByMe
      if (foreignUniversal && !sameOrg) sameOrg = await sameOrganizationProjectIds(db, project)
      const inScope = (id: string) => !foreignUniversal || (sameOrg?.has(id) ?? false)
      let dispatchedToday = 0
      let served: string[] = []
      try {
        served = (await keyProjects(db, row)).ids
        dispatchedToday = await keyDispatchesToday(db, row.id, now, foreignUniversal ? [...(sameOrg ?? [])] : undefined)
      } catch (err) {
        return c.json({ ok: false, error: { code: 'DB_ERROR', message: err instanceof Error ? err.message : String(err) } }, 500)
      }
      const visible = new Set<string>()
      const roles = new Map<string, string>()
      for (const id of served) {
        if (!inScope(id)) continue
        const role = await roleIn(id)
        if (role) {
          visible.add(id)
          roles.set(id, role)
        }
      }

      // Stop-loss and scoreboard are evidence, not settings: a failed read
      // degrades that part of this key to null with a note, never the page.
      let projects: Array<{ id: string; name: string; canResume: boolean; stopLoss: SpendDownStopLoss | null }> = []
      let stopLossNote: string | null = null
      let projectsNote: string | null = null
      if (visible.size > 0) {
        const { data: names, error: namesErr } = await db.from('projects').select('id, name').in('id', [...visible])
        if (namesErr) projectsNote = 'The apps this key pays for could not be read just now.'
        const { resets, error: resetErr } = await stopLossResets(db, [...visible])
        if (resetErr) stopLossNote = 'Resume times could not be read; the 14-day limit still applies.'
        const effective = effectiveStopLossResets(resets, row.spend_down_last_summary)
        const previous = previousPauseStates(row.spend_down_last_summary, effective)
        projects = await Promise.all(
          ((names ?? []) as Array<{ id: string; name: string }>).map(async (p) => {
            const role = roles.get(p.id)
            const canResume = role === 'owner' || role === 'admin'
            try {
              const samples = await cachedYieldSamples(yieldCache, db, p.id, now, effective.get(p.id) ?? null)
              const prev = previous.get(p.id) ?? { paused: false, pausedAt: null }
              return { id: p.id, name: p.name, canResume, stopLoss: spendDownStopLoss(samples, prev, now) }
            } catch {
              stopLossNote = 'The yield of some apps could not be read just now.'
              return { id: p.id, name: p.name, canResume, stopLoss: null }
            }
          }),
        )
      }

      let scoreboard: (ReturnType<typeof spendDownScoreboard> & { days: number; since: string }) | null = null
      let scoreboardNote: string | null = null
      try {
        const runs = await keyScoreboardRuns(db, row.id, now)
        // Totals stay key-wide, except on someone else's universal key, where
        // they count this organization's runs only (ADR 0031).
        const board = spendDownScoreboard(foreignUniversal ? runs.filter((r) => inScope(r.projectId)) : runs)
        scoreboard = {
          days: SPEND_DOWN_SCOREBOARD_DAYS,
          since: new Date(now.getTime() - SPEND_DOWN_SCOREBOARD_DAYS * 86_400_000).toISOString(),
          totals: board.totals,
          rows: board.rows.filter((r) => visible.has(r.projectId)),
        }
      } catch {
        scoreboardNote = 'The last 7 days could not be read just now.'
      }

      keys.push({
        id: row.id,
        label: row.label,
        keyHint: row.key_hint,
        scope: rowScope(row),
        // A universal key is changed only by its owner (ADR 0031); never says who that is.
        ...(row.owner_user_id ? { ownedByMe } : {}),
        status: row.status,
        enabled: row.spend_down_enabled,
        creditsExpireAt: row.credits_expire_at,
        model: row.spend_down_model,
        dailyLimit: row.spend_down_daily_limit,
        windowDays: row.spend_down_window_days,
        state: window.state,
        startsAt: window.startsAt,
        dispatchedToday,
        // The key-wide remainder is its owner's to see (ADR 0031).
        remainingToday: foreignUniversal ? null : window.state === 'active' ? remainingToday(row, dispatchedToday) : 0,
        projects,
        /** Apps this key pays for that the caller cannot open (in this organization, for someone else's universal key). */
        otherApps: served.filter(inScope).length - visible.size,
        projectsNote,
        stopLossNote,
        scoreboard,
        scoreboardNote,
        lastRunAt: row.spend_down_last_run_at,
        lastSummary: foreignUniversal
          ? scopeSpendDownView({
              keyIsUniversal: true,
              callerOwnsKey: false,
              visibleProjectIds: visible,
              projects: [],
              lastSummary: row.spend_down_last_summary ?? null,
            }).lastSummary
          : visibleSummary(row.spend_down_last_summary, visible),
      })
    }
    return c.json({ ok: true, data: { projectId: project.id, keys } })
  })

  /**
   * Resume a paused app by hand: stamps project_settings.
   * spend_down_stop_loss_reset_at, so the stop-loss ignores every sample
   * dispatched before it and the app is back in cold start (no rule decides
   * under 20 new samples). Per app, not per key: the samples are the app's
   * spend-down runs under any key, so the reset belongs to the app. A
   * decision to spend again, so console only, by the app's owner or admin.
   */
  app.post('/v1/admin/byok/spend-down/projects/:projectId/resume', jwtAuth, requireFeature('byok'), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('projectId')!
    if (!byokKeyIdSchema.safeParse(projectId).success) return bad(c, 'INVALID_PROJECT_ID', 'projectId must be a UUID.')
    const db = getServiceClient()
    let role: string | null = null
    try {
      role = (await userCanAccessProject(db, userId, projectId)).role
    } catch (err) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: err instanceof Error ? err.message : String(err) } }, 500)
    }
    if (!role) return bad(c, 'NOT_FOUND', 'No such app.', 404)
    if (role !== 'owner' && role !== 'admin') {
      return bad(c, 'FORBIDDEN', "Only this app's owner or admin can resume spend-down on it.", 403)
    }
    const resetAt = new Date().toISOString()
    const { data, error } = await db
      .from('project_settings')
      .update({ spend_down_stop_loss_reset_at: resetAt })
      .eq('project_id', projectId)
      .select('project_id')
      .maybeSingle()
    if (error) {
      if (error.code === '42703' || error.code === 'PGRST204') {
        return c.json(
          { ok: false, error: { code: 'MIGRATION_PENDING', message: 'Resume needs migration 20261021120000_spend_down_stop_loss. Apply it, then retry.' } },
          503,
        )
      }
      return dbError(c, error)
    }
    if (!data) return bad(c, 'NOT_FOUND', 'This app has no settings row yet.', 404)
    await logAudit(db, projectId, userId, 'settings.updated', 'byok', projectId, {
      provider: 'cursor',
      spendDownStopLossResetAt: resetAt,
    }).catch(() => {})
    return c.json({ ok: true, data: { projectId, resetAt } })
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

      const { data: keyData, error: keyErr } = await db
        .from('byok_keys')
        .select(withOwnerUserColumn('id, provider_slug, project_id, organization_id, credits_expire_at', await ownerUserColumnReady(db)))
        .eq('id', keyId)
        .or(keyOwnerFilter(await keyOwnerForProject(db, { id: project.id, organization_id: orgId })))
        .maybeSingle()
      if (keyErr) return dbError(c, keyErr)
      if (!keyData) return bad(c, 'NOT_FOUND', 'No such key for this app.', 404)
      const key = keyData as unknown as {
        provider_slug: string
        organization_id: string | null
        owner_user_id?: string | null
        credits_expire_at: string | null
      }
      if (key.provider_slug !== 'cursor') {
        return bad(c, 'NOT_CURSOR_KEY', 'Spend-down works with Cursor keys only.')
      }
      if (key.owner_user_id) {
        // A universal key pays for every app its owner owns: only that owner, in the console.
        if (c.get('authMethod') !== 'jwt' || userId !== key.owner_user_id) {
          return bad(c, 'UNIVERSAL_KEY_OWNER_ONLY', 'Only the owner of this key can change it, in the console.', 403)
        }
      } else if (key.organization_id) {
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
