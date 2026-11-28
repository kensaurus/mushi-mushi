/**
 * FILE: packages/server/supabase/functions/_shared/llm-cost-reconcile.ts
 * PURPOSE: Check, once a day, that Mushi Mushi's priced LLM ledger agrees
 *          with what the provider actually billed (cost catalog program,
 *          wave 3, 2026-11-25).
 *
 * Source of the vendor's number: the `llm_usage` connector's current
 * snapshot (recipe-collector reads it daily at 03:35 UTC with the
 * organization's OpenAI or Anthropic ADMIN key: OpenAI
 * /v1/organization/costs in USD, Anthropic /v1/organizations/cost_report in
 * CENTS, divided by 100 in connectors/llm-usage.ts). This module makes no
 * vendor call of its own; it runs as the last step of recipe-collector.
 *
 * What is compared, per connector instance, for yesterday (UTC):
 *   vendor  the cost of the provider projects / workspaces bound to Mushi
 *           projects (connector_bindings.external_id), and nothing else: a
 *           provider organization also bills the app's own traffic, which
 *           Mushi never sees, so an org-wide total would "gap" every day.
 *   ledger  llm_invocations of those Mushi projects for the same provider on
 *           the project's own key (key_source = 'byok'), the key that lives
 *           in that provider project. Calls on Mushi's platform key are billed
 *           to Mushi Mushi's provider account, not the customer's, and are
 *           reported in `detail` only.
 * Unpriced ledger calls (no catalog price) are counted, never added as $0.
 *
 * status: ok (|gap| <= 3 %), gap (> 3 %, raises one Ops alert), skipped (no
 * admin key, nothing bound, snapshot not read yet; detail.reason says which),
 * error (the snapshot read failed). One row per (instance, day), upserted.
 *
 * Not compared (said in detail.notCompared): the KENSAURUS AI-call rollup
 * (kensaurus_ai_calls) lives in the kensaurus-shared database, which this
 * project cannot read.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { isTransientUnpriced, priceLlmCall, providerForModel } from './llm-cost.ts'
import type { DailyCost } from './connectors/llm-usage.ts'

/** Alert when the ledger and the vendor differ by more than this, in percent of the vendor's figure. */
export const GAP_ALERT_PCT = 3
const MAX_INSTANCES = 50
const PAGE = 1000

export type ReconcileStatus = 'ok' | 'gap' | 'skipped' | 'error'

export interface ReconcileResult {
  status: ReconcileStatus
  vendorUsd: number | null
  ledgerUsd: number | null
  ledgerUnpricedCalls: number
  gapUsd: number | null
  gapPct: number | null
  detail: Record<string, unknown>
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000
}

/**
 * Compare one day. Pure. `vendorRows` are the snapshot's daily rows;
 * `bound` maps a provider project / workspace id to its Mushi project.
 */
export function reconcileDay(args: {
  day: string
  vendorRows: DailyCost[]
  bound: ReadonlySet<string>
  ledgerUsd: number
  ledgerUnpricedCalls: number
  platformKeyCalls: number
}): ReconcileResult {
  let vendorUsd = 0
  let unattributedUsd = 0
  let rowsForDay = 0
  for (const r of args.vendorRows) {
    if (r.day !== args.day) continue
    rowsForDay++
    if (r.externalId && args.bound.has(r.externalId)) vendorUsd += r.usd
    else unattributedUsd += r.usd
  }
  const detail: Record<string, unknown> = {
    unattributedUsd: round6(unattributedUsd),
    vendorRowsForDay: rowsForDay,
    platformKeyCallsExcluded: args.platformKeyCalls,
    notCompared: ['kensaurus_ai_calls (kensaurus-shared database, not readable from this project)'],
  }
  vendorUsd = round6(vendorUsd)
  const ledgerUsd = round6(args.ledgerUsd)
  const gapUsd = round6(ledgerUsd - vendorUsd)
  if (vendorUsd === 0) {
    // Nothing billed: any priced ledger spend is a gap with no percentage.
    const status: ReconcileStatus = ledgerUsd > 0 ? 'gap' : 'ok'
    return { status, vendorUsd, ledgerUsd, ledgerUnpricedCalls: args.ledgerUnpricedCalls, gapUsd, gapPct: null, detail }
  }
  const gapPct = Math.round((gapUsd / vendorUsd) * 100 * 10_000) / 10_000
  return {
    status: Math.abs(gapPct) > GAP_ALERT_PCT ? 'gap' : 'ok',
    vendorUsd,
    ledgerUsd,
    ledgerUnpricedCalls: args.ledgerUnpricedCalls,
    gapUsd,
    gapPct,
    detail,
  }
}

/** Yesterday's UTC day as YYYY-MM-DD, and its [start, end) bounds. */
export function yesterdayUtc(now: Date): { day: string; start: string; end: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const start = new Date(end.getTime() - 86_400_000)
  return { day: start.toISOString().slice(0, 10), start: start.toISOString(), end: end.toISOString() }
}

type Db = SupabaseClient

interface InstanceRow {
  id: string
  organization_id: string
  read_credential_ref: string | null
  config: Record<string, unknown> | null
}

async function ledgerFor(
  db: Db,
  projectIds: string[],
  provider: string,
  start: string,
  end: string,
): Promise<{ usd: number; unpriced: number; platformKeyCalls: number }> {
  let usd = 0
  let unpriced = 0
  let platformKeyCalls = 0
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('llm_invocations')
      .select('used_model, cost_usd, key_source')
      .in('project_id', projectIds)
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`llm_invocations: ${error.message}`)
    const rows = (data ?? []) as Array<{ used_model: string; cost_usd: number | string | null; key_source: string | null }>
    for (const r of rows) {
      if (providerForModel(r.used_model) !== provider) continue
      if (r.key_source !== 'byok') {
        platformKeyCalls++
        continue
      }
      if (r.cost_usd == null) unpriced++
      else usd += Number(r.cost_usd)
    }
    if (rows.length < PAGE) break
  }
  return { usd, unpriced, platformKeyCalls }
}

export interface ReconcileDeps {
  now?: Date
  /** Raise the Ops alert for a gap (emitOpsEvent in production). */
  alert?: (projectId: string, args: { instanceId: string; provider: string; day: string; result: ReconcileResult }) => Promise<unknown>
}

/** Reconcile every llm_usage connector instance for yesterday. Never throws for one instance. */
export async function reconcileLlmCosts(db: Db, deps: ReconcileDeps = {}): Promise<Array<{ instanceId: string; status: ReconcileStatus; reason?: string }>> {
  const now = deps.now ?? new Date()
  const { day, start, end } = yesterdayUtc(now)
  const { data: instances, error } = await db
    .from('connector_instances')
    .select('id, organization_id, read_credential_ref, config')
    .eq('kind', 'llm_usage')
    .limit(MAX_INSTANCES)
  if (error) throw new Error(`connector_instances: ${error.message}`)

  const out: Array<{ instanceId: string; status: ReconcileStatus; reason?: string }> = []
  for (const inst of (instances ?? []) as InstanceRow[]) {
    const provider = inst.config?.provider === 'openai' || inst.config?.provider === 'anthropic' ? inst.config.provider : null
    if (!provider) continue
    let result: ReconcileResult
    let alertProject: string | null = null
    try {
      result = await reconcileInstance(db, inst, provider, day, start, end)
      if (result.status === 'gap') alertProject = (result.detail.projectIds as string[] | undefined)?.[0] ?? null
    } catch (err) {
      result = { status: 'error', vendorUsd: null, ledgerUsd: null, ledgerUnpricedCalls: 0, gapUsd: null, gapPct: null, detail: { reason: String((err as Error)?.message ?? err).slice(0, 300) } }
    }
    const { error: upErr } = await db.from('llm_cost_reconciliations').upsert(
      {
        organization_id: inst.organization_id,
        connector_instance_id: inst.id,
        provider,
        day,
        status: result.status,
        vendor_usd: result.vendorUsd,
        ledger_usd: result.ledgerUsd,
        ledger_unpriced_calls: result.ledgerUnpricedCalls,
        gap_usd: result.gapUsd,
        gap_pct: result.gapPct,
        detail: result.detail,
        updated_at: now.toISOString(),
      },
      { onConflict: 'connector_instance_id,day' },
    )
    if (upErr) result = { ...result, status: 'error', detail: { ...result.detail, storeError: upErr.message } }
    if (alertProject && deps.alert) {
      await deps.alert(alertProject, { instanceId: inst.id, provider, day, result }).catch(() => {})
    }
    out.push({ instanceId: inst.id, status: result.status, reason: result.detail.reason as string | undefined })
  }
  return out
}

async function reconcileInstance(
  db: Db,
  inst: InstanceRow,
  provider: 'openai' | 'anthropic',
  day: string,
  start: string,
  end: string,
): Promise<ReconcileResult> {
  const skipped = (reason: string, extra: Record<string, unknown> = {}): ReconcileResult => ({
    status: 'skipped', vendorUsd: null, ledgerUsd: null, ledgerUnpricedCalls: 0, gapUsd: null, gapPct: null, detail: { reason, ...extra },
  })
  if (!inst.read_credential_ref) return skipped('no_admin_key')

  const { data: binds, error: bindErr } = await db
    .from('connector_bindings')
    .select('project_id, external_id')
    .eq('connector_instance_id', inst.id)
  if (bindErr) throw new Error(`connector_bindings: ${bindErr.message}`)
  const bindings = ((binds ?? []) as Array<{ project_id: string; external_id: string }>).filter((b) => b.external_id)
  if (!bindings.length) return skipped('nothing_bound')

  const { data: snap, error: snapErr } = await db
    .from('connector_snapshots')
    .select('ok, error, snapshot, observed_at')
    .eq('connector_instance_id', inst.id)
    .eq('is_current', true)
    .order('observed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (snapErr) throw new Error(`connector_snapshots: ${snapErr.message}`)
  const s = snap as { ok: boolean; error: string | null; snapshot: { facts?: { rows?: DailyCost[] } } | null; observed_at: string } | null
  if (!s) return skipped('not_read_yet')
  if (!s.ok) {
    return { status: 'error', vendorUsd: null, ledgerUsd: null, ledgerUnpricedCalls: 0, gapUsd: null, gapPct: null, detail: { reason: `cost report read failed: ${(s.error ?? 'unknown').slice(0, 200)}` } }
  }
  if (Date.parse(s.observed_at) < Date.parse(end)) return skipped('snapshot_older_than_day', { observedAt: s.observed_at })

  const projectIds = [...new Set(bindings.map((b) => b.project_id))]
  const ledger = await ledgerFor(db, projectIds, provider, start, end)
  const result = reconcileDay({
    day,
    vendorRows: s.snapshot?.facts?.rows ?? [],
    bound: new Set(bindings.map((b) => b.external_id)),
    ledgerUsd: ledger.usd,
    ledgerUnpricedCalls: ledger.unpriced,
    platformKeyCalls: ledger.platformKeyCalls,
  })
  result.detail.projectIds = projectIds
  result.detail.observedAt = s.observed_at
  return result
}

/**
 * Re-price the calls that went unpriced only because the price book could
 * not be reached (isTransientUnpriced), from the last 7 days, at the price in
 * force when each call ran. Token rows only: audio calls keep no seconds on
 * the row. Bounded; runs before reconcileLlmCosts. Never throws.
 */
export async function repriceTransientInvocations(db: Db, now: Date = new Date()): Promise<{ checked: number; priced: number }> {
  const { data, error } = await db
    .from('llm_invocations')
    .select('id, used_model, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, created_at, unpriced_reason')
    .is('cost_usd', null)
    .like('unpriced_reason', 'price lookup failed%')
    .gte('created_at', new Date(now.getTime() - 7 * 86_400_000).toISOString())
    .order('created_at', { ascending: true })
    .limit(500)
  if (error) return { checked: 0, priced: 0 }
  type Row = { id: string; used_model: string; input_tokens: number | null; output_tokens: number | null; cache_read_input_tokens: number | null; cache_creation_input_tokens: number | null; created_at: string; unpriced_reason: string | null }
  let priced = 0
  const rows = (data ?? []) as Row[]
  for (const r of rows) {
    if (!isTransientUnpriced(r.unpriced_reason) || !((r.input_tokens ?? 0) + (r.output_tokens ?? 0) > 0)) continue
    const c = await priceLlmCall({
      model: r.used_model,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cacheReadTokens: r.cache_read_input_tokens,
      cacheWriteTokens: r.cache_creation_input_tokens,
      at: r.created_at,
    })
    // Still unreachable: leave the row for the next run. A real "no price" is stored.
    if (c.costUsd === null && isTransientUnpriced(c.unpricedReason)) continue
    const { error: upErr } = await db
      .from('llm_invocations')
      .update({ cost_usd: c.costUsd, price_source: c.source, price_version: c.version, price_tier: c.tier, unpriced_reason: c.unpricedReason })
      .eq('id', r.id)
      .is('cost_usd', null)
    if (!upErr && c.costUsd !== null) priced++
  }
  return { checked: rows.length, priced }
}
