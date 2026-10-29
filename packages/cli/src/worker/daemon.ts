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
 *            3. a lane runs review follow-ups first, then claims: a first-time
 *               user test the console queued for its app comes first
 *               (worker/fresh-eyes.ts, ADR 0053 amendment), then by its mode:
 *               `fix` a report (its queue first, then the ranked ones) and runs
 *               `mushi work`'s own workOne on it in its clone; `skill` only the
 *               skill-run rounds in its queue (ADR 0042 amendment); `conflicts`
 *               a merge-queue conflict of its clone's repository
 *               (worker/conflicts.ts, ADR 0049); `audit` one screen of a
 *               code-read audit (worker/audit.ts, ADR 0050);
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
import { availableParallelism, freemem, loadavg } from 'node:os'
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
import { auditPass } from './audit.js'
import { repoOfRemote, resolveConflict } from './conflicts.js'
import { runFreshEyesClaim } from './fresh-eyes.js'
import { createCursorLogin, type CursorLogin } from './cursor-login.js'
import {
  cleanLine,
  cursorCheckResult,
  ghCheckResult,
  maskEmail,
  newRun,
  pushLog,
  runStatus,
  setStage,
  slotStatus,
  type CursorCheckResult,
  type GhCheckResult,
  type RunKind,
  type RunTrack,
} from './telemetry.js'
import {
  loadWorkerConfig,
  parseClaim,
  parseHeartbeatAnswer,
  WORKER_KEY_PATH,
  type FreshEyesTarget,
  type HostGuards,
  type LaneConfig,
  type LocalLane,
  type WorkerConfig,
} from './protocol.js'

/** Heartbeat period; the server's lease (45 min) outlives many missed beats. */
const HEARTBEAT_MS = 60_000
/** A lane with nothing to take asks again after this long (lane-v4 slept 900 s). */
const IDLE_MS = 15 * 60_000
/** After a transient error (network, a 5xx). */
const BACKOFF_MS = 2 * 60_000
const GH_CHECK_MS = 5 * 60_000
const CURSOR_CHECK_MS = 20 * 60_000

type Call = <T>(path: string, init?: RequestInit) => Promise<ApiResult<T>>

/** What the machine reads before each pass: the gate's inputs, and what the console shows about them. */
type HostReadings = Omit<MachineReadings, 'agents'> & {
  /** The account and gh checks as they really answered, with when (ms since epoch, this machine's clock). */
  checks?: {
    cursor?: { result: CursorCheckResult; at: number; detail: string }
    gh?: { result: GhCheckResult; at: number; detail: string }
  }
  load1?: number | null
  cpus?: number | null
}

/** @internal Exported for tests only. */
export interface DaemonDeps {
  call: Call
  workOne: typeof workOne
  followUpOne: typeof followUpOne
  readings: () => Promise<HostReadings>
  now: () => number
  log: (line: string) => void
  host: { hostId: string; hostname: string; platform: 'linux' | 'wsl2' | 'macos' | 'windows'; version: string }
  /** Called after a run ends, so the loop ticks again soon. */
  wake?: () => void
  /** P3 modes; default to the real runners. */
  resolveConflict?: typeof resolveConflict
  auditPass?: typeof auditPass
  /** owner/name of each lane's clone (its origin remote), by lane name; sent so conflict claims match the clone. */
  repos?: ReadonlyMap<string, string>
  /** The console asked for a new Cursor account check (heartbeat answer `recheckAccount`). */
  recheck?: () => void
  /** Lanes that could not start, with why (a clone that is not a git clone): registered, shown, never run. */
  notReady?: ReadonlyMap<string, string>
  /** The account the agents must run as; only its masked form leaves the machine. */
  cursorAccount?: string
  /** The console named another account (heartbeat answer `cursorAccount`): the readings expect it from now on. */
  setCursorAccount?: (account: string) => void
  /** "Switch account" from the console. Without it the daemon does not offer to switch (no `can: cursor_login`). */
  cursorLogin?: CursorLogin
  /** Runs a first-time user test the console queued. Without it the daemon does not offer to take them. */
  freshEyes?: (t: FreshEyesTarget, o: { projectId: string; signal: AbortSignal; log: (line: string) => void }) => Promise<JobOutcome>
}

/** What a P3 run reports back (conflicts and audit). */
interface JobOutcome {
  result: string
  failureKind?: 'infra' | 'code'
  detail: string
  headAfter?: string
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
  /** The state the last heartbeat sent, and since when (for "waited 3 h for an agent space"). */
  seenState: string
  stateAt: number
  /** Runs in flight, by claim id (or `followup-<fix>`): stage, ages, model, last log lines. */
  tracks: Map<string, RunTrack>
  counters: { runs: number; prs: number; pushes: number; timeouts: number; errors: number; idle: number; agentMs: number }
  last: string
}

/** @internal Exported for tests only. The local worker's state machine; `tick()` is one heartbeat and one pass over the lanes. */
export function createDaemon(cfg: WorkerConfig, deps: DaemonDeps) {
  const lanes: LaneRuntime[] = cfg.lanes.map((local) => ({
    local,
    serverId: null,
    config: null,
    running: new Map(),
    followup: false,
    nextClaimAt: 0,
    nextFollowupAt: 0,
    state: deps.notReady?.has(local.name) ? 'not-ready' : 'starting',
    seenState: '',
    stateAt: deps.now(),
    tracks: new Map(),
    counters: { runs: 0, prs: 0, pushes: 0, timeouts: 0, errors: 0, idle: 0, agentMs: 0 },
    last: '',
  }))
  let guards: HostGuards | null = null
  let hostState = 'starting'
  let hostSeenState = ''
  let hostStateAt = deps.now()
  let waitWhy: string | null = null
  let lastReadings: HostReadings | null = null
  let stopped: string | null = null
  /** The account the agents must run as: worker.json's, until the console names another. */
  let account = deps.cursorAccount
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

  /** Seconds a lane's state has lasted, as of this heartbeat. */
  function stateSec(lane: LaneRuntime, now: number): number {
    if (lane.state !== lane.seenState) {
      lane.seenState = lane.state
      lane.stateAt = now
    }
    return Math.round((now - lane.stateAt) / 1000)
  }

  /** What the console shows about the machine beyond lane-v4's counters (worker/telemetry.ts). */
  function hostTelemetry(now: number) {
    if (hostState !== hostSeenState) {
      hostSeenState = hostState
      hostStateAt = now
    }
    const c = lastReadings?.checks
    const age = (at: number) => Math.max(0, Math.round((now - at) / 1000))
    const notReady = [...(deps.notReady ?? new Map<string, string>())].map(([lane, problem]) => ({ lane, problem: cleanLine(problem) ?? 'it could not start' }))
    return {
      stateSec: Math.round((now - hostStateAt) / 1000),
      ...(lastReadings?.load1 != null ? { load1: Math.round(lastReadings.load1 * 10) / 10 } : {}),
      ...(lastReadings?.cpus ? { cpus: lastReadings.cpus } : {}),
      ...(waitWhy ? { waitWhy } : {}),
      checks: {
        ...(c?.cursor ? { cursor: { result: c.cursor.result, ageSec: age(c.cursor.at), detail: cleanLine(c.cursor.detail) ?? '', account: account ? maskEmail(account) : null } } : {}),
        ...(c?.gh ? { gh: { result: c.gh.result, ageSec: age(c.gh.at), detail: cleanLine(c.gh.detail) ?? '' } } : {}),
        ...(notReady.length ? { notReady } : {}),
      },
      // Which lane holds each agent space, and in which stage.
      slots: lanes.flatMap((l) => [...l.tracks.values()].map((t) => slotStatus(l.local.name, t, now))),
    }
  }

  function heartbeatBody() {
    const now = deps.now()
    return {
      // `takes`: the claim kinds beyond the lanes' modes this daemon runs (a closed list on the server).
      // `can`: what this daemon does when the console asks (a closed list on the server).
      host: { ...deps.host, takes: deps.freshEyes ? ['fresh_eyes'] : [], can: deps.cursorLogin ? ['cursor_login'] : [] },
      status: {
        state: hostState,
        agents: agents(),
        ...(guards ? { maxAgents: guards.max_agents } : {}),
        ...(lastReadings?.memAvailableGb != null ? { memAvailableGb: lastReadings.memAvailableGb } : {}),
        ...(lastReadings?.ghRemaining != null ? { ghRemaining: lastReadings.ghRemaining } : {}),
        ...(lastReadings ? { cursor: lastReadings.cursor } : {}),
        ...hostTelemetry(now),
        // The switch the console asked for, with its approve link while that is the step: the server keeps it for the owner only.
        ...(deps.cursorLogin?.report() ? { cursorLogin: deps.cursorLogin.report() } : {}),
      },
      lanes: lanes.map((l) => {
        const { agentMs, ...counts } = l.counters
        return {
          name: l.local.name,
          projectId: l.local.projectId,
          status: { state: l.state, ...counts, agentMin: Math.round(agentMs / 60_000), last: cleanLine(l.last) ?? '', stateSec: stateSec(l, now), inflight: [...l.tracks.values()].map((t) => runStatus(t, now)) },
          ...(l.local.initial ? { initial: l.local.initial } : {}),
          ...(deps.repos?.get(l.local.name) ? { repo: deps.repos.get(l.local.name) } : {}),
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
    const model = claim.model ?? lane.config?.model ?? undefined
    const track = newRun(claim.id, 'fix', { reportId: claim.report.id, model, now: t0, stage: 'prepare' })
    lane.tracks.set(claim.id, track)
    say(lane, `claimed ${claim.report.id.slice(0, 8)}: ${(claim.report.summary ?? '').slice(0, 80)}`)
    const run = (async () => {
      let out: WorkOutcome
      try {
        out = await deps.workOne(api, claim.report, {
          repoDir: lane.local.repoDir,
          agent: 'cursor',
          model,
          log: (l) => {
            pushLog(track, l)
            say(lane, l.trim())
          },
          earlier: claim.earlier,
          signal: ac.signal,
          onStage: (stage) => setStage(track, stage, deps.now()),
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
        lane.tracks.delete(claim.id)
        pending.delete(run)
        deps.wake?.()
      })
    pending.add(run)
  }

  /** A conflict or audit run: the same lease, counters and done call as a fix run. */
  function startJob(lane: LaneRuntime, claimId: string, kind: RunKind, label: string, job: (signal: AbortSignal, log: (line: string) => void) => Promise<JobOutcome>): void {
    const ac = new AbortController()
    lane.running.set(claimId, ac)
    lane.state = 'working'
    const t0 = deps.now()
    const track = newRun(claimId, kind, { model: lane.config?.model ?? null, now: t0 })
    lane.tracks.set(claimId, track)
    const log = (l: string) => {
      pushLog(track, l)
      say(lane, l.trim())
    }
    say(lane, label)
    const run = (async () => {
      let out: JobOutcome
      try {
        out = await job(ac.signal, log)
      } catch (err) {
        out = { result: 'failed', failureKind: 'infra', detail: err instanceof Error ? err.message : String(err) }
      }
      lane.counters.runs++
      lane.counters.agentMs += deps.now() - t0
      if (out.result === 'pushed') lane.counters.pushes++
      if (out.result === 'timeout') lane.counters.timeouts++
      if (out.result === 'failed') lane.counters.errors++
      lane.last = `${out.result}: ${out.detail}`.slice(0, 160)
      say(lane, `  → ${out.result}: ${out.detail}`)
      const done = await deps.call<{ requeued: boolean }>(`/v1/worker/claims/${claimId}/done`, {
        method: 'POST',
        body: JSON.stringify({
          outcome: out.result,
          failureKind: out.result === 'failed' || out.result === 'timeout' ? (out.failureKind ?? 'code') : null,
          detail: out.detail.slice(0, 1000),
          ...(out.headAfter ? { headAfter: out.headAfter } : {}),
        }),
      })
      if (!done.ok) say(lane, `  outcome not recorded: ${done.error.code} ${done.error.message}`)
    })()
      .catch((err: unknown) => say(lane, `  run error: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        lane.running.delete(claimId)
        lane.tracks.delete(claimId)
        pending.delete(run)
        deps.wake?.()
      })
    pending.add(run)
  }

  /** Hand a claim back the lane cannot use (a kind it did not ask for, or one this CLI cannot read). */
  async function giveBack(lane: LaneRuntime, claimId: string | null, why: string): Promise<void> {
    once(`giveback:${lane.local.name}:${why}`, lane, `claim refused: ${why}`)
    if (claimId) {
      await deps.call(`/v1/worker/claims/${claimId}/done`, { method: 'POST', body: JSON.stringify({ outcome: 'skipped', failureKind: null, detail: `The worker could not use this claim: ${why}`.slice(0, 1000) }) })
    }
  }

  function startFollowup(lane: LaneRuntime, f: LocalFollowupCandidate): void {
    lane.followup = true
    const t0 = deps.now()
    // A follow-up holds an agent space like a claim does, so the console sees it too.
    const runId = `followup-${f.fixId.replace(/-/g, '').slice(0, 8).toLowerCase()}`
    const track = newRun(runId, 'followup', { model: lane.config?.model ?? null, now: t0, stage: 'prepare' })
    lane.tracks.set(runId, track)
    say(lane, `follow-up ${f.prUrl ?? f.fixId}`)
    const run = deps
      .followUpOne(api, f, {
        repoDir: lane.local.repoDir,
        agent: 'cursor',
        model: lane.config?.model ?? undefined,
        log: (l) => {
          pushLog(track, l)
          say(lane, l.trim())
        },
        onStage: (stage) => setStage(track, stage, deps.now()),
      })
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
        lane.tracks.delete(runId)
        pending.delete(run)
        deps.wake?.()
      })
    pending.add(run)
  }

  async function laneStep(lane: LaneRuntime, now: number, g: HostGuards): Promise<void> {
    const c = lane.config
    if (deps.notReady?.has(lane.local.name)) {
      lane.state = 'not-ready'
      return
    }
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
    // Follow-ups first, as lane-v4 did: they finish PRs already open. Conflict
    // and audit lanes open no PRs of their own, so they take none.
    const takesFollowups = c.mode === 'fix' || c.mode === 'followups' || c.mode === 'skill'
    if (takesFollowups && now >= lane.nextFollowupAt && !lane.followup && agents() < g.max_agents) {
      const listed = await deps.call<{ fixes: LocalFollowupCandidate[] }>(`/v1/admin/projects/${lane.local.projectId}/local-followups`)
      if (listed.ok && listed.data.fixes.length > 0) startFollowup(lane, listed.data.fixes[0]!)
      else {
        lane.nextFollowupAt = now + (listed.ok ? IDLE_MS : BACKOFF_MS)
        if (!listed.ok) say(lane, `follow-ups not read: ${listed.error.code} ${listed.error.message}`)
      }
    }
    if (c.mode === 'followups') {
      lane.state = lane.followup ? 'working' : 'idle'
      return
    }
    while (!stopped && lane.running.size < c.concurrency && agents() < g.max_agents && now >= lane.nextClaimAt) {
      const r = await deps.call<{ claim: unknown; reason?: string }>('/v1/worker/claim', { method: 'POST', body: JSON.stringify({ laneId: lane.serverId }) })
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
      const parsed = parseClaim(r.data.claim)
      const claimId = typeof (r.data.claim as { id?: unknown }).id === 'string' ? ((r.data.claim as { id: string }).id) : null
      if (!parsed.ok) {
        await giveBack(lane, claimId, parsed.message)
        lane.nextClaimAt = now + BACKOFF_MS
        return
      }
      const k = parsed.value
      const model = k.model ?? lane.config?.model ?? undefined
      if (k.kind === 'fix' && (c.mode === 'fix' || c.mode === 'skill')) {
        startRun(lane, k.raw as unknown as ClaimFromServer)
      } else if (k.kind === 'conflict' && c.mode === 'conflicts') {
        const t = k.conflict
        startJob(lane, k.id, 'conflict', `conflict ${t.repo}#${t.prNumber} (${t.headRef} at ${t.headSha.slice(0, 7)})`, (signal, log) =>
          (deps.resolveConflict ?? resolveConflict)(t, { repoDir: lane.local.repoDir, model, log, signal }),
        )
      } else if (k.kind === 'audit' && c.mode === 'audit') {
        startJob(lane, k.id, 'audit', `audit pass (${k.audit.findingsLeft} finding(s) left this hour)`, (signal, log) =>
          (deps.auditPass ?? auditPass)(api, k.id, { repoDir: lane.local.repoDir, laneName: lane.local.name, model, reviewModel: k.audit.reviewModel, log, signal }),
        )
      } else if (k.kind === 'fresh_eyes' && deps.freshEyes) {
        // Any lane of the app runs it: the test needs no clone. Never log the target (it can hold passwords).
        const run = deps.freshEyes
        const t = k.freshEyes
        startJob(lane, k.id, 'fresh_eyes', `first-time user test ${t.runId}`, (signal, log) => run(t, { projectId: lane.local.projectId, signal, log }))
      } else {
        await giveBack(lane, k.id, `a ${k.kind} claim for a lane in ${c.mode} mode`)
        lane.nextClaimAt = now + BACKOFF_MS
        return
      }
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
    if (answer.recheckAccount) deps.recheck?.()
    if (answer.cursorAccount && answer.cursorAccount !== account) {
      account = answer.cursorAccount
      deps.setCursorAccount?.(answer.cursorAccount)
      say(null, `the console set the Cursor account to ${maskEmail(answer.cursorAccount)}`)
    }
    if (answer.cursorLogin && account) deps.cursorLogin?.start(answer.cursorLogin.requestId, account)
    for (const l of lanes) {
      const server = answer.lanes.find((s) => s.name === l.local.name && s.projectId === l.local.projectId)
      l.serverId = server?.id ?? null
      l.config = server?.config ?? null
    }
    // A first-time user test waits for these lanes' app: ask now, not after the idle wait.
    for (const l of lanes) if (l.serverId && answer.wake.includes(l.serverId)) l.nextClaimAt = 0
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
    // A switch of the Cursor account takes nothing new; the runs in flight finish first.
    if (deps.cursorLogin?.busy()) {
      if (hostState !== 'switching-account') say(null, 'waiting: switching the Cursor account (asked from the console)')
      hostState = 'switching-account'
      waitWhy = 'Switching the Cursor account (asked from the console)'
      for (const l of lanes) if (!l.running.size && !l.followup && !deps.notReady?.has(l.local.name)) l.state = 'switching-account'
      return
    }
    const gate = hostGate(guards, { ...lastReadings, agents: agents() })
    if (!gate.ok) {
      if (hostState !== gate.state) say(null, `waiting: ${gate.why}`)
      hostState = gate.state
      waitWhy = cleanLine(gate.why)
      for (const l of lanes) if (!l.running.size && !l.followup && !deps.notReady?.has(l.local.name)) l.state = gate.state
      return
    }
    waitWhy = null
    hostState = 'working'
    const now = deps.now()
    for (const l of lanes) {
      if (stopped) break
      await laneStep(l, now, guards)
    }
    if (lanes.every((l) => l.state === 'idle' || l.state === 'paused' || l.state === 'stopped' || l.state === 'not-ready')) hostState = 'idle'
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
    /** Agents running now (a switch of the Cursor account waits for them). */
    agents,
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

/**
 * @internal Exported for tests only. The sign-in, narrowed to one account when the worker config names it: a
 * clear "signed in" as anyone else counts as signed out (lane-v4 spent only
 * suzu's credits this way). An unclear answer stays unclear.
 */
export function cursorStateFor(s: { state: CursorSignIn; output: string }, account: string | undefined): CursorSignIn {
  if (!account || s.state !== 'signed_in') return s.state
  return s.output.toLowerCase().includes(account.toLowerCase()) ? 'signed_in' : 'signed_out'
}

/**
 * @internal Exported for tests only. The machine's readings before each pass,
 * and the checks behind them as they really answered. The Cursor account check
 * runs in the background after the first one (it can take up to 3 minutes
 * under load and must not hold the heartbeat); `recheck()` starts one at the
 * next reading (the console's "Re-check the account").
 */
export function createHostReadings(o: {
  cursorAccount?: string
  now: () => number
  log: (line: string) => void
  run?: typeof runProc
  checkCursor?: () => ReturnType<typeof checkCursorSignIn>
  memGb?: () => number
  load?: () => number
  cpus?: () => number
}) {
  const run = o.run ?? runProc
  const checkCursor = o.checkCursor ?? (() => checkCursorSignIn())
  let acct = o.cursorAccount
  const st = {
    ghAt: -Infinity,
    gh: null as number | null,
    cursorAt: -Infinity,
    cursor: 'unknown' as CursorSignIn,
    confirmedAt: null as number | null,
    first: true,
    asked: false,
    running: null as Promise<void> | null,
    checks: {} as NonNullable<HostReadings['checks']>,
  }
  const cursorCheck = (): Promise<void> => {
    if (st.running) return st.running
    st.cursorAt = o.now()
    st.running = checkCursor()
      .then((s) => {
        const at = o.now()
        st.cursor = cursorStateFor(s, acct)
        if (s.state === 'signed_in' && st.cursor === 'signed_out') o.log(`worker: the Cursor CLI is signed in, but not as ${acct ? maskEmail(acct) : 'the expected account'}; taking nothing new.`)
        if (st.cursor === 'signed_in') st.confirmedAt = at
        st.checks.cursor = { result: cursorCheckResult(s, acct), at, detail: s.detail }
      })
      .catch((err: unknown) => {
        st.checks.cursor = { result: 'unclear', at: o.now(), detail: err instanceof Error ? err.message : String(err) }
      })
      .finally(() => {
        st.running = null
      })
    return st.running
  }
  return {
    recheck(): void {
      st.asked = true
    },
    /** The console named another account: expect it, and check again at once. */
    setAccount(account: string): void {
      if (account === acct) return
      acct = account
      st.confirmedAt = null
      st.asked = true
    },
    async read(): Promise<HostReadings> {
      const now = o.now()
      if (now - st.ghAt >= GH_CHECK_MS) {
        const r = await run('gh', ['api', 'rate_limit', '--jq', '.resources.core.remaining'], { timeoutMs: 30_000 })
        // A hung or failed call is unknown, not an empty quota.
        st.gh = r.code === 0 && /^\d+$/.test(r.stdout.trim()) ? Number(r.stdout.trim()) : null
        st.ghAt = now
        const result = ghCheckResult(r)
        st.checks.gh = { result, at: o.now(), detail: result === 'signed_in' ? 'signed in' : r.timedOut ? 'gh did not answer in 30 s' : r.stderr.trim().split('\n')[0] ?? '' }
      }
      if (st.asked || now - st.cursorAt >= CURSOR_CHECK_MS) {
        st.asked = false
        const p = cursorCheck()
        // The first check is awaited, as before: nothing is claimed before the account is known.
        if (st.first) await p
      }
      st.first = false
      // A status call that timed out under load still counts as signed in for 2 h after the last confirmation.
      const t = o.now()
      const cursor = st.cursor === 'unknown' && st.confirmedAt !== null && t - st.confirmedAt < CURSOR_CONFIRM_GRACE_MS ? 'signed_in' : st.cursor
      return {
        memAvailableGb: o.memGb ? o.memGb() : (memAvailableGb(process.platform === 'linux' ? nodeHostIO.readFile('/proc/meminfo') : null) ?? Math.floor(freemem() / 1024 ** 3)),
        ghRemaining: st.gh,
        gh: st.checks.gh?.result,
        cursor,
        checks: { ...st.checks },
        load1: (o.load ?? (() => loadavg()[0]!))(),
        cpus: (o.cpus ?? availableParallelism)(),
      }
    },
  }
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

  // A machine that is not ready still starts and says so: the console shows it
  // (gh signed out waits on the gate; a lane whose clone is broken stays out).
  const gh = await runProc('gh', ['auth', 'status'], { timeoutMs: 30_000 })
  if (gh.code !== 0) process.stdout.write('worker: gh is not signed in on this machine; lanes take nothing until it is (run: gh auth login).\n')
  const repos = new Map<string, string>()
  const notReady = new Map<string, string>()
  for (const lane of cfg.lanes) {
    const g = await runProc('git', ['rev-parse', '--git-dir'], { cwd: lane.repoDir, timeoutMs: 30_000 })
    if (g.code !== 0) {
      process.stdout.write(`worker: lane ${lane.name}: ${lane.repoDir} is not a git clone; the lane stays out until it is (git clone <repo> ${lane.repoDir}, then restart).\n`)
      notReady.set(lane.name, 'Its folder on this machine is not a git clone (git rev-parse failed); clone the repo there and restart the worker')
      continue
    }
    // Which repository the clone is: conflict claims (ADR 0049) offer only its PRs.
    const origin = await runProc('git', ['remote', 'get-url', 'origin'], { cwd: lane.repoDir, timeoutMs: 30_000 })
    const repo = origin.code === 0 ? repoOfRemote(origin.stdout) : null
    if (repo) repos.set(lane.name, repo)
  }

  const conf: CliConfig = { apiKey: key, endpoint }
  let wake: () => void = () => undefined
  const readings = createHostReadings({ cursorAccount: cfg.cursorAccount, now: () => Date.now(), log: (l) => process.stdout.write(`${l}\n`) })
  // "Switch account" from the console. It counts the daemon's runs, which exist once the daemon does.
  const live = { agents: () => 0 }
  const cursorLogin = createCursorLogin({
    now: () => Date.now(),
    log: (l) => process.stdout.write(`${l}\n`),
    activeRuns: () => live.agents(),
    onSignedIn: (a) => {
      readings.setAccount(a)
      readings.recheck()
    },
  })
  const daemon = createDaemon(cfg, {
    call: (path, init) => apiCall(path, conf, init, { timeoutMs: 30_000 }),
    workOne,
    followUpOne,
    readings: () => readings.read(),
    recheck: () => readings.recheck(),
    notReady,
    ...(cfg.cursorAccount ? { cursorAccount: cfg.cursorAccount } : {}),
    setCursorAccount: (a) => readings.setAccount(a),
    cursorLogin,
    now: () => Date.now(),
    log: (l) => process.stdout.write(`${l}\n`),
    host: { hostId, hostname: nodeHostIO.hostname.split('.')[0]!.slice(0, 80) || 'host', platform, version: MUSHI_CLI_VERSION },
    wake: () => wake(),
    repos,
    freshEyes: (t, o) => runFreshEyesClaim(t, { ...o, apiKey: key, endpoint }),
  })
  live.agents = daemon.agents
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
