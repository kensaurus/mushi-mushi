/**
 * FILE: packages/server/supabase/functions/_shared/ops-sources.ts
 * PURPOSE: Mushi Mushi's own Ops sources, so an app needs no code for these
 *          (docs/execplans/ops-hub-slack.md §4). Each turns something Mushi
 *          Mushi already receives into Ops events; emitOpsEvent then records
 *          them only for organizations whose Slack bot is switched on.
 *
 *   GitHub deployment_status (webhooks-github-indexer, GitHub App only):
 *     production success → `releases` "<sha> is live" with the commit
 *     subject (its own message) and a `resolved` in the alerts thread when a
 *     production deploy failed; production failure / error → `alerts`
 *     urgent. Thread `deploy:<repo>:production`. The release waits
 *     DEPLOY_RELEASE_WAIT_MS, then is dropped when the app already posted a
 *     release for that commit in the last 30 minutes (mushi-mushi's own
 *     release posts arrive 1-3 s after GitHub's event; an app post that comes
 *     later deletes this one, ops-events.ts). One post per app and commit
 *     (dedupe `gh-deploy:<repo>:<sha>:<day>`). tsumagoi has no post of its own
 *     (its deploy.yml leaves good deploys to this, unless its repo variable
 *     MUSHI_DEPLOYMENT_EVENTS is `off`), so its post stays.
 *   Sentry (the /v1/webhooks/sentry alert and the auto-import poll; never a
 *     manual import), forwarded by `api` through _shared/ops-forward.ts to
 *     api-ext's /v1/internal/ops/sentry: a new issue of level error or fatal, or a regression,
 *     → `alerts`; Sentry's own resolve → `resolved` in the same thread.
 *     Thread `sentry:<issue>`; dedupe on issue id + first seen. The title is
 *     the error's first line, JSON moved to a code snippet, at most 120
 *     characters. The Environment fact is the event's own, or "not set":
 *     never assumed to be production. A named non-production environment is
 *     skipped.
 *   Edge canaries (site-watch-poll's hourly pass): a canary failing for the
 *     second run in a row → `alerts` urgent "… is down"; that canary passing
 *     again → `resolved` in the same thread. Thread `uptime:<url>`.
 *
 * The builders are pure (vitest drives them); the route helpers only look up
 * the projects a delivery belongs to.
 */

import { cleanErrorTitle, cutAtWord, OPS_ERROR_TITLE_MAX, type OpsEventInput } from './ops-format.ts'
import { releasesForCommit, scheduleOpsEvent, type OpsDeps } from './ops-events.ts'

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
  const repoName = repo.split('/').pop() ?? repo
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
      // No thread: every release is its own message in #releases. One per commit and
      // day: two production environments deploying one sha (df894db, 2026-11-20) post
      // once; a rollback to it on another day posts again.
      { category: 'releases', severity: 'info', kind: 'deploy.succeeded', title: version ? `${version} is live in ${env}` : `${repoName} is live in ${env}`, facts, url, threadKey: null, dedupeKey: short ? `gh-deploy:${repo}:${short}:${(occurredAt ?? new Date().toISOString()).slice(0, 10)}` : `gh-deploy-status:${statusId}`, occurredAt, source: 'github' },
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
 * How long a deploy's release waits before it checks for the app's own post.
 * mushi-mushi's release posts land 1-3 s after GitHub's event; webhooks-github-indexer
 * runs this under waitUntil, far inside the edge function's wall-clock limit.
 * @internal Exported for tests.
 */
export const DEPLOY_RELEASE_WAIT_MS = 20_000

interface DeployOpsDeps {
  /** The commit's subject (first line), or null. Injected: the GitHub App token lives in webhooks-github-indexer. */
  commitSubject?: (repo: string, sha: string, installationId: number) => Promise<string | null>
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
  /** Passed to the Ops emitter (tests inject Slack's fetch here). */
  ops?: OpsDeps
}

/**
 * Route one deployment_status delivery to the projects bound to that repo
 * under that installation, and schedule its events (waitUntil). The resolve
 * only posts when the alerts thread is still open. A production release
 * waits, then is dropped when the app already posted that commit, else posts
 * with the commit subject. Never throws.
 */
export async function routeGithubDeployOps(db: Db, p: DeploymentStatusPayload, deps: DeployOpsDeps = {}): Promise<number> {
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
    const release = events.find((e) => e.category === 'releases')
    for (const projectId of projectIds) {
      for (const input of events) {
        if (input !== release) scheduleOpsEvent(db, { projectId, input, requireOpenThread: input.severity === 'resolved' }, deps.ops)
      }
    }
    if (release && projectIds.length) await postDeployRelease(db, release, projectIds, { repo, sha: (p.deployment?.sha ?? '').trim(), installationId }, deps)
    return projectIds.length
  } catch {
    return 0
  }
}

async function postDeployRelease(db: Db, release: OpsEventInput, projectIds: string[], src: { repo: string; sha: string; installationId: number }, deps: DeployOpsDeps): Promise<void> {
  await (deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))))(DEPLOY_RELEASE_WAIT_MS)
  const now = (deps.now ?? (() => new Date()))()
  let subject: string | null | undefined
  for (const projectId of projectIds) {
    const sha = /^[0-9a-f]{7,64}$/i.test(src.sha) ? src.sha : null
    // The app (or another production environment) already said this commit is live.
    if (sha && (await releasesForCommit(db, projectId, sha, now)).length > 0) continue
    if (subject === undefined) {
      subject = sha && deps.commitSubject ? await deps.commitSubject(src.repo, sha, src.installationId).catch(() => null) : null
    }
    const body = subject ? cutAtWord(subject.split('\n')[0], 300) : null
    await scheduleOpsEvent(db, { projectId, input: { ...release, body } }, deps.ops)
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

/** YYYY-MM-DD of an ISO time, else null. */
function isoDay(v: string | null | undefined): string | null {
  const ms = Date.parse(v ?? '')
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null
}

/**
 * A Sentry issue's title for Slack, never empty: the cleaned error message,
 * else the culprit, else "Sentry issue <id>". The JSON it carried, if any,
 * comes back as a snippet for the body.
 */
function sentryTitle(s: Pick<SentryOpsInput, 'title' | 'culprit' | 'issueId'>): { title: string; snippet: string | null } {
  const cleaned = cleanErrorTitle(s.title)
  if (cleaned.title) return cleaned
  const culprit = cutAtWord((s.culprit ?? '').trim(), OPS_ERROR_TITLE_MAX)
  return { title: culprit ? `Error in ${culprit}` : `Sentry issue ${s.issueId ?? ''}`.trim(), snippet: cleaned.snippet }
}

/** A Sentry issue as an Ops event, or null when it does not belong in #alerts. */
export function opsEventFromSentry(s: SentryOpsInput): OpsEventInput | null {
  if (!s.issueId) return null
  const threadKey = `sentry:${s.issueId}`
  const env = (s.environment ?? '').trim()
  if (env && !/^prod(uction)?$/i.test(env)) return null
  if (s.outcome === 'resolved') {
    const named = s.title ? sentryTitle(s).title : null
    return { category: 'alerts', severity: 'resolved', kind: 'sentry.resolved', title: named ? `Resolved in Sentry: ${named}` : 'Resolved in Sentry', url: https(s.url), threadKey, dedupeKey: `sentry:${s.issueId}:resolved:${s.regressionCount ?? 0}`, source: 'sentry' }
  }
  const level = (s.level ?? 'error').toLowerCase()
  if (level !== 'error' && level !== 'fatal') return null
  const regression = s.outcome === 'reopened'
  const { title, snippet } = sentryTitle(s)
  const firstSeen = isoDay(s.firstSeen)
  const facts = [
    // The event's own environment, or "not set": an unset one is never shown as production.
    { label: 'Environment', value: env || 'not set' },
    { label: 'Level', value: level },
    ...(s.release ? [{ label: 'Release', value: s.release.slice(0, 80) }] : []),
    ...(regression && firstSeen ? [{ label: 'First seen', value: firstSeen }] : []),
  ]
  const body = [s.culprit ? `in ${s.culprit}` : null, snippet ? `\`\`\`${snippet.replace(/```/g, "'''")}\`\`\`` : null].filter(Boolean).join('\n')
  return {
    category: 'alerts',
    severity: regression || level === 'fatal' ? 'urgent' : 'warn',
    kind: regression ? 'sentry.regression' : 'sentry.new_issue',
    title: regression ? `Regressed: ${title}` : title,
    body: body || null,
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
