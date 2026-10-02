/**
 * FILE: packages/server/supabase/functions/_shared/radar.ts
 * PURPOSE: Mushi's own fail-open detectors (Plan 020 §4.1 / §12.1 Phase 0).
 *
 * Each detector is a pure rule over rows Mushi already has. Its findings are
 * written as one `gate_runs` row (gate = 'radar') plus `gate_findings` rows,
 * so they show up wherever gate findings already do: the Full-stack audit
 * page, `GET /v1/admin/inventory/:id/findings` and the MCP tool
 * `list_gate_findings`.
 *
 * Rules:
 *   byok_key_invalid        a stored provider key the provider now rejects
 *   spend_cap_unset         auto-fix is on with no spend or daily cap
 *   webhook_never_delivered an inbound integration configured 7+ days ago that
 *                           never had a delivery accepted
 *   index_branch_mismatch   the code index follows a branch that is not the
 *                           repo's GitHub default
 *   index_stale             the newest index is 14+ days old while the repo
 *                           kept moving
 *
 * Writing is fail-loud: an insert error throws RadarWriteError. The pattern
 * this module exists to catch is a guard that fails on a CHECK constraint and
 * reports success anyway.
 *
 * Pure apart from `recordRadarRun`, which takes the client; no Deno globals.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { DEFAULT_AUTOFIX_MAX_DISPATCHES_PER_DAY, DEFAULT_AUTOFIX_MAX_SPEND_USD } from './autofix-budget.ts'

export type RadarRuleId =
  | 'byok_key_invalid'
  | 'spend_cap_unset'
  | 'webhook_never_delivered'
  | 'index_branch_mismatch'
  | 'index_stale'

export interface RadarFinding {
  rule_id: RadarRuleId
  severity: 'info' | 'warn' | 'error'
  message: string
  suggested_fix?: Record<string, unknown>
}

/** The radar writes at most one run per project in this window. */
export const RADAR_RUN_INTERVAL_MS = 20 * 60 * 60 * 1000
export const WEBHOOK_GRACE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Linear and GitHub-indexer audit rows carry a project id only from this
 * release on (fix/failopen-2026-10). Earlier accepted deliveries cannot be
 * attributed, so "configured since" for those sources starts no earlier than
 * this — otherwise every older setup reads as never delivered on day one.
 */
export const PROJECT_STAMPING_SINCE: Partial<Record<InboundWebhookState['source'], string>> = {
  linear: '2026-10-03T00:00:00Z',
  github: '2026-10-03T00:00:00Z',
}
export const INDEX_STALE_MS = 14 * 24 * 60 * 60 * 1000

export function radarRunDue(lastStartedAt: string | null | undefined, nowMs: number): boolean {
  if (!lastStartedAt) return true
  return nowMs - new Date(lastStartedAt).getTime() >= RADAR_RUN_INTERVAL_MS
}

// ── byok_key_invalid ─────────────────────────────────────────────────────

export function detectByokKeyInvalid(
  keys: Array<{
    provider_slug: string
    label: string | null
    key_hint: string | null
    status: string
    last_error: string | null
  }>,
): RadarFinding[] {
  return keys
    .filter((k) => k.status === 'auth_failed')
    .map((k) => ({
      rule_id: 'byok_key_invalid' as const,
      severity: 'error' as const,
      message:
        `Your ${k.provider_slug} key "${k.label || k.key_hint || 'unnamed'}" is rejected by ${k.provider_slug}. ` +
        'Mushi skips it, so calls fall back to another key or fail. Replace it in Settings → API Keys.',
      suggested_fix: {
        kind: 'console',
        path: '/settings?tab=keys',
        provider: k.provider_slug,
        last_error: k.last_error?.slice(0, 200) ?? null,
      },
    }))
}

// ── spend_cap_unset ──────────────────────────────────────────────────────

export function detectSpendCapUnset(settings: {
  autofix_enabled: boolean | null
  autofix_max_spend_usd: number | null
  autofix_max_dispatches_per_day: number | null
}): RadarFinding[] {
  if (!settings.autofix_enabled) return []
  const missing: string[] = []
  if (settings.autofix_max_spend_usd == null) missing.push('a 30-day spend cap')
  if (settings.autofix_max_dispatches_per_day == null) missing.push('a daily dispatch cap')
  if (missing.length === 0) return []
  return [
    {
      rule_id: 'spend_cap_unset',
      severity: 'warn',
      message:
        `Auto-fix is on with no ${missing.join(' and no ')}. Mushi can start fixes on its own, so nothing ` +
        `limits what they spend. Suggested: $${DEFAULT_AUTOFIX_MAX_SPEND_USD} per 30 days and ` +
        `${DEFAULT_AUTOFIX_MAX_DISPATCHES_PER_DAY} dispatches a day. Fixes you start yourself are never blocked by a cap.`,
      suggested_fix: {
        kind: 'console',
        path: '/settings?tab=general#spend-limits',
        // Same fields the console saves through PATCH /v1/admin/settings.
        values: {
          autofix_max_spend_usd: settings.autofix_max_spend_usd ?? DEFAULT_AUTOFIX_MAX_SPEND_USD,
          autofix_max_dispatches_per_day: settings.autofix_max_dispatches_per_day ?? DEFAULT_AUTOFIX_MAX_DISPATCHES_PER_DAY,
        },
      },
    },
  ]
}

// ── webhook_never_delivered ──────────────────────────────────────────────

export interface InboundWebhookState {
  /** webhook_audit_log.webhook_source */
  source: 'sentry' | 'linear' | 'slack' | 'github'
  /** Earliest integration_health_history row for this integration, the proxy for "configured since". */
  configuredSince: string | null
  accepted: number
  rejectedSignature: number
}

const INBOUND_LABEL: Record<InboundWebhookState['source'], { name: string; setup: string }> = {
  sentry: { name: 'Sentry', setup: 'In Sentry, add the Mushi webhook URL under Settings → Integrations → Internal Integration, then send a test alert.' },
  linear: { name: 'Linear', setup: 'Reconnect Linear from Integrations so Mushi can register its webhook, then change an issue to test it.' },
  slack: { name: 'Slack', setup: 'Reinstall the Mushi Slack app from Integrations so Slack can send events, then mention the bot to test it.' },
  github: { name: 'GitHub', setup: 'Install the Mushi GitHub App on the repo (or add the repo webhook), then push a commit to test it.' },
}

export function detectWebhookNeverDelivered(states: InboundWebhookState[], nowMs: number): RadarFinding[] {
  const out: RadarFinding[] = []
  for (const s of states) {
    // No health history yet: we cannot say how long it has been configured.
    if (!s.configuredSince) continue
    const floor = PROJECT_STAMPING_SINCE[s.source]
    const since = floor && floor > s.configuredSince ? floor : s.configuredSince
    if (nowMs - new Date(since).getTime() < WEBHOOK_GRACE_MS) continue
    if (s.accepted > 0) continue
    const label = INBOUND_LABEL[s.source]
    out.push(
      s.rejectedSignature > 0
        ? {
            rule_id: 'webhook_never_delivered',
            severity: 'error',
            message:
              `${label.name} has sent ${s.rejectedSignature} webhook(s), and every one failed the signature check. ` +
              `The signing secret in ${label.name} does not match the one saved in Mushi, so no event has ever been accepted.`,
            suggested_fix: { kind: 'setup', source: s.source, step: 'Copy the signing secret again from Integrations and paste it into ' + label.name + '.' },
          }
        : {
            rule_id: 'webhook_never_delivered',
            severity: 'warn',
            message:
              `${label.name} is connected, but in more than 7 days no ${label.name} webhook has reached Mushi. ` +
              'Events from it are not arriving.',
            suggested_fix: { kind: 'setup', source: s.source, step: label.setup },
          },
    )
  }
  return out
}

// ── index_branch_mismatch / index_stale ──────────────────────────────────

export interface IndexedRepoState {
  repo_url: string
  /** project_repos.default_branch — the branch Mushi is configured to index. */
  configured_branch: string | null
  /** project_repos.indexed_branch — the branch the last sweep actually read. */
  indexed_branch: string | null
  last_indexed_at: string | null
}

/** What GitHub says about the repo, or null when it could not be read. */
export interface GithubRepoFacts {
  default_branch: string
  pushed_at: string | null
}

export function detectIndexHealth(
  repo: IndexedRepoState,
  github: GithubRepoFacts | null,
  nowMs: number,
): RadarFinding[] {
  if (!github) return []
  const out: RadarFinding[] = []
  const following = repo.indexed_branch ?? repo.configured_branch
  if (following && following !== github.default_branch) {
    out.push({
      rule_id: 'index_branch_mismatch',
      severity: 'error',
      message:
        `Mushi indexes the "${following}" branch of ${repo.repo_url}, but the repo's default branch is ` +
        `"${github.default_branch}". Diagnoses and fixes read old code.`,
      suggested_fix: { kind: 'setting', field: 'project_repos.default_branch', value: github.default_branch },
    })
  }
  const pushedMs = github.pushed_at ? new Date(github.pushed_at).getTime() : null
  const indexedMs = repo.last_indexed_at ? new Date(repo.last_indexed_at).getTime() : null
  const repoMoved = pushedMs != null && (indexedMs == null || pushedMs > indexedMs)
  if (repoMoved && (indexedMs == null || nowMs - indexedMs >= INDEX_STALE_MS)) {
    out.push({
      rule_id: 'index_stale',
      severity: 'warn',
      message: indexedMs == null
        ? `${repo.repo_url} has never been indexed, and it has had pushes since it was connected.`
        : `The code index for ${repo.repo_url} is ${Math.floor((nowMs - indexedMs) / 86_400_000)} days old and the repo has changed since.`,
      suggested_fix: { kind: 'command', command: 'mushi index', console_path: '/explore?tab=index' },
    })
  }
  return out
}

// ── writer ───────────────────────────────────────────────────────────────

export class RadarWriteError extends Error {
  constructor(what: string, detail: string) {
    super(`radar write failed (${what}): ${detail}`)
    this.name = 'RadarWriteError'
  }
}

/**
 * One gate run per call, `pass` when there is nothing to report. Throws on
 * any write error so the caller's cron run fails visibly.
 */
export async function recordRadarRun(
  db: SupabaseClient,
  projectId: string,
  findings: RadarFinding[],
  opts: { triggeredBy: string; summary?: Record<string, unknown> },
): Promise<{ runId: string; findings: number }> {
  const status = findings.some((f) => f.severity === 'error')
    ? 'fail'
    : findings.length > 0
      ? 'warn'
      : 'pass'
  const { data: run, error: runErr } = await db
    .from('gate_runs')
    .insert({
      project_id: projectId,
      gate: 'radar',
      status,
      triggered_by: opts.triggeredBy,
      findings_count: findings.length,
      summary: { rules: [...new Set(findings.map((f) => f.rule_id))], ...(opts.summary ?? {}) },
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (runErr || !run) throw new RadarWriteError('gate_runs', runErr?.message ?? 'no row returned')

  if (findings.length > 0) {
    const { error: findErr } = await db.from('gate_findings').insert(
      findings.map((f) => ({
        gate_run_id: run.id,
        project_id: projectId,
        severity: f.severity,
        rule_id: f.rule_id,
        message: f.message,
        suggested_fix: f.suggested_fix ?? null,
      })),
    )
    if (findErr) throw new RadarWriteError('gate_findings', findErr.message)
  }
  return { runId: run.id as string, findings: findings.length }
}

/**
 * A project whose checks could not run gets an `error` run. That keeps the
 * once-a-day interval (no retry every 15 minutes, no Sentry event per tick)
 * and shows the failure where the findings would have been.
 */
export async function recordRadarFailure(
  db: SupabaseClient,
  projectId: string,
  message: string,
  opts: { triggeredBy: string },
): Promise<void> {
  const { error } = await db.from('gate_runs').insert({
    project_id: projectId,
    gate: 'radar',
    status: 'error',
    triggered_by: opts.triggeredBy,
    findings_count: 0,
    summary: { error: message.slice(0, 500) },
    completed_at: new Date().toISOString(),
  })
  if (error) throw new RadarWriteError('gate_runs error run', error.message)
}
