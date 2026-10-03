/**
 * store-review-intake.ts — store reviews as reports (gap #23, Plan 020 §5).
 *
 *   GET  /v1/admin/projects/:id/store/reviews            adminOrApiKey(mcp:read)   settings, bound stores, recent reviews seen
 *   PUT  /v1/admin/projects/:id/store/reviews/settings   jwtAuth, owner/admin      opt in or out, star threshold
 *   POST /v1/admin/projects/:id/store/reviews/pull       adminOrApiKey(mcp:write)  pull now (1 per 10 min), not viewers
 *
 * Off by default. Switching it on is console-only (JWT) and limited to owners
 * and admins: it decides that reviews from the public become reports in the
 * queue. A viewer cannot pull either, since a pull spends the stored store
 * keys and files reports. Reads go through the project's existing App Store
 * Connect / Google Play connectors, read-only.
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { queueReportClassification } from '../../_shared/report-classification.ts'
import { DEFAULT_MAX_RATING, loadStoreSources, runStoreReviewIntake, type StoreIntakeDeps } from '../../_shared/store-review-intake.ts'
import { callerCanAccessProject, jsonError } from '../shared.ts'
import type { Variables } from '../types.ts'

const rlog = log.child('store-review-intake')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const STORE_REVIEW_PULL_COOLDOWN_MS = 10 * 60 * 1000

type Db = ReturnType<typeof getServiceClient>

export interface StoreReviewRouteDeps {
  getServiceClient: () => Db
  adminOrApiKeyRead: MiddlewareHandler
  adminOrApiKeyWrite: MiddlewareHandler
  jwtAuth: MiddlewareHandler
  intake: StoreIntakeDeps
}

export const defaultStoreReviewDeps: StoreReviewRouteDeps = {
  getServiceClient,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  adminOrApiKeyWrite: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  jwtAuth: jwtAuth as MiddlewareHandler,
  intake: {
    fetch: (url, init) => fetch(url, init),
    now: () => new Date(),
    classify: (db, reportId, projectId) => queueReportClassification(db as never, reportId, projectId),
  },
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  maxRating: z.number().int().min(1).max(5).optional(),
}).strict()

interface SettingsRow {
  store_review_intake_enabled: boolean | null
  store_review_max_rating: number | null
  store_review_last_pulled_at: string | null
  store_review_last_status: string | null
  store_review_last_error: string | null
}

const SETTINGS_COLUMNS = 'store_review_intake_enabled, store_review_max_rating, store_review_last_pulled_at, store_review_last_status, store_review_last_error'

function toWire(row: SettingsRow | null) {
  return {
    enabled: row?.store_review_intake_enabled ?? false,
    maxRating: row?.store_review_max_rating ?? DEFAULT_MAX_RATING,
    lastPulledAt: row?.store_review_last_pulled_at ?? null,
    lastStatus: row?.store_review_last_status ?? null,
    lastError: row?.store_review_last_error ?? null,
  }
}

type ProjectRole = 'owner' | 'admin' | 'member' | 'viewer'

async function access(c: Context, db: Db): Promise<{ ok: true; projectId: string; role: ProjectRole } | { ok: false; response: Response }> {
  const projectId = c.req.param('id') ?? ''
  if (!UUID_RE.test(projectId)) return { ok: false, response: jsonError(c, 'NOT_FOUND', 'Project not found', 404) }
  const a = await callerCanAccessProject(c, db, c.get('userId') as string, projectId)
  return a.allowed && a.role ? { ok: true, projectId, role: a.role } : { ok: false, response: jsonError(c, 'NOT_FOUND', 'Project not found', 404) }
}

/** Owners and admins decide whether public reviews become reports. */
const canManageStoreReviews = (role: ProjectRole): boolean => role === 'owner' || role === 'admin'

export function registerStoreReviewIntakeRoutes(app: Hono<{ Variables: Variables }>, deps: StoreReviewRouteDeps = defaultStoreReviewDeps): void {
  app.get('/v1/admin/projects/:id/store/reviews', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const a = await access(c, db)
    if (!a.ok) return a.response
    const [settingsRes, recentRes] = await Promise.all([
      db.from('project_settings').select(SETTINGS_COLUMNS).eq('project_id', a.projectId).maybeSingle(),
      db.from('store_review_items').select('store, review_id, rating, report_id, review_created_at, seen_at').eq('project_id', a.projectId).order('seen_at', { ascending: false }).limit(20),
    ])
    if (settingsRes.error || recentRes.error) return jsonError(c, 'DB_ERROR', 'The store review intake could not be read. Try again in a minute.', 500)
    let sources: Array<{ store: string; appId: string; connected: boolean }>
    try {
      sources = (await loadStoreSources(db, a.projectId, deps.intake)).map((s) => ({ store: s.store, appId: s.appId, connected: Boolean(s.ctx.readCredential) }))
    } catch (err) {
      rlog.warn('store sources read failed', { projectId: a.projectId, err: (err as Error)?.message })
      return jsonError(c, 'DB_ERROR', 'The store connections could not be read. Try again in a minute.', 500)
    }
    const recent = ((recentRes.data ?? []) as Array<{ store: string; review_id: string; rating: number | null; report_id: string | null; review_created_at: string | null; seen_at: string }>).map((r) => ({
      store: r.store,
      reviewId: r.review_id,
      rating: r.rating,
      reportId: r.report_id,
      reviewCreatedAt: r.review_created_at,
      seenAt: r.seen_at,
    }))
    return c.json({
      ok: true,
      data: { projectId: a.projectId, settings: toWire(settingsRes.data as SettingsRow | null), sources, recent, canManage: canManageStoreReviews(a.role), canPull: a.role !== 'viewer' },
    })
  })

  app.put('/v1/admin/projects/:id/store/reviews/settings', deps.jwtAuth, async (c) => {
    const db = deps.getServiceClient()
    const a = await access(c, db)
    if (!a.ok) return a.response
    if (!canManageStoreReviews(a.role)) return jsonError(c, 'FORBIDDEN', 'Only owners and admins can change store review intake.', 403)
    const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), 400)
    const patch: Record<string, unknown> = { store_review_intake_enabled: parsed.data.enabled }
    if (parsed.data.maxRating !== undefined) patch.store_review_max_rating = parsed.data.maxRating
    const { data, error } = await db.from('project_settings').update(patch).eq('project_id', a.projectId).select(SETTINGS_COLUMNS)
    if (error) return jsonError(c, 'DB_ERROR', 'The setting could not be saved.', 500)
    const row = ((data ?? []) as SettingsRow[])[0] ?? null
    if (!row) return jsonError(c, 'NOT_FOUND', 'This app has no settings row yet. Open its settings once, then try again.', 404)
    return c.json({ ok: true, data: toWire(row) })
  })

  app.post('/v1/admin/projects/:id/store/reviews/pull', deps.adminOrApiKeyWrite, async (c) => {
    const db = deps.getServiceClient()
    const a = await access(c, db)
    if (!a.ok) return a.response
    if (a.role === 'viewer') return jsonError(c, 'FORBIDDEN', 'Viewers cannot pull store reviews.', 403)
    const { data, error } = await db.from('project_settings').select(SETTINGS_COLUMNS).eq('project_id', a.projectId).maybeSingle()
    if (error) return jsonError(c, 'DB_ERROR', 'The store review intake could not be read.', 500)
    const row = data as SettingsRow | null
    if (!row?.store_review_intake_enabled) return jsonError(c, 'INTAKE_OFF', 'Turn on store reviews as reports for this app first.', 400)
    const now = deps.intake.now()
    if (row.store_review_last_pulled_at && now.getTime() - Date.parse(row.store_review_last_pulled_at) < STORE_REVIEW_PULL_COOLDOWN_MS) {
      return jsonError(c, 'RATE_LIMITED', 'Reviews were pulled a few minutes ago. Try again shortly.', 429)
    }
    try {
      const result = await runStoreReviewIntake(db, a.projectId, deps.intake)
      return c.json({ ok: true, data: result })
    } catch (err) {
      rlog.error('store review pull failed', { projectId: a.projectId, err: (err as Error)?.message })
      return jsonError(c, 'PULL_FAILED', 'The reviews could not be pulled.', 500)
    }
  })
}
