/**
 * store-ops.ts — store ops, read side (Plan 020 §5, Phase 2).
 *
 *   GET  /v1/admin/projects/:id/store          adminOrApiKey(mcp:read)   the latest store review (never runs anything)
 *   POST /v1/admin/projects/:id/store/review   adminOrApiKey(mcp:write)  run it now (1 per 30 min; may call the project's AI key)
 *
 * Read-only toward the stores: listings change only through draft PRs the
 * host's CI publishes (recipe changes, element "store").
 */

import type { Context, Hono, MiddlewareHandler } from 'npm:hono@4'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { runStoreReview, STORE_REVIEW_GATE, type StoreOpsDeps } from '../../_shared/store-ops.ts'
import { liveStoreOpsDeps } from '../../_shared/store-ops-live.ts'
import { NOT_LEGAL_ADVICE } from '../../_shared/store-review.ts'
import { callerCanAccessProject, jsonError } from '../shared.ts'
import type { Variables } from '../types.ts'

const slog = log.child('store-ops')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const STORE_REVIEW_COOLDOWN_MS = 30 * 60 * 1000

type Db = ReturnType<typeof getServiceClient>

export interface StoreOpsRouteDeps {
  getServiceClient: () => Db
  adminOrApiKeyRead: MiddlewareHandler
  adminOrApiKeyWrite: MiddlewareHandler
  store: StoreOpsDeps
}

export const defaultStoreOpsDeps: StoreOpsRouteDeps = {
  getServiceClient,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  adminOrApiKeyWrite: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  store: liveStoreOpsDeps,
}

async function access(c: Context, db: Db): Promise<{ ok: true; projectId: string } | { ok: false; response: Response }> {
  const projectId = c.req.param('id') ?? ''
  if (!UUID_RE.test(projectId)) return { ok: false, response: jsonError(c, 'NOT_FOUND', 'Project not found', 404) }
  const a = await callerCanAccessProject(c, db, c.get('userId') as string, projectId)
  return a.allowed ? { ok: true, projectId } : { ok: false, response: jsonError(c, 'NOT_FOUND', 'Project not found', 404) }
}

export function registerStoreOpsRoutes(app: Hono<{ Variables: Variables }>, deps: StoreOpsRouteDeps = defaultStoreOpsDeps): void {
  app.get('/v1/admin/projects/:id/store', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const a = await access(c, db)
    if (!a.ok) return a.response
    const { data: run } = await db.from('gate_runs').select('id, status, summary, completed_at').eq('project_id', a.projectId).eq('gate', STORE_REVIEW_GATE).order('started_at', { ascending: false }).limit(1).maybeSingle()
    if (!run) {
      return c.json({ ok: true, data: { projectId: a.projectId, checkedAt: null, status: 'never_run', results: [], checklist: null, findings: [], note: 'Not checked yet. Run the store review to check the listing against the code and the stores.' } })
    }
    const r = run as { id: string; status: string; summary: Record<string, unknown> | null; completed_at: string | null }
    const { data: findings } = await db.from('gate_findings').select('id, severity, rule_id, message, suggested_fix').eq('gate_run_id', r.id).eq('allowlisted', false).limit(200)
    return c.json({ ok: true, data: { projectId: a.projectId, checkedAt: r.completed_at, status: r.status, results: r.summary?.results ?? [], checklist: r.summary?.checklist ?? null, liveRead: r.summary?.liveRead ?? null, findings: findings ?? [], note: NOT_LEGAL_ADVICE } })
  })

  app.post('/v1/admin/projects/:id/store/review', deps.adminOrApiKeyWrite, async (c) => {
    const db = deps.getServiceClient()
    const a = await access(c, db)
    if (!a.ok) return a.response
    const now = deps.store.now()
    const { data: last } = await db.from('gate_runs').select('started_at').eq('project_id', a.projectId).eq('gate', STORE_REVIEW_GATE).order('started_at', { ascending: false }).limit(1).maybeSingle()
    const lastAt = (last as { started_at?: string } | null)?.started_at
    if (lastAt && now.getTime() - Date.parse(lastAt) < STORE_REVIEW_COOLDOWN_MS) {
      return jsonError(c, 'RATE_LIMITED', 'The store review ran less than 30 minutes ago.', 429)
    }
    try {
      const report = await runStoreReview(db, a.projectId, deps.store, c.get('authMethod') === 'apiKey' ? 'mcp' : 'manual')
      return c.json({ ok: true, data: { ...report, note: NOT_LEGAL_ADVICE } })
    } catch (err) {
      slog.error('store review failed', { projectId: a.projectId, err: (err as Error)?.message })
      return jsonError(c, 'STORE_REVIEW_FAILED', 'The store review could not finish. Try again later.', 500)
    }
  })
}
