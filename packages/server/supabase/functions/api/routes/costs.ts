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
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data, total: count, page, limit })
  })

  r.get('/summary', async (c) => {
    const projectId = c.req.query('project_id')
    if (!projectId) return c.json({ ok: false, error: { code: 'ERROR', message: 'project_id required' } }, 400)

    const { data, error } = await db().rpc('execute_sql', {
      sql: `
        select
          date_trunc('day', created_at) as day,
          operation,
          model,
          sum(cost_usd)::numeric(12,6) as total_cost_usd,
          count(*) as calls
        from llm_cost_usd
        where project_id = '${projectId.replace(/'/g, "''")}'
        group by 1, 2, 3
        order by 1 desc, 4 desc
        limit 200
      `,
    })
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    return c.json({ ok: true, data })
  })

  parent.route('/v1/admin/costs', r)
}
