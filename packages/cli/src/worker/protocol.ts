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
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { MushiCliError } from '../errors.js'

const LANE_MODES = ['fix', 'followups'] as const
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
    answer: { hostId: typeof d.hostId === 'string' ? d.hostId : '', guards: guards.value, lanes, refused, renewed: ids(d.renewed), lost: ids(d.lost) },
    bad,
  }
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
