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

async function collectFindings(
  db: SupabaseClient,
  s: SettingsRow,
  deps: RadarPassDeps,
): Promise<RadarFinding[]> {
  const projectId = s.project_id
  const findings: RadarFinding[] = []

  findings.push(...detectSpendCapUnset(s))

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
      .select('repo_url, default_branch, indexed_branch, last_indexed_at, github_app_installation_id, indexing_enabled, is_primary')
      .eq('project_id', projectId),
    'project_repos',
  ) as Array<{
    repo_url: string
    default_branch: string | null
    indexed_branch: string | null
    last_indexed_at: string | null
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
            last_indexed_at: primary.last_indexed_at,
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
        'project_id, autofix_enabled, autofix_max_spend_usd, autofix_max_dispatches_per_day, sentry_webhook_secret, linear_webhook_secret_ref, slack_team_id',
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
