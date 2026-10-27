/**
 * FILE: packages/cli/src/worker/daemon.ts
 * PURPOSE: `mushi work --daemon`, the local worker (ADR 0048). It replaces the
 *          hand-made lane services of 2026-10-26 (lane-v4.sh, lanectl, a text
 *          file per queue) with one process per machine that the console can
 *          see and steer:
 *
 *            1. every 60 s a heartbeat registers the machine and its lanes,
 *               renews the leases it holds, and reads back each lane's
 *               settings (a closed set, worker/protocol.ts) and the host guards;
 *            2. the guards run here (worker/guards.ts): free memory, the
 *               GitHub API quota, the Cursor sign-in, one agent cap for the
 *               whole host, each lane's stop date;
 *            3. a lane runs review follow-ups first, then claims a report
 *               (its queue first, then the ranked ones) and runs `mushi work`'s
 *               own workOne on it in its clone;
 *            4. every outcome goes back (POST /v1/worker/claims/:id/done), with
 *               an infra/code split so a broken machine never counts against
 *               a report.
 *
 *          Pull-only: no port is opened, and nothing from the server becomes a
 *          command or a path. The agent gets neither the worker key nor any
 *          other credential (agentEnv in commands/work.ts is unchanged). A key
 *          revoked in the console stops the daemon at its next heartbeat.
 */

import { existsSync, readFileSync } from 'node:fs'
import { freemem } from 'node:os'
import { apiCall, type ApiResult } from '../cli-shared.js'
import { loadConfig, type CliConfig } from '../config.js'
import { MushiCliError } from '../errors.js'
import { tryLoadWorkerKey } from '../keychain.js'
import { detectPlatform, hashHostId, nodeHostIO, readMachineId, type HostIO } from '../runner/host.js'
import { onInterrupt } from '../signals.js'
import { MUSHI_CLI_VERSION } from '../version.js'
import {
  checkCursorSignIn,
  classifyFailure,
  followUpOne,
  runProc,
  workOne,
  type Api,
  type CursorSignIn,
  type LocalFollowupCandidate,
  type ReportDetail,
  type WorkOutcome,
} from '../commands/work.js'
import { CURSOR_CONFIRM_GRACE_MS, hostGate, memAvailableGb, pastStop, type MachineReadings } from './guards.js'
import {
  loadWorkerConfig,
  parseHeartbeatAnswer,
  WORKER_KEY_PATH,
  type HostGuards,
  type LaneConfig,
  type LocalLane,
  type WorkerConfig,
} from './protocol.js'

/** Heartbeat period; the server's lease (45 min) outlives many missed beats. */
export const HEARTBEAT_MS = 60_000
/** A lane with nothing to take asks again after this long (lane-v4 slept 900 s). */
export const IDLE_MS = 15 * 60_000
/** After a transient error (network, a 5xx). */
export const BACKOFF_MS = 2 * 60_000
const GH_CHECK_MS = 5 * 60_000
const CURSOR_CHECK_MS = 20 * 60_000

type Call = <T>(path: string, init?: RequestInit) => Promise<ApiResult<T>>

export interface DaemonDeps {
  call: Call
  workOne: typeof workOne
  followUpOne: typeof followUpOne
  readings: () => Promise<Omit<MachineReadings, 'agents'>>
  now: () => number
  log: (line: string) => void
  host: { hostId: string; hostname: string; platform: 'linux' | 'wsl2' | 'macos' | 'windows'; version: string }
  /** Called after a run ends, so the loop ticks again soon. */
  wake?: () => void
}

interface ClaimFromServer {
  id: string
  laneId: string
  model: string | null
  report: ReportDetail
  earlier: Array<{ createdAt: string | null; prUrl: string | null; verdict: string | null; summary: string | null; findings: Array<{ severity?: string; file?: string; issue?: string }>; note: string | null }>
}

interface LaneRuntime {
  local: LocalLane
  serverId: string | null
  config: LaneConfig | null
  running: Map<string, AbortController>
  followup: boolean
  nextClaimAt: number
  nextFollowupAt: number
  state: string
  counters: { runs: number; prs: number; pushes: number; timeouts: number; errors: number; idle: number; agentMs: number }
  last: string
}

/** The local worker's state machine; `tick()` is one heartbeat and one pass over the lanes. */
export function createDaemon(cfg: WorkerConfig, deps: DaemonDeps) {
  const lanes: LaneRuntime[] = cfg.lanes.map((local) => ({
    local,
    serverId: null,
    config: null,
    running: new Map(),
    followup: false,
    nextClaimAt: 0,
    nextFollowupAt: 0,
    state: 'starting',
    counters: { runs: 0, prs: 0, pushes: 0, timeouts: 0, errors: 0, idle: 0, agentMs: 0 },
    last: '',
  }))
  let guards: HostGuards | null = null
  let hostState = 'starting'
  let lastReadings: Omit<MachineReadings, 'agents'> | null = null
  let stopped: string | null = null
  const reported = new Set<string>()
  const pending = new Set<Promise<void>>()

  const agents = () => lanes.reduce((n, l) => n + l.running.size + (l.followup ? 1 : 0), 0)
  const say = (lane: LaneRuntime | null, line: string) => deps.log(`${new Date(deps.now()).toISOString().slice(11, 16)} ${lane ? lane.local.name : 'worker'}: ${line}`)
  const once = (key: string, lane: LaneRuntime | null, line: string) => {
    if (reported.has(key)) return
    reported.add(key)
    say(lane, line)
  }
  const api: Api = async <T>(path: string, init?: RequestInit) => {
    const r = await deps.call<T>(path, init)
    if (!r.ok) throw new MushiCliError('E_API_ERROR', `${path}: ${r.error.code} ${r.error.message}`)
    return r.data
  }
  const refusedByKey = (r: ApiResult<unknown>) => !r.ok && (r.httpStatus === 401 || (r.httpStatus === 403 && /REVOKED|INVALID_API_KEY|WORKER_KEY_REQUIRED|INSUFFICIENT_SCOPE/.test(r.error.code)))

  function stopAll(why: string): void {
    stopped = why
    for (const l of lanes) for (const ac of l.running.values()) ac.abort()
    say(null, `stopping: ${why}`)
  }

  function heartbeatBody() {
    return {
      host: deps.host,
      status: {
        state: hostState,
        agents: agents(),
        ...(guards ? { maxAgents: guards.max_agents } : {}),
        ...(lastReadings?.memAvailableGb != null ? { memAvailableGb: lastReadings.memAvailableGb } : {}),
        ...(lastReadings?.ghRemaining != null ? { ghRemaining: lastReadings.ghRemaining } : {}),
        ...(lastReadings ? { cursor: lastReadings.cursor } : {}),
      },
      lanes: lanes.map((l) => {
        const { agentMs, ...counts } = l.counters
        return {
          name: l.local.name,
          projectId: l.local.projectId,
          status: { state: l.state, ...counts, agentMin: Math.round(agentMs / 60_000), last: l.last },
          ...(l.local.initial ? { initial: l.local.initial } : {}),
        }
      }),
      claims: lanes.flatMap((l) => [...l.running.keys()]),
    }
  }

  function startRun(lane: LaneRuntime, claim: ClaimFromServer): void {
    const ac = new AbortController()
    lane.running.set(claim.id, ac)
    lane.state = 'working'
    const t0 = deps.now()
    say(lane, `claimed ${claim.report.id.slice(0, 8)}: ${(claim.report.summary ?? '').slice(0, 80)}`)
    const run = (async () => {
      let out: WorkOutcome
      try {
        out = await deps.workOne(api, claim.report, {
          repoDir: lane.local.repoDir,
          agent: 'cursor',
          model: claim.model ?? lane.config?.model ?? undefined,
          log: (l) => say(lane, l.trim()),
          earlier: claim.earlier,
          signal: ac.signal,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        out = { reportId: claim.report.id, result: 'failed', failureKind: classifyFailure(message, 'prepare'), outcome: `failed: ${message}` }
      }
      lane.counters.runs++
      lane.counters.agentMs += deps.now() - t0
      if (out.result === 'pr_opened') lane.counters.prs++
      if (out.result === 'timeout') lane.counters.timeouts++
      if (out.result === 'failed') lane.counters.errors++
      lane.last = `${claim.report.id.slice(0, 8)} → ${out.outcome}`.slice(0, 160)
      say(lane, `  → ${out.outcome}${out.prUrl ? ` ${out.prUrl}` : ''}`)
      const done = await deps.call<{ requeued: boolean }>(`/v1/worker/claims/${claim.id}/done`, {
        method: 'POST',
        body: JSON.stringify({
          outcome: out.result,
          failureKind: out.result === 'failed' ? (out.failureKind ?? 'code') : null,
          fixId: out.fixId ?? null,
          prUrl: out.prUrl ?? null,
          detail: out.outcome.slice(0, 1000),
        }),
      })
      if (!done.ok) say(lane, `  outcome not recorded: ${done.error.code} ${done.error.message}`)
      else if (done.data.requeued) say(lane, '  the machine failed, not the code: back at the front of the queue (once)')
    })()
      .catch((err: unknown) => say(lane, `  run error: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        lane.running.delete(claim.id)
        pending.delete(run)
        deps.wake?.()
      })
    pending.add(run)
  }

  function startFollowup(lane: LaneRuntime, f: LocalFollowupCandidate): void {
    lane.followup = true
    const t0 = deps.now()
    say(lane, `follow-up ${f.prUrl ?? f.fixId}`)
    const run = deps
      .followUpOne(api, f, { repoDir: lane.local.repoDir, agent: 'cursor', model: lane.config?.model ?? undefined, log: (l) => say(lane, l.trim()) })
      .then((r) => {
        lane.counters.runs++
        if (/^pushed /.test(r.outcome)) lane.counters.pushes++
        if (/^failed/.test(r.outcome)) lane.counters.errors++
        lane.last = `follow-up → ${r.outcome}`.slice(0, 160)
        say(lane, `  → ${r.outcome}`)
      })
      .catch((err: unknown) => {
        lane.counters.errors++
        say(lane, `  follow-up error: ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => {
        lane.counters.agentMs += deps.now() - t0
        lane.followup = false
        pending.delete(run)
        deps.wake?.()
      })
    pending.add(run)
  }

  async function laneStep(lane: LaneRuntime, now: number, g: HostGuards): Promise<void> {
    const c = lane.config
    if (!lane.serverId || !c) {
      lane.state = 'stopped'
      return
    }
    if (pastStop(c.stop_at, now)) {
      lane.state = 'stopped'
      once(`stop:${lane.local.name}:${c.stop_at}`, lane, `past its stop date ${c.stop_at}; takes nothing new`)
      return
    }
    if (c.paused) {
      lane.state = lane.running.size ? 'working' : 'paused'
      return
    }
    if (c.drain) {
      lane.state = lane.running.size || lane.followup ? 'draining' : 'paused'
      return
    }
    // Follow-ups first, as lane-v4 did: they finish PRs already open.
    if (now >= lane.nextFollowupAt && !lane.followup && agents() < g.max_agents) {
      const listed = await deps.call<{ fixes: LocalFollowupCandidate[] }>(`/v1/admin/projects/${lane.local.projectId}/local-followups`)
      if (listed.ok && listed.data.fixes.length > 0) startFollowup(lane, listed.data.fixes[0]!)
      else {
        lane.nextFollowupAt = now + (listed.ok ? IDLE_MS : BACKOFF_MS)
        if (!listed.ok) say(lane, `follow-ups not read: ${listed.error.code} ${listed.error.message}`)
      }
    }
    if (c.mode !== 'fix') {
      lane.state = lane.followup ? 'working' : 'idle'
      return
    }
    while (!stopped && lane.running.size < c.concurrency && agents() < g.max_agents && now >= lane.nextClaimAt) {
      const r = await deps.call<{ claim: ClaimFromServer | null; reason?: string }>('/v1/worker/claim', { method: 'POST', body: JSON.stringify({ laneId: lane.serverId }) })
      if (refusedByKey(r)) {
        stopAll(`the server refused this worker's key (${(r as { error: { code: string } }).error.code}); it was revoked or lost access`)
        return
      }
      if (!r.ok) {
        lane.counters.errors++
        lane.nextClaimAt = now + BACKOFF_MS
        lane.state = 'backoff'
        say(lane, `claim failed: ${r.error.code} ${r.error.message}`)
        return
      }
      if (!r.data.claim) {
        lane.counters.idle++
        lane.nextClaimAt = now + IDLE_MS
        if (!lane.running.size && !lane.followup) lane.state = 'idle'
        return
      }
      lane.counters.idle = 0
      startRun(lane, r.data.claim)
    }
    if (lane.running.size || lane.followup) lane.state = 'working'
    else if (agents() >= g.max_agents) lane.state = 'slot-wait'
  }

  async function tick(): Promise<void> {
    if (stopped) return
    const hb = await deps.call<unknown>('/v1/worker/heartbeat', { method: 'POST', body: JSON.stringify(heartbeatBody()) })
    if (refusedByKey(hb)) {
      stopAll(`the server refused this worker's key (${(hb as { error: { code: string } }).error.code}); it was revoked or lost access`)
      return
    }
    if (!hb.ok) {
      hostState = 'backoff'
      say(null, `heartbeat failed: ${hb.error.code} ${hb.error.message}`)
      return
    }
    const parsed = parseHeartbeatAnswer(hb.data)
    if ('error' in parsed) {
      hostState = 'backoff'
      say(null, `heartbeat answer refused: ${parsed.error}`)
      return
    }
    const { answer, bad } = parsed
    for (const b of bad) once(`bad:${b}`, null, `lane settings refused (it stays idle): ${b}`)
    for (const r of answer.refused) once(`refused:${r.name}:${r.reason}`, null, `lane ${r.name} not registered: ${r.reason}`)
    guards = answer.guards
    for (const l of lanes) {
      const server = answer.lanes.find((s) => s.name === l.local.name && s.projectId === l.local.projectId)
      l.serverId = server?.id ?? null
      l.config = server?.config ?? null
    }
    for (const id of answer.lost) {
      for (const l of lanes) {
        const ac = l.running.get(id)
        if (ac) {
          say(l, `lost the lease on claim ${id.slice(0, 8)}; stopping its agent`)
          ac.abort()
        }
      }
    }
    lastReadings = await deps.readings()
    const gate = hostGate(guards, { ...lastReadings, agents: agents() })
    if (!gate.ok) {
      if (hostState !== gate.state) say(null, `waiting: ${gate.why}`)
      hostState = gate.state
      for (const l of lanes) if (!l.running.size && !l.followup) l.state = gate.state
      return
    }
    hostState = 'working'
    const now = deps.now()
    for (const l of lanes) {
      if (stopped) break
      await laneStep(l, now, guards)
    }
    if (lanes.every((l) => l.state === 'idle' || l.state === 'paused' || l.state === 'stopped')) hostState = 'idle'
  }

  /** Stop taking work; the claims still running are told "stopped" (their fix rows close through workOne). */
  async function shutdown(signal: string): Promise<void> {
    stopped = stopped ?? `stopped by ${signal}`
    const open = lanes.flatMap((l) => [...l.running.keys()])
    await Promise.allSettled(
      open.map((id) =>
        deps.call(`/v1/worker/claims/${id}/done`, { method: 'POST', body: JSON.stringify({ outcome: 'stopped', failureKind: null, detail: `The worker stopped (${signal}) before the run finished.` }) }),
      ),
    )
  }

  return {
    tick,
    shutdown,
    stopAll,
    get stopped() {
      return stopped
    },
    get hostState() {
      return hostState
    },
    lanes,
    /** Runs still in flight, for a clean exit and for tests. */
    settle: () => Promise.allSettled([...pending]),
  }
}

// ── The process ─────────────────────────────────────────────────────────────

/** @internal Exported for tests. This machine's id, hashed (the same value ci_runner_hosts uses); Windows reads MachineGuid. */
export function workerHostId(io: HostIO): string | null {
  if (io.platform === 'win32') {
    const out = io.exec('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'])
    const guid = out?.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/)?.[1]
    return guid ? hashHostId(guid) : null
  }
  const raw = readMachineId(io)
  return raw ? hashHostId(raw) : null
}

/**
 * The worker key: MUSHI_WORKER_KEY, the OS keychain, then the 0600 file.
 * Never the CLI's own key: that one can merge pull requests.
 */
export function readWorkerKey(cliKey: string | undefined): string {
  const fromEnv = process.env['MUSHI_WORKER_KEY']?.trim()
  const key = fromEnv || tryLoadWorkerKey() || (existsSync(WORKER_KEY_PATH) ? readFileSync(WORKER_KEY_PATH, 'utf8').trim() : '')
  if (!key) throw new MushiCliError('E_AUTH_MISSING', 'No worker key (MUSHI_WORKER_KEY, the keychain, or ~/.config/mushi/worker.key).', 'mushi worker install')
  return assertWorkerKey(key, cliKey)
}

/** A Mushi key that is not the CLI's own. */
export function assertWorkerKey(key: string, cliKey: string | undefined): string {
  if (!/^mushi_[A-Za-z0-9_-]{8,128}$/.test(key)) throw new MushiCliError('E_INVALID_INPUT', 'The worker key does not look like a Mushi key (mushi_…).', 'mushi worker install')
  if (cliKey && key === cliKey) {
    throw new MushiCliError(
      'E_INVALID_INPUT',
      'The worker key is your CLI key. A worker key (worker:run) can only take reports and record their fixes; the CLI key can merge pull requests, so it never runs the daemon.',
      'mushi worker install (it creates a worker key)',
    )
  }
  return key
}

async function machineReadings(state: { ghAt: number; gh: number | null; cursorAt: number; cursor: CursorSignIn; confirmedAt: number | null }, now: number): Promise<Omit<MachineReadings, 'agents'>> {
  const meminfo = process.platform === 'linux' ? nodeHostIO.readFile('/proc/meminfo') : null
  const mem = memAvailableGb(meminfo) ?? Math.floor(freemem() / 1024 ** 3)
  if (now - state.ghAt >= GH_CHECK_MS) {
    const r = await runProc('gh', ['api', 'rate_limit', '--jq', '.resources.core.remaining'], { timeoutMs: 30_000 })
    // A hung or failed call is unknown, not an empty quota.
    state.gh = r.code === 0 && /^\d+$/.test(r.stdout.trim()) ? Number(r.stdout.trim()) : null
    state.ghAt = now
  }
  if (now - state.cursorAt >= CURSOR_CHECK_MS) {
    const s = await checkCursorSignIn()
    state.cursor = s.state
    if (s.state === 'signed_in') state.confirmedAt = now
    state.cursorAt = now
  }
  // A status call that timed out under load still counts as signed in for 2 h after the last confirmation.
  const cursor = state.cursor === 'unknown' && state.confirmedAt !== null && now - state.confirmedAt < CURSOR_CONFIRM_GRACE_MS ? 'signed_in' : state.cursor
  return { memAvailableGb: mem, ghRemaining: state.gh, cursor }
}

export async function runDaemon(opts: { configPath?: string } = {}): Promise<void> {
  const cfg = loadWorkerConfig(opts.configPath)
  const cli = loadConfig()
  const key = readWorkerKey(cli.apiKey)
  const endpoint = cfg.endpoint ?? process.env['MUSHI_API_ENDPOINT'] ?? cli.endpoint
  if (!endpoint) throw new MushiCliError('E_INVALID_INPUT', 'No API endpoint: set "endpoint" in the worker config or run mushi login.', 'mushi worker install')
  const hostId = workerHostId(nodeHostIO)
  if (!hostId) throw new MushiCliError('E_INVALID_INPUT', 'Could not read a machine id on this host.', 'Linux and WSL2 need /etc/machine-id; Windows reads MachineGuid.')
  const platform = detectPlatform(nodeHostIO)

  // The machine is ready before the first claim: gh can push, every clone is a git repo.
  const gh = await runProc('gh', ['auth', 'status'], { timeoutMs: 30_000 })
  if (gh.code !== 0) throw new MushiCliError('E_AUTH_MISSING', 'gh is not signed in on this machine.', 'Run: gh auth login')
  for (const lane of cfg.lanes) {
    const g = await runProc('git', ['rev-parse', '--git-dir'], { cwd: lane.repoDir, timeoutMs: 30_000 })
    if (g.code !== 0) throw new MushiCliError('E_INVALID_INPUT', `Lane ${lane.name}: ${lane.repoDir} is not a git clone.`, `git clone <repo> ${lane.repoDir}`)
  }

  const conf: CliConfig = { apiKey: key, endpoint }
  let wake: () => void = () => undefined
  const daemon = createDaemon(cfg, {
    call: (path, init) => apiCall(path, conf, init, { timeoutMs: 30_000 }),
    workOne,
    followUpOne,
    readings: (() => {
      const state = { ghAt: 0, gh: null as number | null, cursorAt: 0, cursor: 'unknown' as CursorSignIn, confirmedAt: null as number | null }
      return () => machineReadings(state, Date.now())
    })(),
    now: () => Date.now(),
    log: (l) => process.stdout.write(`${l}\n`),
    host: { hostId, hostname: nodeHostIO.hostname.split('.')[0]!.slice(0, 80) || 'host', platform, version: MUSHI_CLI_VERSION },
    wake: () => wake(),
  })
  onInterrupt((signal) => daemon.shutdown(signal))
  process.stdout.write(`mushi worker: ${cfg.lanes.length} lane(s) on ${platform}; heartbeat every ${HEARTBEAT_MS / 1000} s. Stop with Ctrl-C or systemctl --user stop mushi-worker.\n`)

  while (!daemon.stopped) {
    await daemon.tick().catch((err: unknown) => process.stdout.write(`worker: tick failed: ${err instanceof Error ? err.message : String(err)}\n`))
    if (daemon.stopped) break
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, HEARTBEAT_MS)
      // A finished run ticks again in 5 s instead of waiting for the next beat.
      wake = () => {
        clearTimeout(timer)
        setTimeout(resolve, 5_000)
      }
    })
    wake = () => undefined
  }
  await daemon.settle()
  if (daemon.stopped && !daemon.stopped.startsWith('stopped by')) {
    throw new MushiCliError('E_AUTH_MISSING', `The worker stopped: ${daemon.stopped}.`, 'Set it up again with mushi worker install, or check the Workers tab on /pipeline.')
  }
}
