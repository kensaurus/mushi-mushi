// costs.ts — LLM cost tracking admin endpoints
//
// Admin:
//   GET /v1/admin/costs           — paginated llm_invocations (+ legacy llm_cost_usd)
//   GET /v1/admin/costs/summary   — aggregated cost by operation + model + day
//
// Primary telemetry: `llm_invocations` (telemetry.ts on every edge function).
// Legacy `llm_cost_usd` ledger rows are merged into summary + search.

import { Hono } from 'npm:hono@4'
import { requireAuth } from '../middleware/auth.ts'
import { requireProjectAccess } from '../middleware/project.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { estimateCallCostUsd } from '../../_shared/pricing.ts'
import type { Variables } from '../types.ts'

function db() { return getServiceClient() }

type CostSource = 'invocation' | 'ledger'

interface CostRow {
  id: string
  project_id: string
  operation: string
  model: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  occurred_at: string
  source: CostSource
}

const SORT_COLUMNS: Record<string, string> = {
  operation: 'function_name',
  model: 'used_model',
  input_tokens: 'input_tokens',
  output_tokens: 'output_tokens',
  cost_usd: 'cost_usd',
  occurred_at: 'created_at',
}

function resolveCostUsd(
  model: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
  persisted: number | null | undefined,
): number {
  if (persisted != null) return Number(persisted)
  return estimateCallCostUsd(model, inputTokens ?? 0, outputTokens ?? 0)
}

function invocationToRow(row: {
  id: string
  project_id: string
  function_name: string
  stage: string | null
  used_model: string
  input_tokens: number | null
  output_tokens: number | null
  cost_usd: number | null
  created_at: string
}): CostRow {
  return {
    id: row.id,
    project_id: row.project_id,
    operation: row.stage ? `${row.function_name}:${row.stage}` : row.function_name,
    model: row.used_model,
    input_tokens: row.input_tokens ?? 0,
    output_tokens: row.output_tokens ?? 0,
    cost_usd: resolveCostUsd(row.used_model, row.input_tokens, row.output_tokens, row.cost_usd),
    occurred_at: row.created_at,
    source: 'invocation',
  }
}

function ledgerToRow(row: {
  id: string
  project_id: string
  operation: string
  model: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  occurred_at: string
}): CostRow {
  return {
    id: row.id,
    project_id: row.project_id,
    operation: row.operation,
    model: row.model,
    input_tokens: row.input_tokens ?? 0,
    output_tokens: row.output_tokens ?? 0,
    cost_usd: Number(row.cost_usd ?? 0),
    occurred_at: row.occurred_at,
    source: 'ledger',
  }
}

function matchesSearch(row: CostRow, q: string): boolean {
  const needle = q.toLowerCase()
  return (
    row.operation.toLowerCase().includes(needle)
    || row.model.toLowerCase().includes(needle)
    || row.id.toLowerCase().includes(needle)
  )
}

export function registerCostsRoutes(parent: Hono<{ Variables: Variables }>) {
  const r = new Hono<{ Variables: Variables }>()
  r.use('*', requireAuth, requireProjectAccess)

  r.get('/', async (c) => {
    const projectId = c.req.query('project_id')
    if (!projectId) return c.json({ ok: false, error: { code: 'ERROR', message: 'project_id required' } }, 400)

    const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10))
    const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') ?? '25', 10)), 500)
    const sortParam = c.req.query('sort') ?? 'occurred_at'
    const order = c.req.query('order') === 'asc' ? 'asc' : 'desc'
    const q = (c.req.query('q') ?? '').trim()
    const sortCol = SORT_COLUMNS[sortParam] ?? 'created_at'
    const ascending = order === 'asc'

    const fetchLimit = q ? 5000 : limit
    const rangeFrom = q ? 0 : (page - 1) * limit
    const rangeTo = q ? fetchLimit - 1 : page * limit - 1

    const [invRes, invCountRes] = await Promise.all([
      db()
        .from('llm_invocations')
        .select(
          'id, project_id, function_name, stage, used_model, input_tokens, output_tokens, cost_usd, created_at',
          { count: 'exact' },
        )
        .eq('project_id', projectId)
        .order(sortCol, { ascending, nullsFirst: false })
        .range(rangeFrom, rangeTo),
      q
        ? db()
          .from('llm_invocations')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', projectId)
        : Promise.resolve({ count: null as number | null }),
    ])

    const ledgerRes = q
      ? await db()
        .from('llm_cost_usd')
        .select('id, project_id, operation, model, input_tokens, output_tokens, cost_usd, occurred_at')
        .eq('project_id', projectId)
        .order('occurred_at', { ascending: false })
        .limit(500)
      : { data: [] as never[], error: null }

    if (invRes.error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: invRes.error.message } }, 500)
    }
    if (ledgerRes.error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: ledgerRes.error.message } }, 500)
    }

    let rows: CostRow[] = (invRes.data ?? []).map((row) => invocationToRow(row))

    if (q) {
      rows = [
        ...rows,
        ...(ledgerRes.data ?? []).map((row) => ledgerToRow(row)),
      ]
      const seen = new Set<string>()
      rows = rows.filter((row) => {
        if (seen.has(row.id)) return false
        seen.add(row.id)
        return true
      })
      rows = rows.filter((row) => matchesSearch(row, q))
      rows.sort((a, b) => {
        const pick = (row: CostRow): string | number => {
          switch (sortParam) {
            case 'operation': return row.operation
            case 'model': return row.model
            case 'input_tokens': return row.input_tokens
            case 'output_tokens': return row.output_tokens
            case 'cost_usd': return row.cost_usd
            default: return row.occurred_at
          }
        }
        const av = pick(a)
        const bv = pick(b)
        if (av === bv) return 0
        const cmp = av < bv ? -1 : 1
        return ascending ? cmp : -cmp
      })
    }

    const invTotal = invRes.count ?? invCountRes.count ?? rows.length
    const total = q ? rows.length : invTotal
    const capped = q && (invCountRes.count ?? 0) > 5000
    const pageRows = q ? rows.slice((page - 1) * limit, page * limit) : rows

    return c.json({
      ok: true,
      data: {
        rows: pageRows,
        total,
        page,
        limit,
        sort: sortParam,
        order,
        ...(capped ? { capped: true } : {}),
      },
    })
  })

  r.get('/summary', async (c) => {
    const projectId = c.req.query('project_id')
    if (!projectId) return c.json({ ok: false, error: { code: 'ERROR', message: 'project_id required' } }, 400)

    const [invRes, ledgerRes] = await Promise.all([
      db()
        .from('llm_invocations')
        .select('function_name, stage, used_model, input_tokens, output_tokens, cost_usd, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(5000),
      db()
        .from('llm_cost_usd')
        .select('occurred_at, operation, model, cost_usd')
        .eq('project_id', projectId)
        .order('occurred_at', { ascending: false })
        .limit(2000),
    ])

    if (invRes.error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: invRes.error.message } }, 500)
    }
    if (ledgerRes.error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: ledgerRes.error.message } }, 500)
    }

    const agg = new Map<string, {
      day: string
      operation: string
      model: string
      total_cost_usd: number
      calls: number
    }>()

    const bump = (day: string, operation: string, model: string, cost: number) => {
      const key = `${day}|${operation}|${model}`
      const existing = agg.get(key)
      if (existing) {
        existing.total_cost_usd += cost
        existing.calls += 1
      } else {
        agg.set(key, { day, operation, model, total_cost_usd: cost, calls: 1 })
      }
    }

    for (const row of invRes.data ?? []) {
      const day = row.created_at?.slice(0, 10) ?? 'unknown'
      const operation = row.stage ? `${row.function_name}:${row.stage}` : row.function_name
      const cost = resolveCostUsd(row.used_model, row.input_tokens, row.output_tokens, row.cost_usd)
      bump(day, operation, row.used_model, cost)
    }

    for (const row of ledgerRes.data ?? []) {
      const day = row.occurred_at?.slice(0, 10) ?? 'unknown'
      bump(day, row.operation, row.model, Number(row.cost_usd ?? 0))
    }

    const data = Array.from(agg.values()).sort((a, b) => b.day.localeCompare(a.day))
    return c.json({ ok: true, data })
  })

  parent.route('/v1/admin/costs', r)
}
