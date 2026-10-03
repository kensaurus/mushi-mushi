/**
 * Daily radar pass, run from the integration-health-probe cron.
 *
 * For every project whose last `radar` gate run is older than
 * RADAR_RUN_INTERVAL_MS, read the inputs the detectors in _shared/radar.ts
 * need and write one gate run. A read that fails is recorded as the error it
 * is (the project is counted in `failed` and logged), never as "no findings".
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  detectByokKeyInvalid,
  detectIndexHealth,
  detectSpendCapUnset,
  detectWebhookNeverDelivered,
  radarRunDue,
  recordRadarFailure,
  recordRadarRun,
  type GithubRepoFacts,
  type InboundWebhookState,
  type RadarFinding,
} from '../_shared/radar.ts'
import { parseGithubRepoUrl } from '../_shared/github.ts'
import { resolveCostUsd } from '../_shared/llm-budget.ts'
import { readAllPages } from '../_shared/paged-read.ts'
import { latestIso } from '../_shared/index-coverage.ts'

export interface RadarPassDeps {
  /** GitHub facts for a primary repo, or null when GitHub cannot be read. */
  githubFacts: (projectId: string, owner: string, repo: string) => Promise<GithubRepoFacts | null>
  nowMs: number
}

export interface RadarPassResult {
  ran: number
  skipped: number
  failed: Array<{ projectId: string; error: string }>
  findings: number
}

interface SettingsRow {
  project_id: string
  autofix_enabled: boolean | null
  autofix_max_spend_usd: number | null
  autofix_max_dispatches_per_day: number | null
  monthly_llm_budget_usd: number | null
  sentry_webhook_secret: string | null
  linear_webhook_secret_ref: string | null
  slack_team_id: string | null
}

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
  return (res.data ?? ([] as unknown)) as T
}

async function countAudit(
  db: SupabaseClient,
  projectId: string,
  source: string,
  outcome: 'accepted' | 'rejected_signature',
): Promise<number> {
  const res = await db
    .from('webhook_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('webhook_source', source)
    .eq('outcome', outcome)
  if (res.error) throw new Error(`webhook_audit_log ${source}/${outcome}: ${res.error.message}`)
  return res.count ?? 0
}

async function firstHealthRow(db: SupabaseClient, projectId: string, kind: string): Promise<string | null> {
  const res = await db
    .from('integration_health_history')
    .select('checked_at')
    .eq('project_id', projectId)
    .eq('kind', kind)
    .order('checked_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (res.error) throw new Error(`integration_health_history ${kind}: ${res.error.message}`)
  return (res.data as { checked_at?: string } | null)?.checked_at ?? null
}

const SPEND_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const MAX_SPEND_ROWS = 50_000

/**
 * The project's AI spend over the last 30 days, priced like the Costs page
 * (stored cost, else the model price table). Feeds the suggested monthly
 * budget, so a failed read throws instead of suggesting from $0.
 */
async function recentLlmSpendUsd(db: SupabaseClient, projectId: string, nowMs: number): Promise<number> {
  type Row = { used_model: string | null; input_tokens: number | null; output_tokens: number | null; cost_usd: number | null }
  const read = await readAllPages<Row>(
    (from, to, count) => db
      .from('llm_invocations')
      .select('id, used_model, input_tokens, output_tokens, cost_usd', { count })
      .eq('project_id', projectId)
      .gte('created_at', new Date(nowMs - SPEND_WINDOW_MS).toISOString())
      .order('id', { ascending: true })
      .range(from, to),
    { what: 'llm_invocations', maxRows: MAX_SPEND_ROWS },
  )
  // A cut-short read only makes the sum a lower bound; the suggestion is then
  // still at least twice that, so it never undercuts what was read.
  return read.rows.reduce((n, r) => n + resolveCostUsd(r.used_model, r.input_tokens, r.output_tokens, r.cost_usd), 0)
}

async function collectFindings(
  db: SupabaseClient,
  s: SettingsRow,
  deps: RadarPassDeps,
): Promise<RadarFinding[]> {
  const projectId = s.project_id
  const findings: RadarFinding[] = []

  const llmSpend30d = s.monthly_llm_budget_usd == null ? await recentLlmSpendUsd(db, projectId, deps.nowMs) : null
  findings.push(...detectSpendCapUnset({ ...s, llm_spend_30d_usd: llmSpend30d }))

  const keys = must(
    await db
      .from('byok_keys')
      .select('provider_slug, label, key_hint, status, last_error')
      .eq('project_id', projectId),
    'byok_keys',
  ) as Array<{ provider_slug: string; label: string | null; key_hint: string | null; status: string; last_error: string | null }>
  findings.push(...detectByokKeyInvalid(keys))

  const repos = must(
    await db
      .from('project_repos')
      .select('repo_url, default_branch, indexed_branch, last_indexed_at, index_swept_at, github_app_installation_id, indexing_enabled, is_primary')
      .eq('project_id', projectId),
    'project_repos',
  ) as Array<{
    repo_url: string
    default_branch: string | null
    indexed_branch: string | null
    last_indexed_at: string | null
    /** Last successful sweep, complete or partial (20261003160000). */
    index_swept_at?: string | null
    github_app_installation_id: number | null
    indexing_enabled: boolean | null
    is_primary: boolean | null
  }>

  // Inbound webhooks: configured here, and the earliest health row stands in
  // for "configured since" (Plan 020 §4.2 #8).
  const inbound: Array<{ source: InboundWebhookState['source']; healthKind: string }> = []
  if (s.sentry_webhook_secret) inbound.push({ source: 'sentry', healthKind: 'sentry' })
  if (s.linear_webhook_secret_ref) inbound.push({ source: 'linear', healthKind: 'linear' })
  if (s.slack_team_id) inbound.push({ source: 'slack', healthKind: 'slack' })
  if (repos.some((r) => r.github_app_installation_id && r.indexing_enabled !== false)) {
    inbound.push({ source: 'github', healthKind: 'github' })
  }
  const states: InboundWebhookState[] = []
  for (const i of inbound) {
    const [configuredSince, accepted, rejectedSignature] = await Promise.all([
      firstHealthRow(db, projectId, i.healthKind),
      countAudit(db, projectId, i.source, 'accepted'),
      countAudit(db, projectId, i.source, 'rejected_signature'),
    ])
    states.push({ source: i.source, configuredSince, accepted, rejectedSignature })
  }
  findings.push(...detectWebhookNeverDelivered(states, deps.nowMs))

  const primary = repos.find((r) => r.is_primary) ?? (repos.length === 1 ? repos[0] : undefined)
  if (primary && primary.indexing_enabled !== false) {
    const parsed = parseGithubRepoUrl(primary.repo_url)
    if (parsed) {
      const facts = await deps.githubFacts(projectId, parsed.owner, parsed.repo)
      findings.push(
        ...detectIndexHealth(
          {
            repo_url: primary.repo_url,
            configured_branch: primary.default_branch,
            indexed_branch: primary.indexed_branch,
            // Staleness is about the last sweep: a partial sweep is recent
            // code too (coverage is reported on the index card, not here).
            last_indexed_at: latestIso(primary.last_indexed_at, primary.index_swept_at),
          },
          facts,
          deps.nowMs,
        ),
      )
    }
  }
  return findings
}

export async function runRadarPass(db: SupabaseClient, deps: RadarPassDeps): Promise<RadarPassResult> {
  const settings = must(
    await db
      .from('project_settings')
      .select(
        'project_id, autofix_enabled, autofix_max_spend_usd, autofix_max_dispatches_per_day, monthly_llm_budget_usd, sentry_webhook_secret, linear_webhook_secret_ref, slack_team_id',
      ),
    'project_settings',
  ) as SettingsRow[]

  const since = new Date(deps.nowMs - 48 * 60 * 60 * 1000).toISOString()
  const recentRuns = must(
    await db.from('gate_runs').select('project_id, started_at').eq('gate', 'radar').gte('started_at', since),
    'gate_runs radar',
  ) as Array<{ project_id: string; started_at: string }>
  const lastRun = new Map<string, string>()
  for (const r of recentRuns) {
    const prev = lastRun.get(r.project_id)
    if (!prev || r.started_at > prev) lastRun.set(r.project_id, r.started_at)
  }

  const result: RadarPassResult = { ran: 0, skipped: 0, failed: [], findings: 0 }
  for (const s of settings) {
    if (!radarRunDue(lastRun.get(s.project_id), deps.nowMs)) {
      result.skipped++
      continue
    }
    try {
      const findings = await collectFindings(db, s, deps)
      await recordRadarRun(db, s.project_id, findings, { triggeredBy: 'integration-health-probe' })
      result.ran++
      result.findings += findings.length
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Record the failed run so the next tick does not retry it at once.
      const recorded = await recordRadarFailure(db, s.project_id, message, { triggeredBy: 'integration-health-probe' })
        .then(() => '')
        .catch((e: unknown) => `; error run not recorded: ${e instanceof Error ? e.message : String(e)}`)
      result.failed.push({ projectId: s.project_id, error: message + recorded })
    }
  }
  return result
}
