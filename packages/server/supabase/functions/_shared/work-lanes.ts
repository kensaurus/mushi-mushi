/**
 * FILE: packages/server/supabase/functions/_shared/work-lanes.ts
 * PURPOSE: Local workers (ADR 0048), the parts with no I/O: what a heartbeat
 *          may say, the closed set of lane settings the server answers with,
 *          which reports a lane may claim and in what order, and the claim
 *          race. Used by api/routes/work.ts; vitest imports it directly.
 *
 *          Control is pull-only. The daemon on the user's machine asks every
 *          60 s; the reply carries only these values per lane: paused,
 *          concurrency, model, mode, stop_at, drain, prune_own, and per host
 *          the guard numbers (max agents, free-memory floor, GitHub
 *          rate-limit floor). No command, no path, no free text: a parser on
 *          each side refuses anything else.
 */

/**
 * What a lane does (ADR 0048; P3 modes: ADR 0049 conflicts, ADR 0050 audit,
 * ADR 0042 amendment skill). An older daemon refuses a mode it does not know
 * and leaves that lane idle.
 */
export const LANE_MODES = ['fix', 'followups', 'conflicts', 'audit', 'skill'] as const
export type LaneMode = (typeof LANE_MODES)[number]

/** The verbs a heartbeat answers with, per lane. Nothing else ever leaves the server for a lane. */
export const LANE_VERBS = ['paused', 'concurrency', 'model', 'mode', 'stop_at', 'drain', 'prune_own'] as const
export type LaneVerb = (typeof LANE_VERBS)[number]

export interface LaneConfig {
  paused: boolean
  concurrency: number
  /** The agent's model id (`cursor-agent --model`); null = the agent's default. */
  model: string | null
  mode: LaneMode
  /** ISO time after which the lane claims nothing (credits that end, ADR 0028). */
  stop_at: string | null
  /** Finish what runs, claim nothing new. */
  drain: boolean
  /** Remove the worker's own merged or closed worktrees and branches (P4: accepted, not acted on yet). */
  prune_own: boolean
}

export const LANE_CONCURRENCY_MAX = 4
/** A model id: letters, digits and `._:-`, as Cursor and Anthropic spell them. Never a flag or a path. */
export const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
export const LANE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/
const HOST_ID_RE = /^[0-9a-f]{64}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }

/**
 * Parse lane settings. Every key must be one of LANE_VERBS with its type;
 * anything else is refused, never dropped. `partial` (a console PATCH)
 * accepts a subset; otherwise (the heartbeat answer) all seven are required.
 */
export function parseLaneVerbs(raw: unknown, opts: { partial: true }): Parsed<Partial<LaneConfig>>
export function parseLaneVerbs(raw: unknown, opts?: { partial?: false }): Parsed<LaneConfig>
export function parseLaneVerbs(raw: unknown, opts: { partial?: boolean } = {}): Parsed<Partial<LaneConfig>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'Lane settings must be an object.' }
  const out: Partial<LaneConfig> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    switch (key as LaneVerb) {
      case 'paused':
      case 'drain':
      case 'prune_own':
        if (typeof value !== 'boolean') return { ok: false, message: `${key} must be true or false.` }
        out[key as 'paused' | 'drain' | 'prune_own'] = value
        break
      case 'concurrency':
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > LANE_CONCURRENCY_MAX) {
          return { ok: false, message: `concurrency must be a whole number from 1 to ${LANE_CONCURRENCY_MAX}.` }
        }
        out.concurrency = value
        break
      case 'model':
        if (value !== null && (typeof value !== 'string' || !MODEL_RE.test(value))) {
          return { ok: false, message: 'model must be a model id (letters, digits, ".", "_", ":", "-") or null for the default.' }
        }
        out.model = value as string | null
        break
      case 'mode':
        if (typeof value !== 'string' || !(LANE_MODES as readonly string[]).includes(value)) {
          return { ok: false, message: `mode must be one of ${LANE_MODES.join(', ')}.` }
        }
        out.mode = value as LaneMode
        break
      case 'stop_at':
        if (value !== null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) {
          return { ok: false, message: 'stop_at must be an ISO date and time, or null.' }
        }
        out.stop_at = value === null ? null : new Date(value as string).toISOString()
        break
      default:
        return { ok: false, message: `Unknown lane setting "${key.slice(0, 40)}". Allowed: ${LANE_VERBS.join(', ')}.` }
    }
  }
  if (!opts.partial) {
    const missing = LANE_VERBS.filter((v) => !(v in out))
    if (missing.length) return { ok: false, message: `Lane settings are missing ${missing.join(', ')}.` }
  }
  if (opts.partial && Object.keys(out).length === 0) return { ok: false, message: `Send at least one of ${LANE_VERBS.join(', ')}.` }
  return { ok: true, value: out }
}

/** A work_lanes row → the closed answer for that lane. */
export function laneConfigFromRow(row: {
  paused: boolean
  concurrency: number
  model: string | null
  mode: string
  stop_at: string | null
  drain: boolean
  prune_own: boolean
}): LaneConfig {
  return {
    paused: row.paused,
    concurrency: row.concurrency,
    model: row.model,
    mode: (LANE_MODES as readonly string[]).includes(row.mode) ? (row.mode as LaneMode) : 'fix',
    stop_at: row.stop_at ? new Date(row.stop_at).toISOString() : null,
    drain: row.drain,
    prune_own: row.prune_own,
  }
}

/**
 * What the console may change on a lane: the seven verbs, plus `review_model`
 * (an audit lane's optional veto model, ADR 0050). `review_model` is not a
 * heartbeat verb: it travels in the audit claim, so a daemon that predates it
 * never sees an unknown key.
 */
export type LaneSettings = Partial<LaneConfig> & { review_model?: string | null }

export function parseLaneSettings(raw: unknown): Parsed<LaneSettings> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'Lane settings must be an object.' }
  const { review_model: reviewModel, ...rest } = raw as Record<string, unknown>
  const out: LaneSettings = {}
  if (reviewModel !== undefined) {
    if (reviewModel !== null && (typeof reviewModel !== 'string' || !MODEL_RE.test(reviewModel))) {
      return { ok: false, message: 'review_model must be a model id (letters, digits, ".", "_", ":", "-") or null for no veto pass.' }
    }
    out.review_model = reviewModel as string | null
  }
  if (Object.keys(rest).length === 0) {
    return reviewModel === undefined ? { ok: false, message: `Send at least one of ${[...LANE_VERBS, 'review_model'].join(', ')}.` } : { ok: true, value: out }
  }
  const verbs = parseLaneVerbs(rest, { partial: true })
  if (!verbs.ok) return verbs
  return { ok: true, value: { ...verbs.value, ...out } }
}

/** owner/name of a GitHub repository, as a lane's clone names it (a value, never a path). */
export const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/

/** Host-wide guards the daemon applies on the machine, from the server (defaults are lane-v4's). */
export const HOST_GUARD_KEYS = ['max_agents', 'min_free_mem_gb', 'gh_floor'] as const
export interface HostGuards {
  /** Agents at once across every lane on the host. */
  max_agents: number
  /** Claim nothing while less memory than this is free. */
  min_free_mem_gb: number
  /** Claim nothing while fewer GitHub API calls than this are left. */
  gh_floor: number
}
export const DEFAULT_HOST_GUARDS: HostGuards = { max_agents: 6, min_free_mem_gb: 5, gh_floor: 800 }
const GUARD_RANGE: Record<keyof HostGuards, [number, number]> = { max_agents: [1, 16], min_free_mem_gb: [0, 256], gh_floor: [0, 5000] }

export function parseHostGuards(raw: unknown, opts: { partial?: boolean } = {}): Parsed<Partial<HostGuards>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'Host guards must be an object.' }
  const out: Partial<HostGuards> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(HOST_GUARD_KEYS as readonly string[]).includes(key)) {
      return { ok: false, message: `Unknown host setting "${key.slice(0, 40)}". Allowed: ${HOST_GUARD_KEYS.join(', ')}.` }
    }
    const [lo, hi] = GUARD_RANGE[key as keyof HostGuards]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < lo || value > hi) {
      return { ok: false, message: `${key} must be a whole number from ${lo} to ${hi}.` }
    }
    out[key as keyof HostGuards] = value
  }
  if (!opts.partial && HOST_GUARD_KEYS.some((k) => !(k in out))) return { ok: false, message: `Host guards need ${HOST_GUARD_KEYS.join(', ')}.` }
  if (opts.partial && Object.keys(out).length === 0) return { ok: false, message: `Send at least one of ${HOST_GUARD_KEYS.join(', ')}.` }
  return { ok: true, value: out }
}

/** A guards jsonb (work_hosts.guards) with defaults for anything missing or out of range. */
export function hostGuardsFrom(raw: unknown): HostGuards {
  const out = { ...DEFAULT_HOST_GUARDS }
  if (raw && typeof raw === 'object') {
    for (const k of HOST_GUARD_KEYS) {
      const one = parseHostGuards({ [k]: (raw as Record<string, unknown>)[k] }, { partial: true })
      if (one.ok && typeof one.value[k] === 'number') out[k] = one.value[k] as number
    }
  }
  return out
}

// ── What the daemon sends ───────────────────────────────────────────────────

export const HOST_STATES = ['starting', 'working', 'idle', 'paused', 'mem-wait', 'gh-quota-wait', 'auth-wait', 'slot-wait', 'backoff', 'stopped', 'draining'] as const
export const MAX_LANES_PER_HOST = 20

export interface HeartbeatLane {
  name: string
  projectId: string
  /** lane-v4's status JSON, as numbers and one short state word. */
  status: Record<string, string | number>
  /** Settings the machine proposes for a lane it registers (lanes.conf import); used only when the lane is new. */
  initial: Partial<LaneConfig>
  /** owner/name of the lane's clone (its origin remote); null from a daemon that predates P3. */
  repo: string | null
}

export interface Heartbeat {
  host: { hostId: string; hostname: string; platform: 'linux' | 'wsl2' | 'macos' | 'windows'; version: string | null }
  status: Record<string, string | number | boolean>
  lanes: HeartbeatLane[]
  /** Active claims the daemon is still working on: their leases are renewed. */
  claims: string[]
}

const STATUS_NUMBERS = ['runs', 'prs', 'pushes', 'timeouts', 'errors', 'idle', 'agentMin', 'agents', 'maxAgents', 'memAvailableGb', 'ghRemaining', 'worktrees', 'branches']
const STATUS_WORDS: Record<string, readonly string[]> = {
  state: HOST_STATES,
  cursor: ['signed_in', 'signed_out', 'unknown', 'missing'],
}

/**
 * Keep only known status fields: numbers (finite, ≥ 0) and the words above,
 * plus `last` (≤ 160 printable characters, what lane-v4 printed as its last
 * moves). Unknown keys are dropped: this is telemetry, not control.
 */
export function cleanStatus(raw: unknown): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (STATUS_NUMBERS.includes(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = Math.round(v * 10) / 10
    else if (STATUS_WORDS[k] && typeof v === 'string' && STATUS_WORDS[k]!.includes(v)) out[k] = v
    else if (k === 'last' && typeof v === 'string') out[k] = v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160)
  }
  return out
}

export function parseHeartbeat(raw: unknown): Parsed<Heartbeat> {
  if (!raw || typeof raw !== 'object') return { ok: false, message: 'Send a JSON body.' }
  const b = raw as Record<string, unknown>
  const h = (b.host ?? {}) as Record<string, unknown>
  if (typeof h.hostId !== 'string' || !HOST_ID_RE.test(h.hostId)) return { ok: false, message: 'host.hostId must be the 64-hex sha256 of the machine id.' }
  const hostname = typeof h.hostname === 'string' ? h.hostname.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80) : ''
  if (!hostname) return { ok: false, message: 'host.hostname is required.' }
  if (!['linux', 'wsl2', 'macos', 'windows'].includes(String(h.platform))) return { ok: false, message: 'host.platform must be linux, wsl2, macos or windows.' }
  const version = typeof h.version === 'string' && /^[0-9A-Za-z.+-]{1,40}$/.test(h.version) ? h.version : null
  const lanesRaw = Array.isArray(b.lanes) ? b.lanes : []
  if (lanesRaw.length > MAX_LANES_PER_HOST) return { ok: false, message: `At most ${MAX_LANES_PER_HOST} lanes per host.` }
  const lanes: HeartbeatLane[] = []
  const names = new Set<string>()
  for (const l of lanesRaw as Array<Record<string, unknown>>) {
    const name = typeof l?.name === 'string' ? l.name : ''
    if (!LANE_NAME_RE.test(name)) return { ok: false, message: `Lane name "${String(l?.name).slice(0, 40)}" must be 1-40 lowercase letters, digits, ".", "_" or "-".` }
    if (names.has(name)) return { ok: false, message: `Lane "${name}" is listed twice.` }
    names.add(name)
    if (typeof l.projectId !== 'string' || !UUID_RE.test(l.projectId)) return { ok: false, message: `Lane "${name}" needs a projectId.` }
    let initial: Partial<LaneConfig> = {}
    if (l.initial != null) {
      const p = parseLaneVerbs(l.initial, { partial: true })
      if (!p.ok) return { ok: false, message: `Lane "${name}": ${p.message}` }
      initial = p.value
    }
    if (l.repo != null && (typeof l.repo !== 'string' || !REPO_RE.test(l.repo))) return { ok: false, message: `Lane "${name}": repo must be owner/name.` }
    lanes.push({ name, projectId: l.projectId.toLowerCase(), status: cleanStatus(l.status), initial, repo: typeof l.repo === 'string' ? l.repo.toLowerCase() : null })
  }
  const claims = (Array.isArray(b.claims) ? b.claims : []).filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)).slice(0, 50)
  const status = cleanStatus(b.status)
  return {
    ok: true,
    value: { host: { hostId: h.hostId, hostname, platform: h.platform as Heartbeat['host']['platform'], version }, status, lanes, claims },
  }
}

// ── What a lane may claim ───────────────────────────────────────────────────

/** How long a host counts as online after its last heartbeat (3 missed beats). */
export const HOST_ONLINE_MS = 3 * 60_000
export function hostOnline(lastHeartbeatAt: string | null | undefined, now: Date): boolean {
  if (!lastHeartbeatAt) return false
  const at = Date.parse(lastHeartbeatAt)
  return Number.isFinite(at) && now.getTime() - at <= HOST_ONLINE_MS
}

/** Why a lane takes nothing new right now, or null when it may claim. */
export function laneClaimBlock(cfg: LaneConfig, activeClaims: number, now: Date): string | null {
  if (cfg.paused) return 'The lane is paused.'
  if (cfg.drain) return 'The lane is draining: it finishes what runs and takes nothing new.'
  if (cfg.stop_at && Date.parse(cfg.stop_at) <= now.getTime()) return `The lane stopped at ${cfg.stop_at} (its stop date).`
  if (cfg.mode === 'followups') return 'The lane only works review follow-ups.'
  // conflicts, audit and skill claim through the same route; what they may take is decided there.
  if (activeClaims >= cfg.concurrency) return `The lane already runs ${activeClaims} of ${cfg.concurrency}.`
  return null
}

const SEVERITY_WEIGHT: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }

export interface WorkCandidate {
  id: string
  severity: string | null
  created_at: string
}

/** Worst first, then newest: the order `pickReports` (and spend-down, ADR 0023) uses. */
export function rankWorkCandidates<T extends WorkCandidate>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      (SEVERITY_WEIGHT[(b.severity ?? '').toLowerCase()] ?? 0) - (SEVERITY_WEIGHT[(a.severity ?? '').toLowerCase()] ?? 0) ||
      b.created_at.localeCompare(a.created_at),
  )
}

export interface AttemptLite {
  report_id: string
  status: string | null
  agent: string | null
  pr_url: string | null
  pr_state: string | null
  merged_at: string | null
  error: string | null
  created_at: string | null
}

/** The fix_attempts.agent value of a local run (`mushi work`, as submit_fix_result). */
export const LOCAL_AGENT = 'mcp'
/** Error prefixes of local runs that say nothing about the report: a stop, the reaper, an infra failure. */
export const WORK_STOPPED_PREFIX = 'mushi work stopped'
export const WORK_INFRA_PREFIX = 'mushi work infra:'
const REAPED_PREFIX = 'Reaped:'
const LOCAL_RETRY_COOLDOWN_MS = 7 * 86_400_000

/** A run or an open PR is live for the report (the CLI's hasLiveAttempt). */
export function hasLiveAttempt(attempts: readonly AttemptLite[]): boolean {
  return attempts.some(
    (a) =>
      !a.merged_at &&
      (a.status === 'queued' || a.status === 'running' || a.status === 'pending' || a.pr_state === 'open' || a.pr_state === 'draft' || (!!a.pr_url && !a.pr_state)),
  )
}

/**
 * A local run in the last 7 days ended without a PR: the same agent would
 * most likely end the same way. A stop, a reaped run or an infra failure
 * (the machine, not the report) starts no cooldown. The CLI's inLocalCooldown.
 */
export function inLocalCooldown(attempts: readonly AttemptLite[], now: Date): boolean {
  return attempts.some((a) => {
    if (a.agent !== LOCAL_AGENT || a.status !== 'failed' || a.pr_url || !a.created_at) return false
    if (a.error?.startsWith(WORK_STOPPED_PREFIX) || a.error?.startsWith(REAPED_PREFIX) || a.error?.startsWith(WORK_INFRA_PREFIX)) return false
    const at = Date.parse(a.created_at)
    return Number.isFinite(at) && now.getTime() - at < LOCAL_RETRY_COOLDOWN_MS
  })
}

/**
 * Try candidates in order until one insert wins. `tryClaim` inserts the claim
 * and answers 'won', 'taken' (23505: another claimer holds the report) or
 * throws on any other error. Two claimers racing over one list each end with
 * a different report, or none.
 */
export async function claimFirstFree<T extends { id: string }>(
  candidates: readonly T[],
  tryClaim: (candidate: T) => Promise<{ won: true; claimId: string } | { won: false }>,
): Promise<{ candidate: T; claimId: string } | null> {
  for (const candidate of candidates) {
    const r = await tryClaim(candidate)
    if (r.won) return { candidate, claimId: r.claimId }
  }
  return null
}

// ── How a claim ends ────────────────────────────────────────────────────────

/**
 * How a run ended. `pushed` and `refused` are conflict runs (ADR 0049: a merge
 * commit pushed, or the worker's own checks refused the agent's result);
 * `filed` is an audit run that filed at least one reproduced finding (ADR 0050).
 */
export const CLAIM_OUTCOMES = ['pr_opened', 'no_change', 'verdict', 'timeout', 'skipped', 'stopped', 'failed', 'pushed', 'refused', 'filed'] as const
export type ClaimOutcome = (typeof CLAIM_OUTCOMES)[number]
export const FAILURE_KINDS = ['infra', 'code'] as const
export type FailureKind = (typeof FAILURE_KINDS)[number]

/** One automatic requeue per report in this window (ADR 0048); after that a person decides (/pipeline requeue). */
export const AUTO_REQUEUE_WINDOW_MS = 7 * 86_400_000

export interface ClaimDone {
  outcome: ClaimOutcome
  failureKind: FailureKind | null
  fixId: string | null
  prUrl: string | null
  detail: string | null
  /** A conflict run's pushed merge commit. */
  headAfter: string | null
}

export function parseClaimDone(raw: unknown): Parsed<ClaimDone> {
  if (!raw || typeof raw !== 'object') return { ok: false, message: 'Send a JSON body.' }
  const b = raw as Record<string, unknown>
  if (typeof b.outcome !== 'string' || !(CLAIM_OUTCOMES as readonly string[]).includes(b.outcome)) {
    return { ok: false, message: `outcome must be one of ${CLAIM_OUTCOMES.join(', ')}.` }
  }
  const failureKind = b.failureKind == null ? null : String(b.failureKind)
  if (failureKind !== null && !(FAILURE_KINDS as readonly string[]).includes(failureKind)) return { ok: false, message: 'failureKind must be infra, code or null.' }
  if (failureKind && b.outcome !== 'failed' && b.outcome !== 'timeout') return { ok: false, message: 'failureKind goes with a failed or timed-out run only.' }
  const fixId = typeof b.fixId === 'string' && UUID_RE.test(b.fixId) ? b.fixId : null
  const prUrl = typeof b.prUrl === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(b.prUrl) ? b.prUrl : null
  if (b.outcome === 'pr_opened' && !prUrl) return { ok: false, message: 'A pr_opened outcome needs prUrl (https://github.com/<owner>/<repo>/pull/<n>).' }
  const headAfter = typeof b.headAfter === 'string' && /^[0-9a-f]{40}$/.test(b.headAfter) ? b.headAfter : null
  if (b.outcome === 'pushed' && !headAfter) return { ok: false, message: 'A pushed outcome needs headAfter, the 40-hex sha of the merge commit.' }
  const detail = typeof b.detail === 'string' ? b.detail.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 1000) : null
  return { ok: true, value: { outcome: b.outcome as ClaimOutcome, failureKind: failureKind as FailureKind | null, fixId, prUrl, detail, headAfter } }
}

/** True when this infra failure may put the report back in the queue on its own (no automatic requeue in the window). */
export function mayAutoRequeue(done: Pick<ClaimDone, 'failureKind'>, earlierAuto: ReadonlyArray<{ claimed_at: string }>, now: Date): boolean {
  if (done.failureKind !== 'infra') return false
  return !earlierAuto.some((c) => now.getTime() - Date.parse(c.claimed_at) < AUTO_REQUEUE_WINDOW_MS)
}
