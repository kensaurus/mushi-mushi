/**
 * FILE: packages/server/supabase/functions/_shared/spend-ledger.ts
 * PURPOSE: The per-app spend ledger (gap #22, Plan 020 §6): one view per app
 *          of what it costs over the last 30 days, from every source Mushi
 *          can read.
 *
 *   mushiLlm     Mushi's own AI calls for this app (llm_invocations.cost_usd).
 *   providerLlm  The operator's own OpenAI / Anthropic spend attributed to the
 *                app by binding (the llm_usage connector's current snapshot).
 *   ci           GitHub Actions minutes as cost: the estimated billable
 *                minutes (already × the runner multiplier: Linux 1, Windows 2,
 *                macOS 10) × $0.006, GitHub's Linux list price. ESTIMATED.
 *   supabase     Supabase bills an operator imported (egress, invocations…
 *                with their quantities). The read-only Supabase MCP exposes
 *                no billing, so an import is the only source.
 *   bills        Vercel, AWS and other bills an operator imported.
 *
 * Each source carries its own state. A read that fails is `error` with a
 * null amount and never counts as $0; a source with nothing connected is
 * `not_connected`. The app total adds only `ok` sources and says when it is
 * incomplete.
 */

import type { getServiceClient } from './db.ts'
import { BILL_VENDORS, type BillVendor } from './spend-bill-csv.ts'

type Db = ReturnType<typeof getServiceClient>

export const LEDGER_DAYS = 30
/** GitHub-hosted Linux runner list price per minute; est_billable_minutes already carries the OS multiplier. */
export const CI_USD_PER_LINUX_MINUTE = 0.006
const READ_LIMIT = 50_000

export type LedgerSourceState = 'ok' | 'not_connected' | 'error'

export interface LedgerSource {
  state: LedgerSourceState
  /** Null unless state is ok. */
  usd: number | null
  /** Why a source is not ok, or a caveat on an ok one (estimated, as-of time). */
  detail: string | null
}

export interface LedgerApp {
  projectId: string
  name: string
  mushiLlm: LedgerSource & { calls: number }
  providerLlm: LedgerSource
  ci: LedgerSource & { minutes: number | null; runs: number }
  supabase: LedgerSource & { usage: Array<{ service: string; unit: string; quantity: number }> }
  bills: LedgerSource & { byVendor: Array<{ vendor: BillVendor; usd: number }> }
  /** Sum of the ok sources. */
  totalUsd: number
  /** False when a source failed to read (the total is then a floor, not the spend). */
  complete: boolean
}

export interface LedgerImport {
  id: string
  vendor: BillVendor
  projectId: string | null
  filename: string | null
  format: string
  rowsRead: number
  rowsImported: number
  rowsSkipped: number
  totalUsd: number
  periodStart: string | null
  periodEnd: string | null
  createdAt: string
}

export interface SpendLedgerResponse {
  organizationId: string
  from: string
  to: string
  days: number
  ciUsdPerLinuxMinute: number
  apps: LedgerApp[]
  totals: { mushiLlmUsd: number; providerLlmUsd: number; ciUsd: number; supabaseUsd: number; billsUsd: number; totalUsd: number }
  /** Provider AI spend not bound to any app, per provider. */
  unattributedProviderUsd: number | null
  complete: boolean
  imports: LedgerImport[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

interface Read<T> { rows: T[]; error: string | null; truncated: boolean }

async function read<T>(q: PromiseLike<{ data: unknown; error: { message?: string } | null }>, limit = READ_LIMIT): Promise<Read<T>> {
  const res = await q
  if (res.error) return { rows: [], error: res.error.message ?? 'unknown error', truncated: false }
  const rows = (res.data ?? []) as T[]
  return { rows, error: null, truncated: rows.length >= limit }
}

const empty = <T>(): Read<T> => ({ rows: [], error: null, truncated: false })

/**
 * One current llm_usage snapshot. The recipe refresh runs each connector per
 * project, so there is one row per (instance, project): perProject holds that
 * project's own spend, totalUsd the whole provider organization's.
 */
interface SnapRow {
  connector_instance_id: string
  project_id: string
  ok: boolean
  error: string | null
  snapshot: { facts?: { perProject?: Record<string, number | string>; totalUsd?: number | string; provider?: string } } | null
  observed_at: string
}

function failed(detail: string): LedgerSource {
  return { state: 'error', usd: null, detail }
}

/** Build the ledger for the given apps of one organization. Never throws on a source read failure. */
export async function buildSpendLedger(
  db: Db,
  input: { organizationId: string; projects: Array<{ id: string; name: string }>; now: Date },
): Promise<SpendLedgerResponse> {
  const { organizationId, projects, now } = input
  const ids = projects.map((p) => p.id)
  const since = new Date(now.getTime() - LEDGER_DAYS * 86400_000)
  const sinceIso = since.toISOString()
  const sinceDay = sinceIso.slice(0, 10)

  // With no apps there is nothing to read; each read then resolves to an empty, successful result.
  const when = <T>(q: PromiseLike<{ data: unknown; error: { message?: string } | null }>, limit = READ_LIMIT): Promise<Read<T>> => (ids.length ? read<T>(q, limit) : Promise.resolve(empty<T>()))
  const [llm, instances, ci, entries, imports] = await Promise.all([
    when<{ project_id: string; cost_usd: number | string | null }>(db.from('llm_invocations').select('project_id, cost_usd').in('project_id', ids).gte('created_at', sinceIso).limit(READ_LIMIT)),
    when<{ id: string }>(db.from('connector_instances').select('id').eq('organization_id', organizationId).eq('kind', 'llm_usage').limit(20), 20),
    when<{ project_id: string; est_billable_minutes: number | string | null }>(db.from('ci_workflow_runs').select('project_id, est_billable_minutes').in('project_id', ids).gte('started_at', sinceIso).limit(READ_LIMIT)),
    when<{ project_id: string; vendor: BillVendor; service: string; unit: string; amount_usd: number | string; quantity: number | string | null }>(db.from('spend_ledger_entries').select('project_id, vendor, service, unit, amount_usd, quantity').eq('organization_id', organizationId).in('project_id', ids).gte('day', sinceDay).limit(READ_LIMIT)),
    when<{ id: string; vendor: BillVendor; project_id: string | null; filename: string | null; format: string; rows_read: number; rows_imported: number; rows_skipped: number; total_usd: number | string; period_start: string | null; period_end: string | null; created_at: string }>(db.from('spend_bill_imports').select('id, vendor, project_id, filename, format, rows_read, rows_imported, rows_skipped, total_usd, period_start, period_end, created_at').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(10), 10),
  ])

  // Provider spend: the current snapshot of each llm_usage instance, and which apps are bound to it.
  const instanceIds = instances.rows.map((r) => r.id)
  const haveInstances = instanceIds.length > 0 && !instances.error
  const [snaps, bindings] = await Promise.all([
    haveInstances ? read<SnapRow>(db.from('connector_snapshots').select('connector_instance_id, project_id, ok, error, snapshot, observed_at').in('connector_instance_id', instanceIds).eq('is_current', true).limit(1000), 1000) : Promise.resolve(empty<SnapRow>()),
    haveInstances ? read<{ connector_instance_id: string; project_id: string }>(db.from('connector_bindings').select('connector_instance_id, project_id').in('connector_instance_id', instanceIds).limit(500), 500) : Promise.resolve(empty<{ connector_instance_id: string; project_id: string }>()),
  ])

  const providerProblem = instances.error ?? snaps.error ?? bindings.error
  const instancesOf = new Map<string, string[]>()
  for (const b of bindings.rows) instancesOf.set(b.project_id, [...(instancesOf.get(b.project_id) ?? []), b.connector_instance_id])
  const snapOf = new Map(snaps.rows.map((s) => [`${s.connector_instance_id}|${s.project_id}`, s]))
  const projectSpend = (s: SnapRow) => Number(s.snapshot?.facts?.perProject?.[s.project_id] ?? 0) || 0

  /** One app's provider spend: every instance it is bound to must have a current, readable snapshot for it. */
  function providerFor(projectId: string): LedgerSource {
    const bound = instancesOf.get(projectId) ?? []
    if (bound.length === 0) return { state: 'not_connected', usd: null, detail: 'Not bound to an OpenAI project or Anthropic workspace.' }
    let usd = 0
    let asOf: string | null = null
    for (const instanceId of bound) {
      const s = snapOf.get(`${instanceId}|${projectId}`)
      if (!s) return failed('Not read yet. It is read with the daily recipe refresh.')
      if (!s.ok || !s.snapshot) return failed('The last provider read failed. Probe the source under Connected sources.')
      usd += projectSpend(s)
      if (!asOf || s.observed_at < asOf) asOf = s.observed_at
    }
    return { state: 'ok', usd: round2(usd), detail: asOf ? `Provider cost report as of ${asOf.slice(0, 10)}.` : null }
  }

  // Not tied to any app: each instance's organization total minus what its bound apps' snapshots attribute.
  let unattributed: number | null = null
  if (!providerProblem && instanceIds.length > 0) {
    let sum = 0
    let known = true
    for (const instanceId of instanceIds) {
      const rows = snaps.rows.filter((s) => s.connector_instance_id === instanceId && s.ok && s.snapshot)
      if (rows.length === 0) {
        known = false
        break
      }
      const total = Math.max(...rows.map((s) => Number(s.snapshot?.facts?.totalUsd ?? 0) || 0))
      sum += Math.max(0, total - rows.reduce((n, s) => n + projectSpend(s), 0))
    }
    unattributed = known ? round2(sum) : null
  }

  const llmBy = new Map<string, { usd: number; calls: number }>()
  for (const r of llm.rows) {
    const e = llmBy.get(r.project_id) ?? { usd: 0, calls: 0 }
    e.calls++
    const n = Number(r.cost_usd ?? 0)
    if (Number.isFinite(n)) e.usd += n
    llmBy.set(r.project_id, e)
  }

  const ciBy = new Map<string, { minutes: number; runs: number }>()
  for (const r of ci.rows) {
    const e = ciBy.get(r.project_id) ?? { minutes: 0, runs: 0 }
    e.runs++
    const n = Number(r.est_billable_minutes ?? 0)
    if (Number.isFinite(n)) e.minutes += n
    ciBy.set(r.project_id, e)
  }

  const billBy = new Map<string, Map<BillVendor, number>>()
  const supaUsage = new Map<string, Map<string, { service: string; unit: string; quantity: number }>>()
  for (const r of entries.rows) {
    const vendor = (BILL_VENDORS as readonly string[]).includes(r.vendor) ? r.vendor : 'other'
    const m = billBy.get(r.project_id) ?? new Map<BillVendor, number>()
    m.set(vendor, (m.get(vendor) ?? 0) + (Number(r.amount_usd) || 0))
    billBy.set(r.project_id, m)
    if (vendor === 'supabase' && r.quantity !== null && r.unit) {
      const u = supaUsage.get(r.project_id) ?? new Map()
      const key = `${r.service}|${r.unit}`
      const cur = u.get(key) ?? { service: r.service, unit: r.unit, quantity: 0 }
      cur.quantity += Number(r.quantity) || 0
      u.set(key, cur)
      supaUsage.set(r.project_id, u)
    }
  }

  const truncatedNote = (r: Read<unknown>) => (r.truncated ? ` More than ${READ_LIMIT.toLocaleString('en-US')} rows: this is a floor.` : '')

  const apps: LedgerApp[] = projects.map((p) => {
    const l = llmBy.get(p.id)
    const mushiLlm: LedgerApp['mushiLlm'] = llm.error
      ? { ...failed('Mushi AI calls could not be read.'), calls: 0 }
      : { state: 'ok', usd: round2(l?.usd ?? 0), calls: l?.calls ?? 0, detail: truncatedNote(llm).trim() || null }

    const providerLlm: LedgerSource = providerProblem
      ? failed('AI provider spend could not be read.')
      : instanceIds.length === 0
        ? { state: 'not_connected', usd: null, detail: 'Connect AI provider spend (OpenAI or Anthropic admin key) under Connected sources.' }
        : providerFor(p.id)

    const c = ciBy.get(p.id)
    const ciSrc: LedgerApp['ci'] = ci.error
      ? { ...failed('CI runs could not be read.'), minutes: null, runs: 0 }
      : !c
        ? { state: 'not_connected', usd: null, minutes: null, runs: 0, detail: 'No CI runs read in 30 days. Connect GitHub with Actions: read, or push runs with mushi recipe check.' }
        : { state: 'ok', usd: round2(c.minutes * CI_USD_PER_LINUX_MINUTE), minutes: Math.round(c.minutes), runs: c.runs, detail: `Estimated from job times at $${CI_USD_PER_LINUX_MINUTE}/Linux minute (macOS counts 10×). Public repositories are free.${truncatedNote(ci)}` }

    const vendors = billBy.get(p.id)
    const supaUsd = vendors?.get('supabase')
    const supabase: LedgerApp['supabase'] = entries.error
      ? { ...failed('Imported bills could not be read.'), usage: [] }
      : supaUsd === undefined
        ? { state: 'not_connected', usd: null, usage: [], detail: 'Import a Supabase usage or invoice CSV to see egress and invocations.' }
        : { state: 'ok', usd: round2(supaUsd), usage: [...(supaUsage.get(p.id)?.values() ?? [])].map((u) => ({ ...u, quantity: Math.round(u.quantity * 100) / 100 })), detail: 'From imported bills.' }

    const otherVendors = [...(vendors ?? new Map<BillVendor, number>())].filter(([v]) => v !== 'supabase')
    const bills: LedgerApp['bills'] = entries.error
      ? { ...failed('Imported bills could not be read.'), byVendor: [] }
      : otherVendors.length === 0
        ? { state: 'not_connected', usd: null, byVendor: [], detail: 'Import a Vercel or AWS bill CSV.' }
        : { state: 'ok', usd: round2(otherVendors.reduce((n, [, usd]) => n + usd, 0)), byVendor: otherVendors.map(([vendor, usd]) => ({ vendor, usd: round2(usd) })), detail: 'From imported bills.' }

    const sources: LedgerSource[] = [mushiLlm, providerLlm, ciSrc, supabase, bills]
    return {
      projectId: p.id,
      name: p.name,
      mushiLlm,
      providerLlm,
      ci: ciSrc,
      supabase,
      bills,
      totalUsd: round2(sources.reduce((n, s) => n + (s.state === 'ok' ? s.usd ?? 0 : 0), 0)),
      complete: sources.every((s) => s.state !== 'error'),
    }
  })

  const sum = (pick: (a: LedgerApp) => LedgerSource) => round2(apps.reduce((n, a) => n + (pick(a).state === 'ok' ? pick(a).usd ?? 0 : 0), 0))
  const totals = {
    mushiLlmUsd: sum((a) => a.mushiLlm),
    providerLlmUsd: sum((a) => a.providerLlm),
    ciUsd: sum((a) => a.ci),
    supabaseUsd: sum((a) => a.supabase),
    billsUsd: sum((a) => a.bills),
    totalUsd: round2(apps.reduce((n, a) => n + a.totalUsd, 0)),
  }

  return {
    organizationId,
    from: sinceIso,
    to: now.toISOString(),
    days: LEDGER_DAYS,
    ciUsdPerLinuxMinute: CI_USD_PER_LINUX_MINUTE,
    apps: apps.sort((a, b) => b.totalUsd - a.totalUsd || a.name.localeCompare(b.name)),
    totals,
    unattributedProviderUsd: unattributed,
    complete: apps.every((a) => a.complete) && !imports.error,
    imports: (imports.rows as Array<{ id: string; vendor: BillVendor; project_id: string | null; filename: string | null; format: string; rows_read: number; rows_imported: number; rows_skipped: number; total_usd: number | string; period_start: string | null; period_end: string | null; created_at: string }>).map((r) => ({
      id: r.id,
      vendor: r.vendor,
      projectId: r.project_id,
      filename: r.filename,
      format: r.format,
      rowsRead: r.rows_read,
      rowsImported: r.rows_imported,
      rowsSkipped: r.rows_skipped,
      totalUsd: round2(Number(r.total_usd) || 0),
      periodStart: r.period_start,
      periodEnd: r.period_end,
      createdAt: r.created_at,
    })),
  }
}
