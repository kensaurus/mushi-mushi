/**
 * FILE: packages/cli/src/worker/protocol.ts
 * PURPOSE: What a local worker (`mushi work --daemon`, ADR 0048) accepts from
 *          the server, and its own config file.
 *
 *          Control is pull-only and closed: a heartbeat answer carries, per
 *          lane, exactly paused, concurrency, model, mode, stop_at, drain and
 *          prune_own, and per host the guard numbers. This parser refuses
 *          anything else, so a compromised or confused server can never make
 *          the daemon run a command or touch a path it did not choose itself.
 *          It mirrors the server's `_shared/work-lanes.ts`.
 *
 *          The lanes and the clone each one works in live in a local file
 *          (~/.config/mushi/worker.json): the server never stores or sends a path.
 *
 *          A claim answer is parsed the same way (parseClaim): a fix claim
 *          carries a report, a conflict claim (ADR 0049) a PR of the lane's own
 *          repository with the head commit Mushi saw, an audit claim (ADR
 *          0050) only models and a count, a first-time user test (ADR 0053
 *          amendment) a start page, a goal in plain words and, for Mushi's
 *          own operator, test accounts. Anything else is refused.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { MushiCliError } from '../errors.js'

/** fix and followups (ADR 0048); conflicts (ADR 0049), audit (ADR 0050) and skill (ADR 0042 amendment). */
const LANE_MODES = ['fix', 'followups', 'conflicts', 'audit', 'skill'] as const
type LaneMode = (typeof LANE_MODES)[number]
const LANE_VERBS = ['paused', 'concurrency', 'model', 'mode', 'stop_at', 'drain', 'prune_own'] as const

export interface LaneConfig {
  paused: boolean
  concurrency: number
  model: string | null
  mode: LaneMode
  stop_at: string | null
  drain: boolean
  prune_own: boolean
}

export interface HostGuards {
  max_agents: number
  min_free_mem_gb: number
  gh_floor: number
}

export const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
/** owner/name of a GitHub repository. */
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/
/** A branch name git and GitHub both accept, and never an option or a path escape. */
const BRANCH_RE = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[A-Za-z0-9._\/-]{1,200}(?<![./])$/
const SHA_RE = /^[0-9a-f]{40}$/
export const LANE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }

/** @internal Exported for tests. Exactly the seven lane verbs, typed; anything else is refused. */
export function parseLaneVerbs(raw: unknown, opts: { partial?: boolean } = {}): Parsed<Partial<LaneConfig>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'lane settings are not an object' }
  const out: Partial<LaneConfig> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    switch (key) {
      case 'paused':
      case 'drain':
      case 'prune_own':
        if (typeof value !== 'boolean') return { ok: false, message: `${key} is not true or false` }
        out[key] = value
        break
      case 'concurrency':
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 4) return { ok: false, message: 'concurrency is not 1 to 4' }
        out.concurrency = value
        break
      case 'model':
        if (value !== null && (typeof value !== 'string' || !MODEL_RE.test(value))) return { ok: false, message: 'model is not a model id' }
        out.model = value as string | null
        break
      case 'mode':
        if (typeof value !== 'string' || !(LANE_MODES as readonly string[]).includes(value)) return { ok: false, message: `mode is not one of ${LANE_MODES.join(', ')}` }
        out.mode = value as LaneMode
        break
      case 'stop_at':
        if (value !== null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) return { ok: false, message: 'stop_at is not a date' }
        out.stop_at = value as string | null
        break
      default:
        return { ok: false, message: `unknown lane setting "${key.slice(0, 40)}"` }
    }
  }
  if (!opts.partial && LANE_VERBS.some((v) => !(v in out))) return { ok: false, message: `lane settings miss ${LANE_VERBS.filter((v) => !(v in out)).join(', ')}` }
  return { ok: true, value: out }
}

const GUARD_RANGE: Record<keyof HostGuards, [number, number]> = { max_agents: [1, 16], min_free_mem_gb: [0, 256], gh_floor: [0, 5000] }

/** @internal Exported for tests. The three host guards, nothing else. */
export function parseHostGuards(raw: unknown): Parsed<HostGuards> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'host guards are not an object' }
  const out: Partial<HostGuards> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const range = GUARD_RANGE[key as keyof HostGuards]
    if (!range) return { ok: false, message: `unknown host setting "${key.slice(0, 40)}"` }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < range[0] || value > range[1]) return { ok: false, message: `${key} is out of range` }
    out[key as keyof HostGuards] = value
  }
  if (Object.keys(GUARD_RANGE).some((k) => !(k in out))) return { ok: false, message: 'host guards are incomplete' }
  return { ok: true, value: out as HostGuards }
}

interface ServerLane {
  id: string
  name: string
  projectId: string
  config: LaneConfig
}

export interface HeartbeatAnswer {
  hostId: string
  guards: HostGuards
  lanes: ServerLane[]
  refused: Array<{ name: string; reason: string }>
  renewed: string[]
  lost: string[]
  /** Lane ids whose app has a first-time user test waiting: ask for work now. */
  wake: string[]
}

/**
 * The heartbeat answer, checked field by
 * field. A lane whose settings fail the closed parser is dropped (it stays
 * idle) and named in `bad`; unknown top-level fields are ignored, never used.
 */
export function parseHeartbeatAnswer(raw: unknown): { answer: HeartbeatAnswer; bad: string[] } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'the heartbeat answer is not an object' }
  const d = raw as Record<string, unknown>
  const guards = parseHostGuards(d.guards)
  if (!guards.ok) return { error: guards.message }
  const lanes: ServerLane[] = []
  const bad: string[] = []
  for (const l of Array.isArray(d.lanes) ? (d.lanes as Array<Record<string, unknown>>) : []) {
    const name = typeof l?.name === 'string' && LANE_NAME_RE.test(l.name) ? l.name : null
    const cfg = parseLaneVerbs(l?.config)
    if (!name || typeof l.id !== 'string' || !UUID_RE.test(l.id) || typeof l.projectId !== 'string' || !UUID_RE.test(l.projectId) || !cfg.ok) {
      bad.push(`${name ?? '?'}: ${cfg.ok ? 'bad lane id' : cfg.message}`)
      continue
    }
    lanes.push({ id: l.id, name, projectId: l.projectId, config: cfg.value as LaneConfig })
  }
  const ids = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string' && UUID_RE.test(v)) : [])
  const refused = (Array.isArray(d.refused) ? (d.refused as Array<Record<string, unknown>>) : [])
    .filter((r) => typeof r?.name === 'string')
    .map((r) => ({ name: String(r.name).slice(0, 40), reason: String(r.reason ?? '').slice(0, 300) }))
  return {
    answer: { hostId: typeof d.hostId === 'string' ? d.hostId : '', guards: guards.value, lanes, refused, renewed: ids(d.renewed), lost: ids(d.lost), wake: ids(d.wake) },
    bad,
  }
}

// ── Claims ──────────────────────────────────────────────────────────────────

export interface ConflictTarget {
  queueId: string
  repo: string
  prNumber: number
  headRef: string
  headSha: string
  prUrl: string | null
}

/** A first-time user test the console queued (ADR 0053 amendment 2026-10-28). */
export interface FreshEyesTarget {
  /** The console's run id; the run syncs into that row. */
  runId: string
  url: string
  goal: string
  sessions: number
  /** Plain words that mean the visitor made it, or null. */
  successText: string | null
  dryRun: boolean
  /** One synthetic account per session, for Mushi's own operator only. Never logged (the user id may be). */
  accounts: Array<{ email: string; password: string; name: string; userId?: string }>
}

type ParsedClaim =
  | { kind: 'fix'; id: string; model: string | null; raw: Record<string, unknown> }
  | { kind: 'conflict'; id: string; model: string | null; conflict: ConflictTarget }
  | { kind: 'audit'; id: string; model: string | null; audit: { reviewModel: string | null; findingsLeft: number } }
  | { kind: 'fresh_eyes'; id: string; model: string | null; freshEyes: FreshEyesTarget }

const RUN_ID_RE = /^[0-9]{8}-[0-9]{6}-[a-z0-9]{4}$/
const CONTROL_RE = /[\u0000-\u001f\u007f]/

/** Plain text from the server: no control characters, never read as an option. */
function plainText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > max || CONTROL_RE.test(raw) || raw.trim().startsWith('-')) return null
  return raw.trim()
}

function parseFreshEyesTarget(raw: unknown): Parsed<FreshEyesTarget> {
  const t = (raw ?? {}) as Record<string, unknown>
  if (typeof t.runId !== 'string' || !RUN_ID_RE.test(t.runId)) return { ok: false, message: 'the test claim has no run id' }
  let url: URL
  try {
    url = new URL(String(t.url))
  } catch {
    return { ok: false, message: 'the test claim\'s start page is not a web address' }
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || String(t.url).length > 500) return { ok: false, message: 'the test claim\'s start page is not an http(s) address' }
  const goal = plainText(t.goal, 300)
  if (!goal) return { ok: false, message: 'the test claim\'s goal is not plain text' }
  if (typeof t.sessions !== 'number' || !Number.isInteger(t.sessions) || t.sessions < 1 || t.sessions > 5) return { ok: false, message: 'the test claim\'s visitors are not 1 to 5' }
  const successText = t.successText == null ? null : plainText(t.successText, 120)
  if (t.successText != null && !successText) return { ok: false, message: 'the test claim\'s success words are not plain text' }
  if (typeof t.dryRun !== 'boolean') return { ok: false, message: 'the test claim\'s dryRun is not true or false' }
  const accounts: FreshEyesTarget['accounts'] = []
  for (const a of Array.isArray(t.accounts) ? (t.accounts as Array<Record<string, unknown>>) : []) {
    if (typeof a?.email !== 'string' || !/^[^\s@]{1,100}@[^\s@]{1,200}$/.test(a.email) || typeof a.password !== 'string' || a.password.length < 12 || a.password.length > 200 || CONTROL_RE.test(a.password)) {
      return { ok: false, message: 'a test account in the claim is malformed' }
    }
    const userId = typeof a.userId === 'string' && UUID_RE.test(a.userId) ? a.userId : undefined
    accounts.push({ email: a.email, password: a.password, name: plainText(a.name, 80) ?? 'Test visitor', ...(userId ? { userId } : {}) })
  }
  if (accounts.length > t.sessions || (t.dryRun && accounts.length)) return { ok: false, message: 'the test claim carries more accounts than it may use' }
  return { ok: true, value: { runId: t.runId, url: url.toString(), goal, sessions: t.sessions, successText, dryRun: t.dryRun, accounts } }
}

/**
 * @internal Exported for tests. A claim answer, checked by kind. A fix claim's
 * report goes on to `workOne` as it always did (a claim without `kind` is a fix
 * claim from a server that predates P3). A conflict claim names a PR of the
 * lane's repository and the head Mushi saw; its branch is checked so it can
 * never be read as a git option or reach outside refs/heads.
 */
export function parseClaim(raw: unknown): Parsed<ParsedClaim> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'the claim is not an object' }
  const c = raw as Record<string, unknown>
  if (typeof c.id !== 'string' || !UUID_RE.test(c.id)) return { ok: false, message: 'the claim has no id' }
  const model = c.model == null ? null : typeof c.model === 'string' && MODEL_RE.test(c.model) ? c.model : undefined
  if (model === undefined) return { ok: false, message: 'the claim\'s model is not a model id' }
  const kind = c.kind ?? 'fix'
  if (kind === 'fix') {
    const report = c.report as Record<string, unknown> | undefined
    if (!report || typeof report.id !== 'string' || !UUID_RE.test(report.id)) return { ok: false, message: 'the fix claim has no report' }
    return { ok: true, value: { kind: 'fix', id: c.id, model, raw: c } }
  }
  if (kind === 'conflict') {
    const t = (c.conflict ?? {}) as Record<string, unknown>
    if (typeof t.queueId !== 'string' || !UUID_RE.test(t.queueId)) return { ok: false, message: 'the conflict claim has no queue row' }
    if (typeof t.repo !== 'string' || !REPO_RE.test(t.repo)) return { ok: false, message: 'the conflict claim\'s repo is not owner/name' }
    if (typeof t.prNumber !== 'number' || !Number.isInteger(t.prNumber) || t.prNumber < 1) return { ok: false, message: 'the conflict claim\'s PR number is not a number' }
    if (typeof t.headRef !== 'string' || !BRANCH_RE.test(t.headRef)) return { ok: false, message: 'the conflict claim\'s branch is not a plain branch name' }
    if (typeof t.headSha !== 'string' || !SHA_RE.test(t.headSha)) return { ok: false, message: 'the conflict claim\'s head is not a commit sha' }
    const prUrl = typeof t.prUrl === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(t.prUrl) ? t.prUrl : null
    return { ok: true, value: { kind: 'conflict', id: c.id, model, conflict: { queueId: t.queueId, repo: t.repo, prNumber: t.prNumber, headRef: t.headRef, headSha: t.headSha, prUrl } } }
  }
  if (kind === 'audit') {
    const a = (c.audit ?? {}) as Record<string, unknown>
    const reviewModel = a.reviewModel == null ? null : typeof a.reviewModel === 'string' && MODEL_RE.test(a.reviewModel) ? a.reviewModel : undefined
    if (reviewModel === undefined) return { ok: false, message: 'the audit claim\'s review model is not a model id' }
    const left = typeof a.findingsLeft === 'number' && Number.isInteger(a.findingsLeft) && a.findingsLeft >= 0 ? a.findingsLeft : 0
    return { ok: true, value: { kind: 'audit', id: c.id, model, audit: { reviewModel, findingsLeft: left } } }
  }
  if (kind === 'fresh_eyes') {
    const t = parseFreshEyesTarget(c.freshEyes)
    if (!t.ok) return t
    return { ok: true, value: { kind: 'fresh_eyes', id: c.id, model, freshEyes: t.value } }
  }
  return { ok: false, message: `unknown claim kind "${String(kind).slice(0, 20)}"` }
}

// ── The local config ────────────────────────────────────────────────────────

export interface LocalLane {
  name: string
  projectId: string
  /** The clone this lane works in (only worktrees are created in it). Never sent to the server. */
  repoDir: string
  /** Settings proposed when the lane first registers (the server keeps what the console sets after). */
  initial?: Partial<LaneConfig>
}

export interface WorkerConfig {
  version: 1
  /** API endpoint; defaults to the CLI's. */
  endpoint?: string
  /**
   * The Cursor account the agents must run as (as `cursor-agent status`
   * prints it). When set, a CLI signed in as anyone else counts as signed
   * out, so another account's credits are never spent. Local only.
   */
  cursorAccount?: string
  lanes: LocalLane[]
}

export const WORKER_CONFIG_PATH = join(process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config'), 'mushi', 'worker.json')
export const WORKER_KEY_PATH = join(process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config'), 'mushi', 'worker.key')

/** Check a worker config; two lanes on one clone are refused (their git work would collide). */
export function validateWorkerConfig(raw: unknown): WorkerConfig {
  const fail = (m: string): never => {
    throw new MushiCliError('E_INVALID_INPUT', `Worker config: ${m}`, 'mushi worker install --help')
  }
  if (!raw || typeof raw !== 'object') fail('not a JSON object')
  const c = raw as Record<string, unknown>
  if (c.version !== 1) fail('version must be 1')
  if (c.endpoint !== undefined && (typeof c.endpoint !== 'string' || !/^https?:\/\//.test(c.endpoint))) fail('endpoint must be an http(s) URL')
  if (c.cursorAccount !== undefined && (typeof c.cursorAccount !== 'string' || !/^[^\s@]{1,100}@[^\s@]{1,100}$/.test(c.cursorAccount))) fail('cursorAccount must be the account\'s email address')
  if (!Array.isArray(c.lanes) || c.lanes.length === 0) fail('list at least one lane')
  if ((c.lanes as unknown[]).length > 20) fail('at most 20 lanes')
  const names = new Set<string>()
  const clones = new Map<string, string>()
  const lanes: LocalLane[] = []
  for (const l of c.lanes as Array<Record<string, unknown>>) {
    const name = String(l?.name ?? '')
    if (!LANE_NAME_RE.test(name)) fail(`lane name "${name.slice(0, 40)}" must be 1-40 lowercase letters, digits, ".", "_" or "-"`)
    if (names.has(name)) fail(`lane "${name}" is listed twice`)
    names.add(name)
    if (typeof l.projectId !== 'string' || !UUID_RE.test(l.projectId)) fail(`lane "${name}" needs projectId (the app id)`)
    if (typeof l.repoDir !== 'string' || !isAbsolute(l.repoDir)) fail(`lane "${name}" needs repoDir, an absolute path to a clone`)
    const repoDir = resolve(l.repoDir as string)
    const other = clones.get(repoDir)
    if (other) fail(`lanes "${other}" and "${name}" use the same clone ${repoDir}; give each lane its own clone`)
    clones.set(repoDir, name)
    let initial: Partial<LaneConfig> | undefined
    if (l.initial !== undefined) {
      const p = parseLaneVerbs(l.initial, { partial: true })
      if (!p.ok) fail(`lane "${name}" initial: ${p.message}`)
      initial = (p as { value: Partial<LaneConfig> }).value
    }
    lanes.push({ name, projectId: (l.projectId as string).toLowerCase(), repoDir, ...(initial ? { initial } : {}) })
  }
  return {
    version: 1,
    ...(typeof c.endpoint === 'string' ? { endpoint: c.endpoint } : {}),
    ...(typeof c.cursorAccount === 'string' ? { cursorAccount: c.cursorAccount } : {}),
    lanes,
  }
}

export function loadWorkerConfig(path = WORKER_CONFIG_PATH): WorkerConfig {
  if (!existsSync(path)) throw new MushiCliError('E_FILE_NOT_FOUND', `No worker config at ${path}.`, 'mushi worker install')
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new MushiCliError('E_INVALID_INPUT', `${path} is not valid JSON.`)
  }
  return validateWorkerConfig(raw)
}
