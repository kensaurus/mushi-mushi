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
  commit_sha?: string | null
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

/**
 * Only a deviance scan (`phase: 'scan'`) is a design_drift result, as on the
 * server (isScanRun): a token refresh, a CI push of another branch, a push
 * with a public key or from an older CLI never hides the latest scan.
 */
function isScanRun(run: GateRunRow): boolean {
  if (run.gate !== 'design_drift') return true
  const phase = run.summary && typeof run.summary === 'object' ? (run.summary as { phase?: unknown }).phase : undefined
  return phase === 'scan'
}

/** The newest finished run per gate; for design_drift, the newest deviance scan. */
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

/** A check whose newest run is older than this reads as stale, not as current. */
export const STALE_CHECK_DAYS = 14

export interface CheckGroup {
  gate: string
  status: string
  /** When the newest run finished (or started, when it never recorded an end). */
  ranAt: string | null
  commitSha: string | null
  stale: boolean
  open: number
  /** Open findings per rule, most first. */
  rules: Array<{ rule: string; count: number }>
  findings: LatestGateFinding[]
}

const STATUS_RANK: Record<string, number> = { error: 0, fail: 1, warn: 2, pass: 3 }

/**
 * Pure: one entry per check, from its newest run: when it ran, against which
 * commit, whether that is stale, and its open findings grouped by rule.
 * Current problems first, then stale ones, then passing checks.
 */
export function groupFindingsByCheck(payload: GateFindingsPayload, now: number = Date.now()): CheckGroup[] {
  const latest = latestRunPerGate(payload.runs)
  const findings = latestOpenFindings(payload)
  const groups = [...latest.values()].map((run): CheckGroup => {
    const mine = findings.filter((f) => f.gate_run_id === run.id)
    const perRule = new Map<string, number>()
    for (const f of mine) perRule.set(f.rule_id ?? 'other', (perRule.get(f.rule_id ?? 'other') ?? 0) + 1)
    const ranAt = run.completed_at ?? run.started_at ?? null
    return {
      gate: run.gate,
      status: run.status,
      ranAt,
      commitSha: run.commit_sha ?? null,
      stale: ranAt ? now - Date.parse(ranAt) > STALE_CHECK_DAYS * 86_400_000 : true,
      open: mine.length,
      rules: [...perRule].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count),
      findings: mine,
    }
  })
  const weight = (g: CheckGroup) => (g.open === 0 && g.status !== 'error' ? 2 : g.stale ? 1 : 0)
  return groups.sort((a, b) => weight(a) - weight(b) || (STATUS_RANK[a.status] ?? 4) - (STATUS_RANK[b.status] ?? 4) || b.open - a.open)
}

type SpendCapField ='monthly_llm_budget_usd' | 'autofix_max_spend_usd' | 'autofix_max_dispatches_per_day'

export type SpendCapValues = Partial<Record<SpendCapField, number>>

const SPEND_CAP_FIELDS: readonly SpendCapField[] = ['monthly_llm_budget_usd', 'autofix_max_spend_usd', 'autofix_max_dispatches_per_day']

/**
 * The caps a `spend_cap_unset` finding suggests. They are checked against the
 * current settings (planSpendCaps) before anything is sent to
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

const SPEND_CAP_LABEL: Record<SpendCapField, string> = {
  monthly_llm_budget_usd: 'Monthly AI budget',
  autofix_max_spend_usd: 'Auto-fix spend limit',
  autofix_max_dispatches_per_day: 'Automatic fixes per day',
}

export interface SpendCapPlan {
  /** Suggested caps that are still unset now: the only ones the apply sends. */
  toSet: SpendCapValues
  /** Plain-English names of suggested caps someone set after the check ran; left as they are. */
  alreadySet: string[]
}

/**
 * Split a suggestion against the project's current settings (GET
 * /v1/admin/settings). The suggestion comes from the last daily check, so a
 * cap set since then is never overwritten. Every non-null current value counts
 * as set.
 */
export function planSpendCaps(values: SpendCapValues, current: Readonly<Record<string, unknown>>): SpendCapPlan {
  const toSet: SpendCapValues = {}
  const alreadySet: string[] = []
  for (const field of SPEND_CAP_FIELDS) {
    const suggested = values[field]
    if (suggested == null) continue
    if (current[field] != null) alreadySet.push(SPEND_CAP_LABEL[field])
    else toSet[field] = suggested
  }
  return { toSet, alreadySet }
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
