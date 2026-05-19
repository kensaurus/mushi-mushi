// costs.ts — LLM cost tracking admin endpoints
//
// Admin:
//   GET /v1/admin/costs           — list llm_cost_usd rows for a project
//   GET /v1/admin/costs/summary   — aggregated cost by operation + model + day
//
// Cross-cutting Phase — Mushi closed-loop evolution

import { Hono } from 'npm:hono@4'
import { requireAuth } from '../middleware/auth.ts'
import { requireProjectAccess } from '../middleware/project.ts'
import { getServiceClient } from '../../_shared/db.ts'
import type { Variables } from '../types.ts'

function db() { return getServiceClient() }

export function registerCostsRoutes(parent: Hono<{ Variables: Variables }>) {
  const r = new Hono<{ Variables: Variables }>()
  r.use('*', requireAuth, requireProjectAccess)

  r.get('/', async (c) => {
    const projectId = c.req.query('project_id')
    if (!projectId) return c.json({ ok: false, error: { code: 'ERROR', message: 'project_id required' } }, 400)
    const page = parseInt(c.req.query('page') ?? '1', 10)
    const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10), 500)
    const { data, error, count } = await db()
      .from('llm_cost_usd')
      .select('*', { count: 'exact' })
      .eq('project_id', projectId)
      .order('occurred_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data, total: count, page, limit })
  })

  r.get('/summary', async (c) => {
    const projectId = c.req.query('project_id')
    if (!projectId) return c.json({ ok: false, error: { code: 'ERROR', message: 'project_id required' } }, 400)

    // Fetch raw rows and aggregate in JS — llm_cost_usd is a low-cardinality
    // table so this is cheap and avoids a raw-SQL RPC.
    const { data: rows, error } = await db()
      .from('llm_cost_usd')
      .select('occurred_at, operation, model, cost_usd')
      .eq('project_id', projectId)
      .order('occurred_at', { ascending: false })
      .limit(2000)
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)

    // Group by day × operation × model
    const agg = new Map<string, { day: string; operation: string; model: string; total_cost_usd: number; calls: number }>()
    for (const row of (rows ?? [])) {
      const day = row.occurred_at?.slice(0, 10) ?? 'unknown'
      const key = `${day}|${row.operation}|${row.model}`
      const existing = agg.get(key)
      if (existing) {
        existing.total_cost_usd += row.cost_usd ?? 0
        existing.calls += 1
      } else {
        agg.set(key, { day, operation: row.operation, model: row.model, total_cost_usd: row.cost_usd ?? 0, calls: 1 })
      }
    }
    const data = Array.from(agg.values()).sort((a, b) => b.day.localeCompare(a.day))
    return c.json({ ok: true, data })
  })

  parent.route('/v1/admin/costs', r)
}
