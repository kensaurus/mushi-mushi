/**
 * portfolio-funnel.ts — the cross-app funnel rollup (Plan 020 §8).
 *
 *   GET /v1/admin/orgs/:orgId/funnel   adminOrApiKey(mcp:read)  one funnel, every app, side by side
 *   PUT /v1/admin/orgs/:orgId/funnel   adminOrApiKey(mcp:write), owner/admin  set the org's funnel (event names + window)
 *
 * One definition per organization (org_funnel_definitions), run per app over
 * the existing public.product_funnel RPC, so every app is measured the same
 * way. Each app row says what it is: `ok` with step counts, `off` when the
 * app turned product events off, `no_events` when nothing entered the first
 * step, or `error`. An org with no definition is `not_set_up`, never zeros.
 *
 * Both routes take the console JWT or an account-level API key; a key bound
 * to one project is refused by portfolioAccess, and the PUT also needs the
 * key owner to be a team owner or admin.
 */

import type { Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { mapBounded } from '../../_shared/portfolio.ts'
import { jsonError } from '../shared.ts'
import type { Variables } from '../types.ts'
import { FUNNEL_WINDOWS, type FunnelWindow } from './events-admin.ts'
import { portfolioAccess } from './portfolio.ts'

const flog = log.child('portfolio-funnel')
const MAX_APPS = 50

type Db = ReturnType<typeof getServiceClient>

export interface FunnelRouteDeps {
  getServiceClient: () => Db
  adminOrApiKeyRead: MiddlewareHandler
  adminOrApiKeyWrite: MiddlewareHandler
  now: () => Date
}

export const defaultFunnelDeps: FunnelRouteDeps = {
  getServiceClient,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  adminOrApiKeyWrite: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  now: () => new Date(),
}

const EVENT = /^[a-z][a-z0-9_]{1,63}$/

const definitionSchema = z.object({
  steps: z.array(z.string().regex(EVENT, 'event names are lowercase letters, digits and _')).min(2).max(8)
    .refine((s) => new Set(s).size === s.length, 'each step must be a different event'),
  window: z.enum(['1d', '7d', '30d']).default('7d'),
  lookbackDays: z.number().int().min(1).max(365).default(30),
}).strict()

interface DefinitionRow { steps: string[]; conversion_window: FunnelWindow; lookback_days: number; updated_at: string }

export interface FunnelStep { name: string; entered: number; converted: number; pct: number }

export interface FunnelAppRow {
  projectId: string
  name: string
  state: 'ok' | 'off' | 'no_events' | 'error'
  steps: FunnelStep[]
  /** Last step converted / first step entered, in %. null when nothing entered. */
  overallPct: number | null
}

function overall(steps: FunnelStep[]): number | null {
  const first = steps[0]?.converted ?? 0
  if (!first) return null
  return Math.round((1000 * (steps[steps.length - 1]?.converted ?? 0)) / first) / 10
}

async function isOrgAdmin(db: Db, orgId: string, userId: string): Promise<boolean> {
  const { data } = await db.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', userId).maybeSingle()
  const role = (data as { role?: string } | null)?.role
  return role === 'owner' || role === 'admin'
}

export function registerPortfolioFunnelRoutes(app: Hono<{ Variables: Variables }>, deps: FunnelRouteDeps = defaultFunnelDeps): void {
  app.get('/v1/admin/orgs/:orgId/funnel', deps.adminOrApiKeyRead, async (c) => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    const { data: def, error: defError } = await db.from('org_funnel_definitions').select('steps, conversion_window, lookback_days, updated_at').eq('organization_id', access.orgId).maybeSingle()
    if (defError) return jsonError(c, 'DB_ERROR', 'The funnel definition could not be read.', 500)
    const definition = def as DefinitionRow | null
    if (!definition) return c.json({ ok: true, data: { state: 'not_set_up', definition: null, rows: [] } })

    const ids = access.projectIds.slice(0, MAX_APPS)
    const [projectsRes, settingsRes] = await Promise.all([
      db.from('projects').select('id, name').in('id', ids),
      db.from('project_settings').select('project_id, product_events_enabled').in('project_id', ids),
    ])
    // Without these, an app with events off would be run as if they were on.
    if (projectsRes.error || settingsRes.error) return jsonError(c, 'DB_ERROR', 'The funnel could not be read. Try again in a minute.', 500)
    const projects = projectsRes.data
    const settings = settingsRes.data
    const enabled = new Map(((settings ?? []) as Array<{ project_id: string; product_events_enabled: boolean | null }>).map((s) => [s.project_id, s.product_events_enabled ?? true]))
    const to = deps.now()
    const from = new Date(to.getTime() - definition.lookback_days * 86400_000)
    const rows = await mapBounded(((projects ?? []) as Array<{ id: string; name: string | null }>), 4, async (p): Promise<FunnelAppRow> => {
      const base = { projectId: p.id, name: p.name ?? p.id.slice(0, 8) }
      if (enabled.get(p.id) === false) return { ...base, state: 'off', steps: [], overallPct: null }
      const { data, error } = await db.rpc('product_funnel', {
        p_project_id: p.id,
        p_steps: definition.steps,
        p_from: from.toISOString(),
        p_to: to.toISOString(),
        p_window: FUNNEL_WINDOWS[definition.conversion_window],
        p_breakdown: null,
      })
      if (error) {
        flog.warn('product_funnel failed', { projectId: p.id, err: error.message })
        return { ...base, state: 'error', steps: [], overallPct: null }
      }
      const steps = (((data as { steps?: FunnelStep[] } | null)?.steps) ?? []).map((s) => ({ name: s.name, entered: Number(s.entered ?? 0), converted: Number(s.converted ?? 0), pct: Number(s.pct ?? 0) }))
      const pct = overall(steps)
      return { ...base, state: pct === null ? 'no_events' : 'ok', steps, overallPct: pct }
    })
    return c.json({
      ok: true,
      data: {
        state: 'ok',
        definition: { steps: definition.steps, window: definition.conversion_window, lookbackDays: definition.lookback_days, updatedAt: definition.updated_at },
        from: from.toISOString(),
        to: to.toISOString(),
        rows: rows.sort((a, b) => (b.overallPct ?? -1) - (a.overallPct ?? -1)),
      },
    })
  })

  app.put('/v1/admin/orgs/:orgId/funnel', deps.adminOrApiKeyWrite, async (c) => {
    const db = deps.getServiceClient()
    const access = await portfolioAccess(c, db, c.req.param('orgId') ?? '')
    if (!access.ok) return access.response
    const userId = c.get('userId') as string
    if (!(await isOrgAdmin(db, access.orgId, userId))) return jsonError(c, 'FORBIDDEN', 'Only team owners and admins can change the funnel.', 403)
    const parsed = definitionSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), 400)
    const row = { organization_id: access.orgId, steps: parsed.data.steps, conversion_window: parsed.data.window, lookback_days: parsed.data.lookbackDays, updated_by: userId, updated_at: deps.now().toISOString() }
    const { error } = await db.from('org_funnel_definitions').upsert(row, { onConflict: 'organization_id' })
    if (error) return jsonError(c, 'DB_ERROR', 'The funnel could not be saved.', 500)
    return c.json({ ok: true, data: { steps: row.steps, window: row.conversion_window, lookbackDays: row.lookback_days, updatedAt: row.updated_at } })
  })
}
