/**
 * FILE: packages/server/supabase/functions/_shared/ops-sources.ts
 * PURPOSE: Mushi Mushi's own Ops sources, so an app needs no code for these
 *          (docs/execplans/ops-hub-slack.md §4). Each turns something Mushi
 *          Mushi already receives into Ops events; emitOpsEvent then records
 *          them only for organizations whose Slack bot is switched on.
 *
 *   GitHub deployment_status (webhooks-github-indexer, GitHub App only):
 *     production success → `releases` "Deployed …" (its own message) and
 *     a `resolved` in the alerts thread when a production deploy failed;
 *     production failure / error → `alerts` urgent. Thread
 *     `deploy:<repo>:production`; dedupe on the deployment status id.
 *   Sentry (the /v1/webhooks/sentry alert and the auto-import poll; never a
 *     manual import), forwarded by `api` through _shared/ops-forward.ts to
 *     api-ext's /v1/internal/ops/sentry: a new issue of level error or fatal, or a regression,
 *     → `alerts`; Sentry's own resolve → `resolved` in the same thread.
 *     Thread `sentry:<issue>`; dedupe on issue id + first seen. An event
 *     with no environment counts as production (many SDKs leave it unset in
 *     production); any other named environment is skipped.
 *   Edge canaries (site-watch-poll's hourly pass): a canary failing for the
 *     second run in a row → `alerts` urgent "… is down"; that canary passing
 *     again → `resolved` in the same thread. Thread `uptime:<url>`.
 *
 * The builders are pure (vitest drives them); the route helpers only look up
 * the projects a delivery belongs to.
 */

import type { OpsEventInput } from './ops-format.ts'
import { scheduleOpsEvent } from './ops-events.ts'

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }

const https = (u: unknown): string | null => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null)

// ── GitHub deployments ──────────────────────────────────────────────────────

export interface DeploymentStatusPayload {
  deployment_status?: { id?: number | string; state?: string | null; environment?: string | null; target_url?: string | null; log_url?: string | null; environment_url?: string | null; created_at?: string | null; description?: string | null }
  deployment?: { id?: number | string; sha?: string | null; ref?: string | null; environment?: string | null; production_environment?: boolean | null }
  repository?: { full_name?: string }
  installation?: { id?: number }
}

/** True for a production deployment (GitHub's flag, or an environment named prod / production). */
export function isProductionDeployment(p: DeploymentStatusPayload): boolean {
  const env = (p.deployment_status?.environment ?? p.deployment?.environment ?? '').trim()
  return p.deployment?.production_environment === true || /^prod(uction)?$/i.test(env)
}

/**
 * The events one deployment_status delivery makes, in order. Empty for a
 * non-production deploy or a state in flight (queued, in_progress, pending).
 */
export function opsEventsFromDeploymentStatus(p: DeploymentStatusPayload): OpsEventInput[] {
  if (!isProductionDeployment(p)) return []
  const state = (p.deployment_status?.state ?? '').toLowerCase()
  const repo = p.repository?.full_name
  const statusId = p.deployment_status?.id
  if (!repo || statusId == null) return []
  const sha = (p.deployment?.sha ?? '').trim()
  const short = /^[0-9a-f]{7,64}$/i.test(sha) ? sha.slice(0, 7) : null
  const ref = (p.deployment?.ref ?? '').trim()
  const version = /^v?\d+\.\d+/.test(ref) ? ref : short ?? ref.slice(0, 40)
  const env = (p.deployment_status?.environment ?? p.deployment?.environment ?? 'production').trim().slice(0, 40)
  const threadKey = `deploy:${repo}:production`
  const facts = [
    { label: 'Repo', value: repo },
    { label: 'Environment', value: env },
    ...(short ? [{ label: 'Commit', value: short }] : []),
  ]
  const url = https(p.deployment_status?.target_url) ?? https(p.deployment_status?.log_url) ?? https(p.deployment_status?.environment_url)
  const occurredAt = p.deployment_status?.created_at && Number.isFinite(Date.parse(p.deployment_status.created_at)) ? new Date(p.deployment_status.created_at).toISOString() : null
  if (state === 'success') {
    return [
      // No thread: every release is its own message in #releases.
      { category: 'releases', severity: 'info', kind: 'deploy.succeeded', title: `Deployed ${version || 'to production'}`, facts, url, threadKey: null, dedupeKey: `gh-deploy-status:${statusId}`, occurredAt, source: 'github' },
      { category: 'alerts', severity: 'resolved', kind: 'deploy.recovered', title: `Fixed by the next deploy (${version || 'production'})`, facts, url, threadKey, dedupeKey: `gh-deploy-status:${statusId}:resolved`, occurredAt, source: 'github' },
    ]
  }
  if (state === 'failure' || state === 'error') {
    const why = (p.deployment_status?.description ?? '').trim()
    return [
      { category: 'alerts', severity: 'urgent', kind: 'deploy.failed', title: `Production deploy failed${version ? ` (${version})` : ''}`, body: why ? why.slice(0, 600) : null, facts, url, threadKey, dedupeKey: `gh-deploy-status:${statusId}`, occurredAt, source: 'github' },
    ]
  }
  return []
}

/**
 * Route one deployment_status delivery to the projects bound to that repo
 * under that installation, and schedule its events (waitUntil). The resolve
 * only posts when the alerts thread is still open. Never throws.
 */
export async function routeGithubDeployOps(db: Db, p: DeploymentStatusPayload): Promise<number> {
  const events = opsEventsFromDeploymentStatus(p)
  const installationId = p.installation?.id
  const repo = p.repository?.full_name
  if (events.length === 0 || !installationId || !repo) return 0
  try {
    const { data, error } = await db
      .from('project_repos')
      .select('project_id')
      .eq('repo_url', `https://github.com/${repo}`)
      .eq('github_app_installation_id', installationId)
      .limit(10)
    if (error) return 0
    const projectIds = [...new Set(((data ?? []) as Array<{ project_id: string }>).map((r) => r.project_id))]
    for (const projectId of projectIds) {
      for (const input of events) scheduleOpsEvent(db, { projectId, input, requireOpenThread: input.severity === 'resolved' })
    }
    return projectIds.length
  } catch {
    return 0
  }
}

// ── Sentry ──────────────────────────────────────────────────────────────────

export interface SentryOpsInput {
  outcome: 'created' | 'reopened' | 'resolved'
  issueId: string | null
  title: string | null
  culprit?: string | null
  level?: string | null
  environment?: string | null
  release?: string | null
  url?: string | null
  /** Issue first seen (or the event time) for a new issue's dedupe key. */
  firstSeen?: string | null
  /** The report's regression count after a reopen. */
  regressionCount?: number
}

/** A Sentry issue as an Ops event, or null when it does not belong in #alerts. */
export function opsEventFromSentry(s: SentryOpsInput): OpsEventInput | null {
  if (!s.issueId) return null
  const threadKey = `sentry:${s.issueId}`
  const env = (s.environment ?? '').trim()
  if (env && !/^prod(uction)?$/i.test(env)) return null
  if (s.outcome === 'resolved') {
    return { category: 'alerts', severity: 'resolved', kind: 'sentry.resolved', title: `Resolved in Sentry: ${s.title ?? `issue ${s.issueId}`}`, url: https(s.url), threadKey, dedupeKey: `sentry:${s.issueId}:resolved:${s.regressionCount ?? 0}`, source: 'sentry' }
  }
  const level = (s.level ?? 'error').toLowerCase()
  if (level !== 'error' && level !== 'fatal') return null
  if (!s.title) return null
  const regression = s.outcome === 'reopened'
  const facts = [
    { label: 'Level', value: level },
    ...(env ? [{ label: 'Environment', value: env }] : []),
    ...(s.release ? [{ label: 'Release', value: s.release.slice(0, 60) }] : []),
  ]
  return {
    category: 'alerts',
    severity: regression || level === 'fatal' ? 'urgent' : 'warn',
    kind: regression ? 'sentry.regression' : 'sentry.new_issue',
    title: regression ? `Came back: ${s.title}` : s.title,
    body: s.culprit ? `in ${s.culprit}` : null,
    facts,
    url: https(s.url),
    threadKey,
    dedupeKey: regression ? `sentry:${s.issueId}:regression:${s.regressionCount ?? 1}` : `sentry:${s.issueId}:${s.firstSeen ?? 'new'}`,
    source: 'sentry',
  }
}

/** Schedule the Sentry event for a project (waitUntil). Never throws. */
export function scheduleSentryOps(db: Db, projectId: string, s: SentryOpsInput): void {
  const input = opsEventFromSentry(s)
  if (!input) return
  try {
    scheduleOpsEvent(db, { projectId, input, requireOpenThread: input.severity === 'resolved' })
  } catch {
    /* an Ops failure never touches Sentry intake */
  }
}

// ── Edge canaries (uptime) ──────────────────────────────────────────────────

export interface CanaryTransition {
  projectId: string
  canaryId: string
  label: string
  url: string
  state: 'down' | 'up'
  detail: string
  /** When the canary started failing (the incident's id). */
  failingSince: string | null
}

export function opsEventFromCanary(t: CanaryTransition): OpsEventInput {
  const threadKey = `uptime:${t.url}`.slice(0, 200)
  const since = t.failingSince ?? 'unknown'
  if (t.state === 'down') {
    return { category: 'alerts', severity: 'urgent', kind: 'uptime.down', title: `${t.label} is down`, body: t.detail.slice(0, 600), facts: [{ label: 'Check', value: t.label }], url: https(t.url), threadKey, dedupeKey: `uptime:${t.canaryId}:down:${since}`, source: 'uptime' }
  }
  return { category: 'alerts', severity: 'resolved', kind: 'uptime.up', title: `${t.label} is back up`, body: t.detail.slice(0, 600), facts: [{ label: 'Check', value: t.label }], url: https(t.url), threadKey, dedupeKey: `uptime:${t.canaryId}:up:${since}`, source: 'uptime' }
}

/** For CanaryRunDeps.onTransition in site-watch-poll. Never throws. */
export function scheduleCanaryOps(db: Db, t: CanaryTransition): void {
  try {
    scheduleOpsEvent(db, { projectId: t.projectId, input: opsEventFromCanary(t), requireOpenThread: t.state === 'up' })
  } catch {
    /* an Ops failure never touches the canary run */
  }
}
