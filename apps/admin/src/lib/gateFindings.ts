/**
 * FILE: apps/admin/src/lib/gateFindings.ts
 * PURPOSE: Pure helpers over GET /v1/admin/inventory/:projectId/findings
 *          (every plan, ADR 0018): the open findings of the newest run per
 *          gate, and the one-click spend-cap suggestion carried by a
 *          `spend_cap_unset` finding (server: _shared/radar.ts).
 */

import type { GateFinding } from '../components/inventory/GateFindingCard'

interface GateRunRow {
  id: string
  gate: string
  status: string
  findings_count?: number | null
  started_at?: string | null
  completed_at?: string | null
  summary?: unknown
}

/** The findings route returns at most this many runs and findings (api/routes/inventory.ts). */
export const FINDINGS_ROUTE_MAX_RUNS = 50
const FINDINGS_ROUTE_MAX_FINDINGS = 500

/**
 * True when the route's caps were reached: a check that last ran before the
 * newest 50 runs is then missing, so "nothing open" cannot be claimed.
 */
export function findingsReadTruncated(payload: GateFindingsPayload): boolean {
  return payload.runs.length >= FINDINGS_ROUTE_MAX_RUNS || payload.findings.length >= FINDINGS_ROUTE_MAX_FINDINGS
}

/** A design-token refresh is not a scan; it never hides the latest scan (server: isScanRun). */
function isScanRun(run: GateRunRow): boolean {
  if (run.gate !== 'design_drift') return true
  const phase = run.summary && typeof run.summary === 'object' ? (run.summary as { phase?: unknown }).phase : undefined
  return phase !== 'refresh'
}

/** The newest finished run per gate, skipping design refresh runs. */
export function latestRunPerGate(runs: readonly GateRunRow[]): Map<string, GateRunRow> {
  const latest = new Map<string, GateRunRow>()
  for (const run of runs) {
    if (run.status === 'running' || run.status === 'queued' || !isScanRun(run)) continue
    if (!latest.has(run.gate)) latest.set(run.gate, run)
  }
  return latest
}

interface GateFindingRow extends GateFinding {
  gate_run_id: string
  allowlisted?: boolean | null
  suggested_fix?: unknown
}

export interface GateFindingsPayload {
  runs: GateRunRow[]
  findings: GateFindingRow[]
}

/** A finding with the gate of its run attached. */
type LatestGateFinding = GateFindingRow & { gate: string }

const SEVERITY_RANK: Record<string, number> = { error: 0, warn: 1, info: 2 }

/**
 * Findings of the newest finished run per gate, not allowlisted, most severe
 * first. The route lists runs newest first, so the first run seen per gate is
 * the latest; a `running` / `queued` run is skipped like the server does.
 */
export function latestOpenFindings(payload: GateFindingsPayload): LatestGateFinding[] {
  const latestRun = latestRunPerGate(payload.runs)
  const gateOfRun = new Map([...latestRun.values()].map((r) => [r.id, r.gate]))
  return payload.findings
    .filter((f) => !f.allowlisted && gateOfRun.has(f.gate_run_id))
    .map((f) => ({ ...f, gate: gateOfRun.get(f.gate_run_id)! }))
    .sort((a, b) => (SEVERITY_RANK[a.severity ?? 'info'] ?? 3) - (SEVERITY_RANK[b.severity ?? 'info'] ?? 3))
}

type SpendCapField = 'monthly_llm_budget_usd' | 'autofix_max_spend_usd' | 'autofix_max_dispatches_per_day'

export type SpendCapValues = Partial<Record<SpendCapField, number>>

const SPEND_CAP_FIELDS: readonly SpendCapField[] = ['monthly_llm_budget_usd', 'autofix_max_spend_usd', 'autofix_max_dispatches_per_day']

/**
 * The caps a `spend_cap_unset` finding suggests, ready to send to
 * PATCH /v1/admin/settings. null for any other finding, or when the
 * suggestion carries nothing valid (never a partial guess).
 */
export function spendCapSuggestion(f: Pick<GateFindingRow, 'rule_id' | 'suggested_fix'>): SpendCapValues | null {
  if (f.rule_id !== 'spend_cap_unset') return null
  const fix = f.suggested_fix
  if (!fix || typeof fix !== 'object') return null
  const values = (fix as { values?: unknown }).values
  if (!values || typeof values !== 'object') return null
  const out: SpendCapValues = {}
  for (const field of SPEND_CAP_FIELDS) {
    const v = (values as Record<string, unknown>)[field]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[field] = v
  }
  return Object.keys(out).length > 0 ? out : null
}

/** One plain-English line per cap, for the confirmation dialog. */
export function describeSpendCaps(values: SpendCapValues): string[] {
  const lines: string[] = []
  if (values.monthly_llm_budget_usd != null) {
    lines.push(`Monthly AI budget: $${values.monthly_llm_budget_usd}. Every AI call for this app (triage, fixes, chat) stops once this month's spend reaches it, until the 1st.`)
  }
  if (values.autofix_max_spend_usd != null) {
    lines.push(`Auto-fix spend limit: $${values.autofix_max_spend_usd} per 30 days for fixes Mushi starts on its own.`)
  }
  if (values.autofix_max_dispatches_per_day != null) {
    lines.push(`Automatic fixes per day: ${values.autofix_max_dispatches_per_day}.`)
  }
  return lines
}
