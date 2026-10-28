/**
 * FILE: packages/server/supabase/functions/_shared/fresh-eyes-queue.ts
 * PURPOSE: "Run now" for the first-time user test (fresh-eyes runs, ADR 0053
 *          amendment 2026-10-28), the parts with no I/O: what the console may
 *          queue, where a new run starts by default, whether a computer of the
 *          user's can take it, when a queued run gives up, what a worker's
 *          claim carries, and what the run row says after the claim ends.
 *
 *          The console queues a `ux_runs` row (kind fresh_eyes, status
 *          queued). A local worker (ADR 0048) whose daemon says it can run
 *          fresh-eyes claims it through POST /v1/worker/claim and runs
 *          `mushi-ux fresh-eyes` on its machine, which syncs into that row.
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 */

import { hostOnline } from './work-lanes.ts'

/** A first-time visitor's goal when the app has none set; the console lets the person change it. */
export const DEFAULT_FRESH_EYES_GOAL = 'sign up and start using the app'
/** Mushi's own landing page and goal (its preset in packages/ux/src/fresh-eyes.ts sets the goal check). */
export const MUSHI_LANDING_URL = 'https://kensaur.us/mushi-mushi/'
export const MUSHI_FRESH_EYES_GOAL = 'get my first bug explained'

export const FRESH_EYES_SESSIONS_MAX = 5
export const FRESH_EYES_SESSIONS_DEFAULT = 3
/** Runs waiting or running for one app at once. */
export const FRESH_EYES_OPEN_MAX = 2
/** Runs one app may queue an hour. */
export const FRESH_EYES_QUEUED_PER_HOUR = 6
export const FRESH_EYES_QUEUE_RATE_SCOPE = 'fresh_eyes_queue'
/** A queued run nobody took in this long stops, with a reason. */
export const FRESH_EYES_QUEUED_TTL_MS = 24 * 3_600_000
/** An operator's grant to mint test accounts lasts this long after Run now. */
export const ACCOUNT_GRANT_MS = 2 * 3_600_000

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }

export interface FreshEyesRequest {
  url: string
  goal: string
  sessions: number
  /** Words on screen that mean the visitor made it; a plain phrase, never a pattern. */
  successText: string | null
  /** Look around only: no account, nothing filed. */
  dryRun: boolean
  /** Sign up with synthetic test accounts (operator, Mushi's own project). */
  withAccount: boolean
}

const CONTROL = /[\u0000-\u001f\u007f]/

function plainText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.replace(/\s+/g, ' ').trim()
  if (!s || s.length > max || CONTROL.test(s) || s.startsWith('-')) return null
  return s
}

/** An http(s) URL with a host, ≤ 500 characters, no credentials in it. */
export function startUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 500) return null
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (!u.hostname || u.username || u.password) return null
    return u.toString()
  } catch {
    return null
  }
}

/** What Run now may send. Anything else is refused, never dropped. */
export function parseFreshEyesRequest(raw: unknown): Parsed<FreshEyesRequest> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'Send a JSON body.' }
  const b = raw as Record<string, unknown>
  const allowed = new Set(['url', 'goal', 'sessions', 'successText', 'dryRun', 'withAccount'])
  const unknown = Object.keys(b).find((k) => !allowed.has(k))
  if (unknown) return { ok: false, message: `Unknown field "${unknown.slice(0, 40)}".` }
  const url = startUrl(b.url)
  if (!url) return { ok: false, message: 'The start page must be a web address that starts with https:// or http://.' }
  const goal = plainText(b.goal, 300)
  if (!goal) return { ok: false, message: 'Say in a few words what a new visitor came to do (up to 300 characters).' }
  const sessions = b.sessions === undefined ? FRESH_EYES_SESSIONS_DEFAULT : b.sessions
  if (typeof sessions !== 'number' || !Number.isInteger(sessions) || sessions < 1 || sessions > FRESH_EYES_SESSIONS_MAX) {
    return { ok: false, message: `Visitors must be a whole number from 1 to ${FRESH_EYES_SESSIONS_MAX}.` }
  }
  let successText: string | null = null
  if (b.successText != null && b.successText !== '') {
    successText = plainText(b.successText, 120)
    if (!successText) return { ok: false, message: 'The words that mean "made it" must be plain text, up to 120 characters.' }
  }
  if (b.dryRun !== undefined && typeof b.dryRun !== 'boolean') return { ok: false, message: 'dryRun must be true or false.' }
  if (b.withAccount !== undefined && typeof b.withAccount !== 'boolean') return { ok: false, message: 'withAccount must be true or false.' }
  const dryRun = b.dryRun === true
  const withAccount = b.withAccount === true
  if (dryRun && withAccount) return { ok: false, message: 'A look-around run uses no account. Pick one of the two.' }
  return { ok: true, value: { url, goal, sessions, successText, dryRun, withAccount } }
}

/** A run id in the CLI's format (`20261028-091500-ab12`), UTC. */
export function newLocalRunId(now: Date, random: Uint8Array): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}`
  const time = `${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const suffix = [...random.slice(0, 4)].map((b) => alphabet[b % alphabet.length]).join('')
  if (suffix.length !== 4) throw new Error('need 4 random bytes')
  return `${date}-${time}-${suffix}`
}

export type StartUrlSource = 'site_watch' | 'site_audit' | 'crawler' | 'mushi' | 'last_run'

/**
 * Where a new run starts: the app's own address as Mushi already knows it
 * (the last run, the live-site watch, the site audit, the crawler setting),
 * and Mushi's landing page only for Mushi's own project. Null when the app
 * has no known address: the person types it.
 */
export function defaultStartUrl(known: { lastRun?: string | null; siteWatch?: string | null; siteAudit?: string | null; crawler?: string | null; isMushi: boolean }): { url: string; source: StartUrlSource } | null {
  const order: Array<[string | null | undefined, StartUrlSource]> = [
    [known.lastRun, 'last_run'],
    [known.siteWatch, 'site_watch'],
    [known.siteAudit, 'site_audit'],
    [known.crawler, 'crawler'],
  ]
  for (const [raw, source] of order) {
    const url = startUrl(raw)
    if (url) return { url, source }
  }
  return known.isMushi ? { url: MUSHI_LANDING_URL, source: 'mushi' } : null
}

/**
 * Test accounts are offered only where minting can work: an operator, in a
 * console session (never an API key), on Mushi's own project.
 */
export function canUseTestAccount(ctx: { isOperator: boolean; authMethod: string | undefined; projectId: string; selfProjectId: string | null | undefined }): boolean {
  return ctx.isOperator && ctx.authMethod !== 'apiKey' && !!ctx.selfProjectId && ctx.selfProjectId.toLowerCase() === ctx.projectId.toLowerCase()
}

// ── Can a computer take it ──────────────────────────────────────────────────

export type RunnerState = 'ready' | 'busy' | 'paused' | 'outdated' | 'offline' | 'none'

export interface RunnerHost {
  id: string
  hostname: string
  last_heartbeat_at: string | null
  revoked_at: string | null
  takes: string[] | null
}

export interface RunnerLane {
  host_id: string
  mode: string
  paused: boolean
  drain: boolean
  stop_at: string | null
  concurrency: number
}

export interface Runner {
  state: RunnerState
  /** The computer that will (or would) take it. */
  hostname: string | null
  lastSeenAt: string | null
}

/**
 * Whether a computer of the user's can run a first-time user test of this
 * app now. A lane takes a queued run before its own work when its daemon says
 * it can run fresh-eyes (`work_hosts.takes`), it claims at all (not a
 * follow-ups lane), and it is not paused, draining or past its stop date.
 * `busy` = such a lane exists but runs its limit: the run waits its turn.
 */
export function freshEyesRunner(lanes: readonly RunnerLane[], hosts: readonly RunnerHost[], activeClaimsByHost: ReadonlyMap<string, number>, now: Date): Runner {
  const byId = new Map(hosts.map((h) => [h.id, h]))
  const live = hosts.filter((h) => !h.revoked_at)
  const mine = lanes.filter((l) => live.some((h) => h.id === l.host_id))
  if (mine.length === 0) return { state: 'none', hostname: null, lastSeenAt: null }
  const online = mine.filter((l) => hostOnline(byId.get(l.host_id)?.last_heartbeat_at, now))
  if (online.length === 0) {
    const seen = [...new Set(mine.map((l) => l.host_id))].map((id) => byId.get(id)!).sort((a, b) => (b.last_heartbeat_at ?? '').localeCompare(a.last_heartbeat_at ?? ''))[0]
    return { state: 'offline', hostname: seen?.hostname ?? null, lastSeenAt: seen?.last_heartbeat_at ?? null }
  }
  const capable = online.filter((l) => (byId.get(l.host_id)?.takes ?? []).includes('fresh_eyes'))
  const first = byId.get(online[0]!.host_id)!
  if (capable.length === 0) return { state: 'outdated', hostname: first.hostname, lastSeenAt: first.last_heartbeat_at }
  const claiming = capable.filter((l) => l.mode !== 'followups' && !l.paused && !l.drain && !(l.stop_at && Date.parse(l.stop_at) <= now.getTime()))
  const host = (l: RunnerLane) => byId.get(l.host_id)!
  if (claiming.length === 0) return { state: 'paused', hostname: host(capable[0]!).hostname, lastSeenAt: host(capable[0]!).last_heartbeat_at }
  const free = claiming.find((l) => (activeClaimsByHost.get(l.host_id) ?? 0) < l.concurrency)
  const pick = free ?? claiming[0]!
  return { state: free ? 'ready' : 'busy', hostname: host(pick).hostname, lastSeenAt: host(pick).last_heartbeat_at }
}

/** The answer to Run now when no computer can take the run, in plain words; null when it may be queued. */
export function runnerRefusal(r: Runner): string | null {
  switch (r.state) {
    case 'ready':
    case 'busy':
      return null
    case 'none':
      return 'No computer of yours runs Mushi for this app yet. The test runs on your computer, where its browser and AI run. Set one up once on Pipeline → Workers.'
    case 'offline':
      return `Your computer${r.hostname ? ` ${r.hostname}` : ''} is not online, so nothing can run the test. Turn it on, or start the worker on it (mushi work --daemon), then press Run now again.`
    case 'outdated':
      return `The Mushi on ${r.hostname ?? 'your computer'} is too old to run this test. Update it (npm i -g @mushi-mushi/cli@latest) and restart it.`
    case 'paused':
      return `Every lane for this app on ${r.hostname ?? 'your computer'} is paused, draining or only fixes review findings. Turn one back on on Pipeline → Workers.`
  }
}

/** A queued run nobody took within the time limit. */
export function queuedRunExpired(startedAt: string, now: Date): boolean {
  const at = Date.parse(startedAt)
  return Number.isFinite(at) && now.getTime() - at > FRESH_EYES_QUEUED_TTL_MS
}

export const QUEUED_EXPIRED_DETAIL = 'No computer picked it up within a day, so it was not run.'

// ── The claim ───────────────────────────────────────────────────────────────

export interface QueuedFreshEyesRow {
  id: string
  local_run_id: string
  project_id: string
  start_url: string | null
  goal: string | null
  sessions_requested: number | null
  success_text: string | null
  dry_run: boolean | null
  started_at: string
  account_granted_by: string | null
  account_grant_until: string | null
}

/** True when the claim may mint test accounts: the grant is unexpired, made by an operator, and the claiming computer is that operator's. */
export function accountGrantUsable(row: Pick<QueuedFreshEyesRow, 'account_granted_by' | 'account_grant_until' | 'project_id'>, ctx: { hostOwnerId: string; isOperator: (userId: string) => boolean; selfProjectId: string | null | undefined; now: Date }): boolean {
  if (!row.account_granted_by || !row.account_grant_until) return false
  if (Date.parse(row.account_grant_until) <= ctx.now.getTime()) return false
  if (row.account_granted_by !== ctx.hostOwnerId) return false
  if (!ctx.isOperator(row.account_granted_by)) return false
  return !!ctx.selfProjectId && ctx.selfProjectId.toLowerCase() === row.project_id.toLowerCase()
}

/** What the worker gets for a fresh-eyes claim. `accounts` are present once, only in this answer. */
export function freshEyesClaimTarget(row: QueuedFreshEyesRow, accounts: ReadonlyArray<{ email: string; password: string; name: string; userId: string }>) {
  return {
    runId: row.local_run_id,
    url: row.start_url ?? '',
    goal: row.goal ?? '',
    sessions: row.sessions_requested ?? FRESH_EYES_SESSIONS_DEFAULT,
    successText: row.success_text,
    dryRun: row.dry_run === true,
    accounts: [...accounts],
  }
}

/**
 * The ux_runs patch when a fresh-eyes claim ends, or null when the run row
 * already says how it ended (the CLI synced it done or failed). A run the
 * worker never finished says why.
 */
export function uxRunAfterClaim(outcome: string, detail: string | null, runStatus: string): Record<string, unknown> | null {
  if (runStatus === 'done' || runStatus === 'failed' || runStatus === 'stopped') return null
  const why = (detail ?? '').replace(/\s+/g, ' ').trim().slice(0, 600)
  switch (outcome) {
    case 'ran':
      // The worker says it finished, but the run never synced as finished.
      return { status: 'failed', detail: why ? `The test ended but its result did not reach Mushi: ${why}` : 'The test ended but its result did not reach Mushi.' }
    case 'stopped':
      return { status: 'stopped', detail: why || 'The computer stopped before the test finished.' }
    case 'skipped':
      return { status: 'stopped', detail: why || 'The computer could not take this test.' }
    case 'timeout':
      return { status: 'failed', detail: why || 'The test took too long and was stopped.' }
    case 'lease_expired':
      return { status: 'failed', detail: 'The computer stopped answering during the test (it was turned off, lost its network or crashed).' }
    default:
      return { status: 'failed', detail: why || 'The test failed on the computer.' }
  }
}
