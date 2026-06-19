// costs.ts — LLM cost tracking admin endpoints
//
// Admin:
//   GET /v1/admin/costs              — paginated llm_invocations (+ legacy llm_cost_usd)
//   GET /v1/admin/costs/stats        — workspace health summary for banner + KPI strip
//   GET /v1/admin/costs/summary      — aggregated cost by operation + model + day
//   GET /v1/admin/org/budget         — monthly_llm_budget_usd for a project
//   PUT /v1/admin/org/budget         — set/clear monthly_llm_budget_usd for a project
//
// Primary telemetry: `llm_invocations` (telemetry.ts on every edge function).
// Legacy `llm_cost_usd` ledger rows are merged into summary + search.

import { Hono } from 'npm:hono@4'
import { requireAuth } from '../middleware/auth.ts'
import { requireProjectAccess } from '../middleware/project.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { estimateCallCostUsd } from '../../_shared/pricing.ts'
import { accessibleProjectIds } from '../../_shared/project-access.ts'
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

  r.get('/stats', async (c) => {
    const projectId = c.req.query('project_id')
    if (!projectId) return c.json({ ok: false, error: { code: 'ERROR', message: 'project_id required' } }, 400)

    const now = Date.now()
    const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString()
    const since48h = new Date(now - 48 * 60 * 60 * 1000).toISOString()
    const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
    const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()
    const monthStart = new Date()
    monthStart.setUTCDate(1)
    monthStart.setUTCHours(0, 0, 0, 0)
    const sinceMonth = monthStart.toISOString()

    const empty = {
      projectId: null as string | null,
      projectName: null as string | null,
      totalSpendUsd: 0,
      spend24hUsd: 0,
      spend7dUsd: 0,
      spend30dUsd: 0,
      spendMonthUsd: 0,
      prior24hSpendUsd: 0,
      spendSpike24h: false,
      calls24h: 0,
      calls7d: 0,
      calls30d: 0,
      totalCalls: 0,
      invocationCount: 0,
      ledgerCount: 0,
      operationsCount: 0,
      modelsCount: 0,
      topOperation: null as string | null,
      topOperationUsd: 0,
      topModel: null as string | null,
      topModelUsd: 0,
      lastCallAt: null as string | null,
      failedCalls24h: 0,
      platformKeyCalls24h: 0,
      byokCalls24h: 0,
      byokAnthropicConfigured: false,
      avgCostPerCall24h: 0,
    }

    const [
      { data: projectRow },
      invCountRes,
      ledgerCountRes,
      invRes,
      ledgerRes,
      { data: settingsRow },
    ] = await Promise.all([
      db().from('projects').select('id, name').eq('id', projectId).maybeSingle(),
      db()
        .from('llm_invocations')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId),
      db()
        .from('llm_cost_usd')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId),
      db()
        .from('llm_invocations')
        .select(
          'function_name, stage, used_model, input_tokens, output_tokens, cost_usd, created_at, status, key_source',
        )
        .eq('project_id', projectId)
        .gte('created_at', since30d)
        .order('created_at', { ascending: false })
        .limit(10000),
      db()
        .from('llm_cost_usd')
        .select('occurred_at, operation, model, cost_usd')
        .eq('project_id', projectId)
        .gte('occurred_at', since30d)
        .order('occurred_at', { ascending: false })
        .limit(2000),
      db()
        .from('project_settings')
        .select('byok_anthropic_key_ref')
        .eq('project_id', projectId)
        .maybeSingle(),
    ])

    if (!projectRow) return c.json({ ok: true, data: empty })

    type InvRow = {
      function_name: string
      stage: string | null
      used_model: string
      input_tokens: number | null
      output_tokens: number | null
      cost_usd: number | null
      created_at: string
      status: string | null
      key_source: string | null
    }

    const invRows = (invRes.data ?? []) as InvRow[]
    const ledgerRows = (ledgerRes.data ?? []) as Array<{
      occurred_at: string
      operation: string
      model: string
      cost_usd: number
    }>

    let totalSpendUsd = 0
    let spend24hUsd = 0
    let spend7dUsd = 0
    let spend30dUsd = 0
    let spendMonthUsd = 0
    let prior24hSpendUsd = 0
    let calls24h = 0
    let calls7d = 0
    let calls30d = 0
    let failedCalls24h = 0
    let platformKeyCalls24h = 0
    let byokCalls24h = 0
    let lastCallAt: string | null = null

    const opSpend = new Map<string, number>()
    const modelSpend = new Map<string, number>()
    const ops = new Set<string>()
    const models = new Set<string>()

    const bumpInv = (row: InvRow) => {
      const cost = resolveCostUsd(row.used_model, row.input_tokens, row.output_tokens, row.cost_usd)
      const at = row.created_at
      const operation = row.stage ? `${row.function_name}:${row.stage}` : row.function_name

      totalSpendUsd += cost
      spend30dUsd += cost
      calls30d += 1
      ops.add(operation)
      models.add(row.used_model)
      opSpend.set(operation, (opSpend.get(operation) ?? 0) + cost)
      modelSpend.set(row.used_model, (modelSpend.get(row.used_model) ?? 0) + cost)

      if (!lastCallAt || at > lastCallAt) lastCallAt = at

      if (at >= since7d) {
        spend7dUsd += cost
        calls7d += 1
      }
      if (at >= since24h) {
        spend24hUsd += cost
        calls24h += 1
        if (row.status && row.status !== 'success') failedCalls24h += 1
        if (row.key_source === 'byok') byokCalls24h += 1
        else platformKeyCalls24h += 1
      } else if (at >= since48h) {
        prior24hSpendUsd += cost
      }
      if (at >= sinceMonth) spendMonthUsd += cost
    }

    for (const row of invRows) bumpInv(row)

    for (const row of ledgerRows) {
      const cost = Number(row.cost_usd ?? 0)
      const at = row.occurred_at
      totalSpendUsd += cost
      spend30dUsd += cost
      calls30d += 1
      ops.add(row.operation)
      models.add(row.model)
      opSpend.set(row.operation, (opSpend.get(row.operation) ?? 0) + cost)
      modelSpend.set(row.model, (modelSpend.get(row.model) ?? 0) + cost)
      if (!lastCallAt || at > lastCallAt) lastCallAt = at
      if (at >= since7d) {
        spend7dUsd += cost
        calls7d += 1
      }
      if (at >= since24h) spend24hUsd += cost
      else if (at >= since48h) prior24hSpendUsd += cost
      if (at >= sinceMonth) spendMonthUsd += cost
    }

    // All-time totals include rows older than 30d — fetch only sums for those.
    if ((invCountRes.count ?? 0) > invRows.length || (ledgerCountRes.count ?? 0) > ledgerRows.length) {
      const [olderInv, olderLedger] = await Promise.all([
        invRows.length < (invCountRes.count ?? 0)
          ? db()
            .from('llm_invocations')
            .select('used_model, input_tokens, output_tokens, cost_usd')
            .eq('project_id', projectId)
            .lt('created_at', since30d)
            .limit(10000)
          : Promise.resolve({ data: [] as InvRow[] }),
        ledgerRows.length < (ledgerCountRes.count ?? 0)
          ? db()
            .from('llm_cost_usd')
            .select('cost_usd')
            .eq('project_id', projectId)
            .lt('occurred_at', since30d)
            .limit(2000)
          : Promise.resolve({ data: [] as Array<{ cost_usd: number }> }),
      ])
      for (const row of (olderInv.data ?? []) as InvRow[]) {
        totalSpendUsd += resolveCostUsd(row.used_model, row.input_tokens, row.output_tokens, row.cost_usd)
      }
      for (const row of (olderLedger.data ?? []) as Array<{ cost_usd: number }>) {
        totalSpendUsd += Number(row.cost_usd ?? 0)
      }
    }

    let topOperation: string | null = null
    let topOperationUsd = 0
    for (const [op, usd] of opSpend) {
      if (usd > topOperationUsd) {
        topOperation = op
        topOperationUsd = usd
      }
    }

    let topModel: string | null = null
    let topModelUsd = 0
    for (const [model, usd] of modelSpend) {
      if (usd > topModelUsd) {
        topModel = model
        topModelUsd = usd
      }
    }

    const invocationCount = invCountRes.count ?? invRows.length
    const ledgerCount = ledgerCountRes.count ?? ledgerRows.length
    const totalCalls = invocationCount + ledgerCount
    const avgCostPerCall24h = calls24h > 0 ? spend24hUsd / calls24h : 0
    const spendSpike24h =
      prior24hSpendUsd >= 0.01 && spend24hUsd >= prior24hSpendUsd * 3 && spend24hUsd >= 0.05

    const scoped = (path: string) =>
      `${path}${path.includes('?') ? '&' : '?'}project=${encodeURIComponent(projectId)}`

    let topPriority: 'no_calls' | 'spike' | 'failed' | 'byok_recommended' | 'legacy_only' | 'healthy' =
      'healthy'
    let topPriorityLabel: string | null = null
    let topPriorityTo: string | null = null

    if (totalCalls === 0) {
      topPriority = 'no_calls'
      topPriorityLabel = 'No LLM calls logged yet — ingest a report or run a Health test to populate telemetry.'
      topPriorityTo = scoped('/health')
    } else if (spendSpike24h) {
      topPriority = 'spike'
      topPriorityLabel = `Spend jumped to $${spend24hUsd.toFixed(2)} in 24h (was $${prior24hSpendUsd.toFixed(2)}) — check Raw log for runaway crons.`
      topPriorityTo = scoped('/cost?tab=log')
    } else if (failedCalls24h > 0) {
      topPriority = 'failed'
      topPriorityLabel = `${failedCalls24h} failed LLM call${failedCalls24h === 1 ? '' : 's'} in 24h — may still incur partial token cost.`
      topPriorityTo = scoped('/cost?tab=log')
    } else if (!settingsRow?.byok_anthropic_key_ref && platformKeyCalls24h > 0) {
      topPriority = 'byok_recommended'
      topPriorityLabel = `${platformKeyCalls24h} call${platformKeyCalls24h === 1 ? '' : 's'} on platform keys in 24h — add BYOK in Settings to control billing.`
      topPriorityTo = scoped('/settings?tab=byok')
    } else if (ledgerCount > 0 && invocationCount === 0) {
      topPriority = 'legacy_only'
      topPriorityLabel = 'Only legacy cost rows — new telemetry writes to llm_invocations after the next LLM run.'
      topPriorityTo = scoped('/cost?tab=log')
    } else {
      topPriority = 'healthy'
      topPriorityLabel = `$${spend24hUsd.toFixed(2)} in 24h · ${calls24h} calls · top: ${topOperation ?? '—'}`
      topPriorityTo = scoped('/cost?tab=breakdown')
    }

    return c.json({
      ok: true,
      data: {
        projectId: projectRow.id,
        projectName: projectRow.name,
        totalSpendUsd: Math.round(totalSpendUsd * 10000) / 10000,
        spend24hUsd: Math.round(spend24hUsd * 10000) / 10000,
        spend7dUsd: Math.round(spend7dUsd * 10000) / 10000,
        spend30dUsd: Math.round(spend30dUsd * 10000) / 10000,
        spendMonthUsd: Math.round(spendMonthUsd * 10000) / 10000,
        prior24hSpendUsd: Math.round(prior24hSpendUsd * 10000) / 10000,
        spendSpike24h,
        calls24h,
        calls7d,
        calls30d,
        totalCalls,
        invocationCount,
        ledgerCount,
        operationsCount: ops.size,
        modelsCount: models.size,
        topOperation,
        topOperationUsd: Math.round(topOperationUsd * 10000) / 10000,
        topModel,
        topModelUsd: Math.round(topModelUsd * 10000) / 10000,
        lastCallAt,
        failedCalls24h,
        platformKeyCalls24h,
        byokCalls24h,
        byokAnthropicConfigured: Boolean(settingsRow?.byok_anthropic_key_ref),
        avgCostPerCall24h: Math.round(avgCostPerCall24h * 10000) / 10000,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    })
  })

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

// ---------------------------------------------------------------------------
// Budget endpoints — sit at /v1/admin/org/budget (outside the /costs prefix)
// so they are registered on the parent directly via registerBudgetRoutes.
// ---------------------------------------------------------------------------
export function registerBudgetRoutes(parent: Hono<{ Variables: Variables }>) {
  const r = new Hono<{ Variables: Variables }>()

  // GET /v1/admin/org/budget?projectId=<pid>
  r.get('/', requireAuth, async (c) => {
    const userId = c.get('userId') as string
    const pid = c.req.query('projectId')
    if (!pid) return c.json({ ok: false, error: 'projectId required' }, 400)

    const projectIds = await accessibleProjectIds(db(), userId)
    if (!projectIds.includes(pid)) return c.json({ ok: false, error: 'forbidden' }, 403)

    const { data, error } = await db()
      .from('project_settings')
      .select('monthly_llm_budget_usd')
      .eq('project_id', pid)
      .maybeSingle()

    if (error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    }
    return c.json({
      ok: true,
      data: { monthly_llm_budget_usd: data?.monthly_llm_budget_usd ?? null },
    })
  })

  // PUT /v1/admin/org/budget  body: { projectId, monthly_llm_budget_usd: number | null }
  r.put('/', requireAuth, async (c) => {
    const userId = c.get('userId') as string
    const body = await c.req.json().catch(() => ({})) as {
      projectId?: unknown
      monthly_llm_budget_usd?: unknown
    }

    const pid = typeof body.projectId === 'string' ? body.projectId : null
    if (!pid) {
      return c.json({ ok: false, error: { code: 'MISSING_PROJECT', message: 'projectId required' } }, 400)
    }

    const projectIds = await accessibleProjectIds(db(), userId)
    if (!projectIds.includes(pid)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'forbidden' } }, 403)
    }

    const rawBudget = body.monthly_llm_budget_usd
    let budgetUsd: number | null
    if (rawBudget === null || rawBudget === undefined) {
      budgetUsd = null
    } else if (typeof rawBudget === 'number' && Number.isFinite(rawBudget) && rawBudget > 0) {
      budgetUsd = rawBudget
    } else {
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_BUDGET',
            message: 'monthly_llm_budget_usd must be a positive number or null',
          },
        },
        400,
      )
    }

    const { error } = await db()
      .from('project_settings')
      .upsert({ project_id: pid, monthly_llm_budget_usd: budgetUsd }, { onConflict: 'project_id' })

    if (error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    }
    return c.json({ ok: true, data: { monthly_llm_budget_usd: budgetUsd } })
  })

  parent.route('/v1/admin/org/budget', r)
}


