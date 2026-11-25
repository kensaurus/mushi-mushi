// costs.ts — LLM cost tracking admin endpoints
//
// Admin:
//   GET /v1/admin/costs              — paginated llm_invocations (+ legacy llm_cost_usd)
//   GET /v1/admin/costs/stats        — workspace health summary for banner + KPI strip
//   GET /v1/admin/costs/summary      — aggregated cost by operation + model + day
//   GET /v1/admin/costs/reconciliation — the daily vendor check for the project's org
//   POST /v1/admin/costs/price-override — super-admin: price an unpriced model
//
// Primary telemetry: `llm_invocations` (telemetry.ts on every edge function).
// Legacy `llm_cost_usd` ledger rows are merged into summary + search.

import { Hono } from 'npm:hono@4'
import { requireAuth } from '../middleware/auth.ts'
import { requireProjectAccess } from '../middleware/project.ts'
import { getServiceClient } from '../../_shared/db.ts'
// One cost rule for the Costs page and the budget the LLM path enforces.
import { resolveCostUsd } from '../../_shared/llm-budget.ts'
import { providerForModel, setLlmPriceSource } from '../../_shared/llm-cost.ts'
import { overrideRow, parsePriceOverride, writePriceOverride } from '../../_shared/price-override.ts'
import { requireSuperAdmin } from '../../_shared/super-admin.ts'
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
  /** null = unpriced: the shared price catalog had no price for the call. */
  cost_usd: number | null
  /** Why the call is unpriced; null when priced. */
  unpriced_reason: string | null
  occurred_at: string
  source: CostSource
  /** llm_invocations.status ('success' | 'error'); null for ledger rows. */
  status: string | null
  /** Provider error for a failed call, trimmed for display. */
  error_message: string | null
}

const SORT_COLUMNS: Record<string, string> = {
  operation: 'function_name',
  model: 'used_model',
  input_tokens: 'input_tokens',
  output_tokens: 'output_tokens',
  cost_usd: 'cost_usd',
  occurred_at: 'created_at',
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
  status?: string | null
  error_message?: string | null
  unpriced_reason?: string | null
}): CostRow {
  const cost = resolveCostUsd(row.cost_usd)
  return {
    status: row.status ?? null,
    error_message: row.error_message ? String(row.error_message).slice(0, 300) : null,
    id: row.id,
    project_id: row.project_id,
    operation: row.stage ? `${row.function_name}:${row.stage}` : row.function_name,
    model: row.used_model,
    input_tokens: row.input_tokens ?? 0,
    output_tokens: row.output_tokens ?? 0,
    cost_usd: cost,
    unpriced_reason: cost === null ? (row.unpriced_reason ?? LEGACY_UNPRICED) : null,
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
    status: null,
    error_message: null,
    id: row.id,
    project_id: row.project_id,
    operation: row.operation,
    model: row.model,
    input_tokens: row.input_tokens ?? 0,
    output_tokens: row.output_tokens ?? 0,
    cost_usd: Number(row.cost_usd ?? 0),
    unpriced_reason: null,
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
  unpriced_reason: string | null
}

/** Reason shown for an old row that was never given a cost (before the shared catalog). */
const LEGACY_UNPRICED = 'no cost recorded (before the shared price catalog)'

/** Unpriced usage of one model in the window: what the Costs page lists under "Unpriced". */
export interface UnpricedModelRow {
  provider: string
  model: string
  calls: number
  inputTokens: number
  outputTokens: number
  lastSeenAt: string
  reason: string
}

/** Group unpriced invocation rows by model, most calls first. Pure. */
export function groupUnpriced(
  rows: Array<Pick<InvRow, 'used_model' | 'input_tokens' | 'output_tokens' | 'created_at' | 'unpriced_reason'>>,
): UnpricedModelRow[] {
  const by = new Map<string, UnpricedModelRow>()
  for (const r of rows) {
    const g = by.get(r.used_model) ?? {
      provider: providerForModel(r.used_model),
      model: r.used_model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      lastSeenAt: r.created_at,
      reason: r.unpriced_reason ?? LEGACY_UNPRICED,
    }
    g.calls += 1
    g.inputTokens += r.input_tokens ?? 0
    g.outputTokens += r.output_tokens ?? 0
    if (r.created_at > g.lastSeenAt) {
      g.lastSeenAt = r.created_at
      if (r.unpriced_reason) g.reason = r.unpriced_reason
    }
    by.set(r.used_model, g)
  }
  return [...by.values()].sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model))
}

type LedgerRow = {
  occurred_at: string
  operation: string
  model: string
  cost_usd: number
}

class CostStatsReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CostStatsReadError'
  }
}

/** PostgREST returns at most this many rows per request (Supabase `max_rows`). */
const COST_PAGE = 1000

/** Every row a query matches, read COST_PAGE rows at a time. Throws on a read error. */
async function readAllPages<T>(
  what: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += COST_PAGE) {
    const { data, error } = await page(from, from + COST_PAGE - 1)
    if (error) throw new CostStatsReadError(`${what}: ${error.message ?? 'read failed'}`)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < COST_PAGE) return out
  }
}

/**
 * Spend recorded before `beforeIso`: the persisted cost summed in SQL
 * (`llm_spend_before`, migration 20261004163000), and how many older rows are
 * unpriced (cost_usd NULL). Unpriced rows are counted, never re-priced. Until
 * the migration is applied it reads every older row in pages instead.
 */
async function spendBefore(projectId: string, beforeIso: string): Promise<{ usd: number; unpricedCalls: number }> {
  const { data, error } = await db().rpc('llm_spend_before', { p_project_id: projectId, p_before: beforeIso })
  const missing = error && (error.code === 'PGRST202' || error.code === '42883')
  if (error && !missing) throw new CostStatsReadError(`llm_spend_before: ${error.message}`)

  if (!missing) {
    const sums = (data ?? {}) as { persisted_usd?: number | string | null; ledger_usd?: number | string | null; unpriced_rows?: number | null }
    return {
      usd: Number(sums.persisted_usd ?? 0) + Number(sums.ledger_usd ?? 0),
      unpricedCalls: Number(sums.unpriced_rows ?? 0),
    }
  }

  console.warn(JSON.stringify({ level: 'warn', msg: 'llm_spend_before missing: apply migration 20261004163000; paging older rows' }))
  const [olderInv, olderLedger] = await Promise.all([
    readAllPages<Pick<InvRow, 'used_model' | 'input_tokens' | 'output_tokens' | 'cost_usd'>>('older llm_invocations', (from, to) =>
      db()
        .from('llm_invocations')
        .select('used_model, input_tokens, output_tokens, cost_usd')
        .eq('project_id', projectId)
        .lt('created_at', beforeIso)
        .order('created_at', { ascending: true })
        .range(from, to),
    ),
    readAllPages<{ cost_usd: number | null }>('older llm_cost_usd', (from, to) =>
      db()
        .from('llm_cost_usd')
        .select('cost_usd')
        .eq('project_id', projectId)
        .lt('occurred_at', beforeIso)
        .order('occurred_at', { ascending: true })
        .range(from, to),
    ),
  ])
  let usd = olderLedger.reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0)
  let unpricedCalls = 0
  for (const r of olderInv) {
    const cost = resolveCostUsd(r.cost_usd)
    if (cost === null) unpricedCalls++
    else usd += cost
  }
  return { usd, unpricedCalls }
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
      unpricedCalls30d: 0,
      unpricedCalls24h: 0,
      unpricedCallsOlder: 0,
      unpriced: [] as UnpricedModelRow[],
    }

    // A failed read answers with an error: an outage must not read as "$0".
    const must = <T extends { error: { message?: string } | null }>(r: T): T => {
      if (r.error) throw new CostStatsReadError(r.error.message ?? 'cost stats read failed')
      return r
    }

    let projectRow: { id: string; name: string } | null
    let settingsRow: { byok_anthropic_key_ref: string | null } | null
    let invocationCount: number
    let ledgerCount: number
    let invRows: InvRow[]
    let ledgerRows: LedgerRow[]
    let older: { usd: number; unpricedCalls: number }
    try {
      const [projectRes, invCountRes, ledgerCountRes, settingsRes] = await Promise.all([
        db().from('projects').select('id, name').eq('id', projectId).maybeSingle(),
        db().from('llm_invocations').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
        db().from('llm_cost_usd').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
        db().from('project_settings').select('byok_anthropic_key_ref').eq('project_id', projectId).maybeSingle(),
      ])
      projectRow = must(projectRes).data as { id: string; name: string } | null
      settingsRow = must(settingsRes).data as { byok_anthropic_key_ref: string | null } | null
      invocationCount = must(invCountRes).count ?? 0
      ledgerCount = must(ledgerCountRes).count ?? 0
      if (!projectRow) return c.json({ ok: true, data: empty })

      // Every row of the last 30 days, page by page. `.limit(10000)` returned
      // at most PostgREST's 1,000 rows, so a busy project's spend was cut off
      // silently. A row's cost is its stored cost_usd (resolveCostUsd), the
      // same rule the LLM budget enforces; NULL is unpriced and counted apart.
      ;[invRows, ledgerRows] = await Promise.all([
        readAllPages<InvRow>('llm_invocations', (from, to) =>
          db()
            .from('llm_invocations')
            .select('function_name, stage, used_model, input_tokens, output_tokens, cost_usd, created_at, status, key_source, unpriced_reason')
            .eq('project_id', projectId)
            .gte('created_at', since30d)
            .order('created_at', { ascending: false })
            .range(from, to),
        ),
        readAllPages<LedgerRow>('llm_cost_usd', (from, to) =>
          db()
            .from('llm_cost_usd')
            .select('occurred_at, operation, model, cost_usd')
            .eq('project_id', projectId)
            .gte('occurred_at', since30d)
            .order('occurred_at', { ascending: false })
            .range(from, to),
        ),
      ])
      older =
        invocationCount > invRows.length || ledgerCount > ledgerRows.length
          ? await spendBefore(projectId, since30d)
          : { usd: 0, unpricedCalls: 0 }
    } catch (err) {
      if (err instanceof CostStatsReadError) {
        return c.json({ ok: false, error: { code: 'DB_ERROR', message: 'Could not read LLM spend. Try again in a minute.' } }, 500)
      }
      throw err
    }


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

    const unpricedRows: InvRow[] = []
    let unpricedCalls24h = 0

    const bumpInv = (row: InvRow) => {
      const priced = resolveCostUsd(row.cost_usd)
      const at = row.created_at
      // An unpriced call adds no dollars: it is counted and listed instead.
      if (priced === null) {
        unpricedRows.push(row)
        if (at >= since24h) unpricedCalls24h += 1
      }
      const cost = priced ?? 0
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

    // All-time total: the last 30 days above plus everything older.
    totalSpendUsd += older.usd

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

    const totalCalls = invocationCount + ledgerCount
    const pricedCalls24h = calls24h - unpricedCalls24h
    const avgCostPerCall24h = pricedCalls24h > 0 ? spend24hUsd / pricedCalls24h : 0
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
        // The spend totals above are PRICED spend. Unpriced calls (no price
        // in the shared catalog) are counted and listed here, never as $0.
        unpricedCalls30d: unpricedRows.length,
        unpricedCalls24h,
        unpricedCallsOlder: older.unpricedCalls,
        unpriced: groupUnpriced(unpricedRows),
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
    // `status=failed` lists the calls the stats banner counts as failed
    // (status present and not 'success'); `since` bounds the window, so
    // "N failed calls in 24h → View failures" opens exactly those N rows.
    const failedOnly = c.req.query('status') === 'failed'
    const sinceRaw = c.req.query('since')
    const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw).toISOString() : null

    const fetchLimit = q ? 5000 : limit
    const rangeFrom = q ? 0 : (page - 1) * limit
    const rangeTo = q ? fetchLimit - 1 : page * limit - 1

    let invQuery = db()
      .from('llm_invocations')
      .select(
        'id, project_id, function_name, stage, used_model, input_tokens, output_tokens, cost_usd, created_at, status, error_message, unpriced_reason',
        { count: 'exact' },
      )
      .eq('project_id', projectId)
    if (failedOnly) invQuery = invQuery.neq('status', 'success')
    if (since) invQuery = invQuery.gte('created_at', since)
    let invCountQuery = db()
      .from('llm_invocations')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
    if (failedOnly) invCountQuery = invCountQuery.neq('status', 'success')
    if (since) invCountQuery = invCountQuery.gte('created_at', since)

    const [invRes, invCountRes] = await Promise.all([
      invQuery.order(sortCol, { ascending, nullsFirst: false }).range(rangeFrom, rangeTo),
      q ? invCountQuery : Promise.resolve({ count: null as number | null }),
    ])

    // Ledger rows carry no status, so they never match the failed filter.
    let ledgerQuery = db()
      .from('llm_cost_usd')
      .select('id, project_id, operation, model, input_tokens, output_tokens, cost_usd, occurred_at')
      .eq('project_id', projectId)
    if (since) ledgerQuery = ledgerQuery.gte('occurred_at', since)
    const ledgerRes = q && !failedOnly
      ? await ledgerQuery.order('occurred_at', { ascending: false }).limit(500)
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
            // Unpriced rows sort below every priced row in either order.
            case 'cost_usd': return row.cost_usd ?? (ascending ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY)
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
      /** Priced spend only. */
      total_cost_usd: number
      calls: number
      /** Calls the shared catalog could not price, counted, not added as $0. */
      unpriced_calls: number
    }>()

    const bump = (day: string, operation: string, model: string, cost: number | null) => {
      const key = `${day}|${operation}|${model}`
      const row = agg.get(key) ?? { day, operation, model, total_cost_usd: 0, calls: 0, unpriced_calls: 0 }
      row.calls += 1
      if (cost === null) row.unpriced_calls += 1
      else row.total_cost_usd += cost
      agg.set(key, row)
    }

    for (const row of invRes.data ?? []) {
      const day = row.created_at?.slice(0, 10) ?? 'unknown'
      const operation = row.stage ? `${row.function_name}:${row.stage}` : row.function_name
      bump(day, operation, row.used_model, resolveCostUsd(row.cost_usd))
    }

    for (const row of ledgerRes.data ?? []) {
      const day = row.occurred_at?.slice(0, 10) ?? 'unknown'
      bump(day, row.operation, row.model, Number(row.cost_usd ?? 0))
    }

    const data = Array.from(agg.values()).sort((a, b) => b.day.localeCompare(a.day))
    return c.json({ ok: true, data })
  })

  // The daily vendor check (_shared/llm-cost-reconcile.ts, run by
  // recipe-collector) for the project's organization: which providers have an
  // admin key to check against, and the last 14 days of results.
  r.get('/reconciliation', async (c) => {
    const projectId = c.req.query('project_id')
    if (!projectId) return c.json({ ok: false, error: { code: 'ERROR', message: 'project_id required' } }, 400)
    const { data: project, error: projErr } = await db().from('projects').select('organization_id').eq('id', projectId).maybeSingle()
    if (projErr) return c.json({ ok: false, error: { code: 'DB_ERROR', message: projErr.message } }, 500)
    const orgId = (project as { organization_id?: string | null } | null)?.organization_id
    if (!orgId) return c.json({ ok: true, data: { providers: [], rows: [] } })
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10)
    const [instRes, rowsRes] = await Promise.all([
      db().from('connector_instances').select('id, config, read_credential_ref').eq('organization_id', orgId).eq('kind', 'llm_usage').limit(50),
      db().from('llm_cost_reconciliations')
        .select('connector_instance_id, provider, day, status, vendor_usd, ledger_usd, ledger_unpriced_calls, gap_usd, gap_pct, detail, updated_at')
        .eq('organization_id', orgId)
        .gte('day', since)
        .order('day', { ascending: false })
        .limit(200),
    ])
    if (instRes.error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: instRes.error.message } }, 500)
    if (rowsRes.error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: rowsRes.error.message } }, 500)
    const instances = (instRes.data ?? []) as Array<{ id: string; config: { provider?: unknown } | null; read_credential_ref: string | null }>
    // One entry per provider: an admin key on any of its instances is enough to check.
    const providers = (['openai', 'anthropic'] as const).map((provider) => {
      const mine = instances.filter((i) => i.config?.provider === provider)
      return { provider, connected: mine.length > 0, hasAdminKey: mine.some((i) => Boolean(i.read_credential_ref)) }
    })
    return c.json({ ok: true, data: { providers, rows: rowsRes.data ?? [] } })
  })

  // "Add price" for an unpriced model (_shared/price-override.ts). Platform
  // super-admin only: an override is global across every KENSAURUS app.
  r.post('/price-override', requireSuperAdmin, async (c) => {
    const parsed = parsePriceOverride(await c.req.json().catch(() => null))
    if (!parsed.ok) return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error } }, 400)
    const userId = c.get('userId') as string
    // Stored by the bridge as 'mushi:console:<user id>'.
    const row = overrideRow(parsed.value, `console:${userId}`, new Date())
    const res = await writePriceOverride(row, {
      url: Deno.env.get('KENSAURUS_WALLET_URL') ?? '',
      token: Deno.env.get('KENSAURUS_WALLET_INTERNAL_TOKEN') ?? '',
    })
    if (!res.ok) return c.json({ ok: false, error: { code: res.code, message: res.message } }, res.status as 400 | 409 | 501 | 502 | 503)
    // The next call of this model prices from the override; rows already
    // written stay unpriced (the price did not exist when they ran).
    setLlmPriceSource(null)
    return c.json({ ok: true, data: { override: res.row } })
  })

  parent.route('/v1/admin/costs', r)
}


