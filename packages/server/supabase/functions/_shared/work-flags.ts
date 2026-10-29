/**
 * FILE: packages/server/supabase/functions/_shared/work-flags.ts
 * PURPOSE: Worker flags (ADR 0048 amendment 2026-10-28): every way a local
 *          worker can stop doing useful work, found from data the server
 *          already holds, in plain English, each with one cause and the
 *          actions that fix it. Pure, no I/O: the Workers tab, the Pipeline
 *          sidebar badge, Home "Needs you", Spend credits, `mushi worker
 *          status` and the MCP tool all read this one result, so their counts
 *          agree.
 *
 *          On 2026-10-28 three lanes held the four agent spaces of one machine
 *          for 4 to 6 hours inside their repos' own git hooks, six lanes waited
 *          behind them, account checks timed out under load 37 on 16 cores,
 *          and expiring Cursor credits went unused. None of it showed in the
 *          console. Each flag below would have.
 *
 *            host_offline     no heartbeat for 3 minutes, with lanes on it
 *            machine_not_ready a lane could not start (its clone is not a git clone)
 *            run_stuck        a run has held an agent space over 45 minutes (with its stage)
 *            lanes_waiting    lanes waited over 15 minutes for an agent space (one per host,
 *                             naming the runs that hold the spaces)
 *            account_check    the Cursor account check: another account, signed out,
 *                             not installed, or timed out
 *            gh_signed_out    gh is not signed in on the machine
 *            machine_waiting  the memory, GitHub-quota or sign-in guard has held the
 *                             machine for over 5 minutes
 *            machine_busy     load per core of 2 or more
 *            hook_failures    2 or more runs of a lane failed in the repo's git hooks in 24 h
 *            unmanaged_run    a local `mushi work` run (fix_attempts.agent = 'mcp') has been
 *                             running over 45 minutes with no worker claim: a script, not
 *                             the console-steered worker, started it
 *            credits_idle     no agent work for 2 hours while Cursor credits expire within
 *                             7 days (named with the flag that blocks the work)
 *
 *          A daemon too old to send a field raises no flag for it: missing is
 *          not failing. The console says "update the CLI on that machine".
 */

import { HOST_ONLINE_MS, type LaneConfig } from './work-lanes.ts'
import type { HostChecks, RunStage, RunTelemetry, SlotTelemetry } from './work-telemetry.ts'

export const RUN_STUCK_MS = 45 * 60_000
export const LANE_WAIT_MS = 15 * 60_000
export const GUARD_WAIT_MS = 5 * 60_000
export const CREDITS_IDLE_MS = 2 * 3600_000
export const CREDITS_SOON_MS = 7 * 86_400_000
export const HOOK_WINDOW_MS = 24 * 3600_000
export const HOOK_FAILURES_MIN = 2
export const BUSY_LOAD_PER_CORE = 2
/** Slack between a claim and its fix row (the row starts after the claim; the server stamps both). */
const CLAIM_SLACK_MS = 60_000

export type WorkerFlagKind =
  | 'host_offline'
  | 'machine_not_ready'
  | 'run_stuck'
  | 'lanes_waiting'
  | 'account_check'
  | 'gh_signed_out'
  | 'machine_waiting'
  | 'machine_busy'
  | 'hook_failures'
  | 'unmanaged_run'
  | 'credits_idle'

export type WorkerFlagAction =
  | { kind: 'stop_run'; label: string; claimId: string }
  | { kind: 'pause_lane'; label: string; laneId: string }
  | { kind: 'open_report'; label: string; reportId: string }
  | { kind: 'open_pr'; label: string; prUrl: string }
  | { kind: 'copy_command'; label: string; command: string }
  | { kind: 'recheck_account'; label: string; hostId: string }
  /** Opens the console's "Switch account" dialog (the machine's owner signs it in as the right account). */
  | { kind: 'switch_account'; label: string; hostId: string }
  | { kind: 'open_page'; label: string; to: string }

export interface WorkerFlag {
  /** Stable across reads: kind and the row it is about. */
  id: string
  kind: WorkerFlagKind
  severity: 'danger' | 'warn'
  hostId: string | null
  hostname: string | null
  laneId: string | null
  laneName: string | null
  projectId: string | null
  /** One sentence: what is wrong. */
  title: string
  /** Why, in plain words, and what it costs. */
  cause: string
  /** How long it has been so, in seconds. */
  sinceSec: number | null
  /** The run's stage and last log lines, for a run that holds an agent space. */
  stage?: RunStage | null
  log?: string[]
  actions: WorkerFlagAction[]
}

export interface FlagHost {
  id: string
  hostname: string
  platform: string
  lastHeartbeatAt: string
  revoked: boolean
  status: Record<string, unknown>
}

export interface FlagLane {
  id: string
  hostId: string
  projectId: string
  name: string
  config: LaneConfig
  status: Record<string, unknown>
  queued: number
}

export interface FlagClaim {
  id: string
  laneId: string
  reportId: string | null
  kind: string
  status: string
  claimedAt: string
  leaseUntil: string
  finishedAt: string | null
  outcome: string | null
  failureKind: string | null
  detail: string | null
  prUrl: string | null
}

/** A `mushi work` run (fix_attempts.agent = 'mcp', status running) of the caller's apps. */
export interface FlagLocalRun {
  fixId: string
  reportId: string
  projectId: string
  createdAt: string
}

/** A Cursor key the caller can see whose credits expire, or a lane's stop date. */
export interface FlagCreditExpiry {
  label: string
  expiresAt: string
}

export interface FlagInput {
  hosts: FlagHost[]
  lanes: FlagLane[]
  /** Active and recently finished claims (the last 7 days is enough). */
  claims: FlagClaim[]
  localRuns: FlagLocalRun[]
  credits: FlagCreditExpiry[]
  now: Date
}

const SYSTEMD = 'mushi-worker.service'
const WINDOWS_TASK = 'Mushi worker'

/** "under a minute", "12 min", "4 h 20 min", "3 d". */
export function durationText(sec: number): string {
  if (sec < 60) return 'under a minute'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return min % 60 && h < 10 ? `${h} h ${min % 60} min` : `${h} h`
  return `${Math.round(h / 24)} d`
}

/** Where a run is, as a person says it. */
export const STAGE_TEXT: Record<RunStage, string> = {
  prepare: 'getting its copy of the repo and the dependencies ready',
  agent: 'with the coding agent working',
  commit: "in the repo's own commit hook (git commit)",
  push: "in the repo's own pre-push hook (git push)",
  pr: 'opening the pull request',
  run: 'running',
}

/** A run that failed in the repo's git hooks, by the text `mushi work` records (git() in commands/work.ts). */
export const HOOK_FAILURE_RE = /\bgit (?:commit|push) (?:failed|timed out)\b|\b(?:pre-commit|pre-push|commit-msg|husky|lefthook)\b|\bcommit hook\b/i

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const word = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const runsOf = (lane: FlagLane): RunTelemetry[] => (Array.isArray(lane.status.inflight) ? (lane.status.inflight as RunTelemetry[]) : [])
const slotsOf = (host: FlagHost): SlotTelemetry[] | null => (Array.isArray(host.status.slots) ? (host.status.slots as SlotTelemetry[]) : null)
const checksOf = (host: FlagHost): HostChecks => (host.status.checks && typeof host.status.checks === 'object' ? (host.status.checks as HostChecks) : {})
const posix = (platform: string) => platform !== 'windows'

function serviceCommand(platform: string): string {
  if (platform === 'windows') return `schtasks /Query /TN "${WINDOWS_TASK}" /V /FO LIST`
  if (platform === 'macos') return 'mushi worker status'
  return `systemctl --user status ${SYSTEMD} --no-pager; journalctl --user -u ${SYSTEMD} -n 50 --no-pager`
}

function stuckCommand(platform: string): string {
  return posix(platform)
    ? "ps -eo pid,etime,stat,args | grep -E 'git (commit|push)|cursor-agent|tsc|eslint|pnpm' | grep -v grep"
    : 'Get-Process git,node,cursor-agent -ErrorAction SilentlyContinue | Select-Object Id,StartTime,ProcessName'
}

function ageSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? Math.max(0, Math.round((now.getTime() - t) / 1000)) : null
}

const lanePart = (n: number) => (n === 1 ? '1 lane' : `${n} lanes`)

/** Every flag, worst first (danger, then the longest-standing). */
export function deriveWorkerFlags(input: FlagInput): WorkerFlag[] {
  const { now } = input
  const flags: WorkerFlag[] = []
  const lanesByHost = new Map<string, FlagLane[]>()
  for (const l of input.lanes) lanesByHost.set(l.hostId, [...(lanesByHost.get(l.hostId) ?? []), l])
  const laneById = new Map(input.lanes.map((l) => [l.id, l]))
  const nowMs = now.getTime()
  const activeClaims = input.claims.filter((c) => c.status === 'active' && Date.parse(c.leaseUntil) > nowMs)
  const base = (host: FlagHost | null, lane: FlagLane | null) => ({
    hostId: host?.id ?? lane?.hostId ?? null,
    hostname: host?.hostname ?? null,
    laneId: lane?.id ?? null,
    laneName: lane?.name ?? null,
    projectId: lane?.projectId ?? null,
  })
  const onlineHosts = new Set<string>()
  /** Titles of what blocks work, per host, for the credits flag's reason. */
  const blockers: string[] = []

  for (const host of input.hosts) {
    if (host.revoked) continue
    const lanes = lanesByHost.get(host.id) ?? []
    const heartbeatAge = ageSince(host.lastHeartbeatAt, now)
    const online = heartbeatAge !== null && heartbeatAge * 1000 <= HOST_ONLINE_MS
    if (!online) {
      if (lanes.length === 0) continue
      const queued = lanes.reduce((n, l) => n + l.queued, 0)
      const title = `${host.hostname} is offline`
      blockers.push(title)
      flags.push({
        id: `host_offline:${host.id}`,
        kind: 'host_offline',
        severity: 'danger',
        ...base(host, null),
        title,
        cause: `No heartbeat for ${durationText(heartbeatAge ?? 0)}. ${lanes.length === 1 ? 'Its lane takes' : `Its ${lanes.length} lanes take`} nothing${queued ? `, and ${queued} queued report${queued === 1 ? ' waits' : 's wait'}` : ''}. The worker process stopped, or the machine is off or asleep.`,
        sinceSec: heartbeatAge,
        actions: [{ kind: 'copy_command', label: 'Check the worker on that machine', command: serviceCommand(host.platform) }],
      })
      continue
    }
    onlineHosts.add(host.id)
    const s = host.status
    const checks = checksOf(host)
    const state = word(s.state)
    const stateSec = num(s.stateSec)

    for (const nr of checks.notReady ?? []) {
      const lane = lanes.find((l) => l.name === nr.lane) ?? null
      const title = `${nr.lane} on ${host.hostname} could not start`
      blockers.push(title)
      flags.push({
        id: `machine_not_ready:${host.id}:${nr.lane}`,
        kind: 'machine_not_ready',
        severity: 'danger',
        ...base(host, lane),
        title,
        cause: `${nr.problem}. The other lanes run; this one takes nothing until it is fixed and the worker restarts.`,
        sinceSec: stateSec,
        actions: [{ kind: 'copy_command', label: 'Restart the worker after fixing it', command: host.platform === 'windows' ? `schtasks /Run /TN "${WINDOWS_TASK}"` : `systemctl --user restart ${SYSTEMD}` }],
      })
    }

    // The Cursor account check, as the machine last ran it. While the machine
    // switches accounts (asked from the console) another account is expected, not a problem.
    const cur = checks.cursor
    if (cur && cur.result !== 'expected' && cur.result !== 'unclear' && state !== 'switching-account') {
      const danger = cur.result !== 'timed_out'
      const title =
        cur.result === 'other_account'
          ? `Cursor on ${host.hostname} is signed in as another account`
          : cur.result === 'signed_out'
            ? `Cursor on ${host.hostname} is signed out`
            : cur.result === 'missing'
              ? `The Cursor CLI is missing on ${host.hostname}`
              : `The Cursor account check timed out on ${host.hostname}`
      const load = num(s.load1)
      const cores = num(s.cpus)
      const loadText = load !== null && cores ? ` under load ${load} on ${cores} cores` : ''
      const cause =
        cur.result === 'other_account'
          ? `The lanes take nothing, so another account's credits are never spent${cur.account ? `: they must run as ${cur.account}` : ''}. Checked ${durationText(cur.ageSec)} ago.`
          : cur.result === 'signed_out'
            ? `The lanes take nothing until it is signed in again. Checked ${durationText(cur.ageSec)} ago.`
            : cur.result === 'missing'
              ? 'cursor-agent is not installed or not on the worker\'s PATH, so no lane can start an agent.'
              : `\`cursor-agent status\` did not answer in time${loadText} ${durationText(cur.ageSec)} ago. The worker goes on, but it cannot confirm which account is spending the credits.`
      if (danger) blockers.push(title)
      flags.push({
        id: `account_check:${host.id}`,
        kind: 'account_check',
        severity: danger ? 'danger' : 'warn',
        ...base(host, null),
        title,
        cause: cur.detail && cur.result !== 'missing' ? `${cause} It said: "${cur.detail}".` : cause,
        sinceSec: cur.ageSec,
        actions: [
          ...(cur.result === 'other_account' || cur.result === 'signed_out' ? [{ kind: 'switch_account' as const, label: 'Switch account', hostId: host.id }] : []),
          { kind: 'recheck_account', label: 'Re-check the account', hostId: host.id },
          { kind: 'copy_command', label: cur.result === 'timed_out' ? 'Check it on the machine' : 'Sign in on the machine', command: cur.result === 'timed_out' ? 'cursor-agent status' : cur.result === 'missing' ? 'cursor-agent --version' : 'cursor-agent login' },
        ],
      })
    }

    if (checks.gh?.result === 'signed_out') {
      const title = `gh is not signed in on ${host.hostname}`
      blockers.push(title)
      flags.push({
        id: `gh_signed_out:${host.id}`,
        kind: 'gh_signed_out',
        severity: 'danger',
        ...base(host, null),
        title,
        cause: `The worker pushes branches and opens pull requests with the machine's own gh, so the lanes take nothing. Checked ${durationText(checks.gh.ageSec)} ago${checks.gh.detail ? `: "${checks.gh.detail}"` : ''}.`,
        sinceSec: checks.gh.ageSec,
        actions: [{ kind: 'copy_command', label: 'Sign in on the machine', command: 'gh auth login' }],
      })
    }

    if ((state === 'mem-wait' || state === 'gh-quota-wait' || state === 'auth-wait') && stateSec !== null && stateSec * 1000 >= GUARD_WAIT_MS) {
      const why = word(s.waitWhy)
      const title = `${host.hostname} has taken nothing new for ${durationText(stateSec)}`
      blockers.push(title)
      flags.push({
        id: `machine_waiting:${host.id}`,
        kind: 'machine_waiting',
        severity: 'warn',
        ...base(host, null),
        title,
        cause: `${why ? `${why[0]!.toUpperCase()}${why.slice(1)}.` : 'A machine guard holds it.'} ${state === 'mem-wait' ? 'Free memory, or lower the floor in this machine\'s limits.' : state === 'gh-quota-wait' ? 'It goes on when GitHub resets the hourly quota.' : 'Sign in again on the machine.'}`,
        sinceSec: stateSec,
        actions: [
          {
            kind: 'copy_command',
            label: 'Look on the machine',
            command: state === 'mem-wait' ? (posix(host.platform) ? 'free -g; ps -eo pid,rss,args --sort=-rss | head -15' : 'Get-Process | Sort-Object WS -Descending | Select-Object -First 15') : state === 'gh-quota-wait' ? 'gh api rate_limit --jq .resources.core' : 'cursor-agent status; gh auth status',
          },
        ],
      })
    }

    const load = num(s.load1)
    const cores = num(s.cpus)
    if (load !== null && cores && load / cores >= BUSY_LOAD_PER_CORE) {
      flags.push({
        id: `machine_busy:${host.id}`,
        kind: 'machine_busy',
        severity: 'warn',
        ...base(host, null),
        title: `${host.hostname} is overloaded: load ${load} on ${cores} cores`,
        cause: 'Under this load account checks and the repos\' git hooks time out, and every run takes longer. Run fewer agents at once (this machine\'s limits), or stop what else runs there.',
        sinceSec: null,
        actions: [{ kind: 'copy_command', label: 'See what runs', command: posix(host.platform) ? 'uptime; ps -eo pid,pcpu,etime,args --sort=-pcpu | head -15' : 'Get-Process | Sort-Object CPU -Descending | Select-Object -First 15' }],
      })
    }

    // Runs that hold an agent space too long: claims first (they can be stopped), then follow-ups.
    const telemetry = new Map<string, { lane: FlagLane; run: RunTelemetry }>()
    for (const lane of lanes) for (const run of runsOf(lane)) telemetry.set(run.runId, { lane, run })
    const stuckTitles: string[] = []
    for (const claim of activeClaims) {
      const lane = laneById.get(claim.laneId)
      if (!lane || lane.hostId !== host.id) continue
      const t = telemetry.get(claim.id)?.run
      const age = t?.ageSec ?? ageSince(claim.claimedAt, now) ?? 0
      if (age * 1000 < RUN_STUCK_MS) continue
      const where = t ? `It has been ${STAGE_TEXT[t.stage]} for ${durationText(t.stageSec)}.` : 'The Mushi CLI on that machine does not report the stage yet; update it to see where the run is.'
      const hook = t && (t.stage === 'commit' || t.stage === 'push') ? ' A hook that hangs (a type check or lint under load) holds the space until git\'s time limit stops it.' : ''
      const title = `${lane.name}: a run has held an agent space for ${durationText(age)}`
      stuckTitles.push(`${lane.name} (${durationText(age)}${t ? `, ${t.stage === 'commit' || t.stage === 'push' ? `${t.stage} hook` : t.stage}` : ''})`)
      blockers.push(title)
      flags.push({
        id: `run_stuck:${claim.id}`,
        kind: 'run_stuck',
        severity: 'danger',
        ...base(host, lane),
        title,
        cause: `${where}${hook} While it holds the space, other lanes on ${host.hostname} may wait.`,
        sinceSec: age,
        stage: t?.stage ?? null,
        log: t?.log ?? [],
        actions: [
          { kind: 'stop_run', label: 'Stop this run', claimId: claim.id },
          ...(claim.reportId ? [{ kind: 'open_report' as const, label: 'Open the report', reportId: claim.reportId }] : []),
          { kind: 'copy_command', label: 'Find it on the machine', command: stuckCommand(host.platform) },
        ],
      })
    }
    const activeIds = new Set(activeClaims.map((c) => c.id))
    for (const [runId, { lane, run }] of telemetry) {
      if (run.ageSec * 1000 < RUN_STUCK_MS) continue
      if (run.kind !== 'followup') {
        if (activeIds.has(runId)) continue
        // Its claim ended (stopped from the console, or its lease ran out), yet the machine still runs it.
        const ended = input.claims.find((c) => c.id === runId)
        const how = ended?.outcome === 'stopped' ? `was stopped ${durationText(ageSince(ended.finishedAt, now) ?? 0)} ago` : 'lost its claim'
        const title = `${lane.name}: a run that ${how} still holds an agent space`
        stuckTitles.push(`${lane.name} (${durationText(run.ageSec)}, ${run.stage === 'commit' || run.stage === 'push' ? `${run.stage} hook` : run.stage}, ended)`)
        blockers.push(title)
        flags.push({
          id: `run_stuck:${runId}`,
          kind: 'run_stuck',
          severity: 'danger',
          ...base(host, lane),
          title,
          cause: `The machine has been ${STAGE_TEXT[run.stage]} for ${durationText(run.stageSec)} (run ${durationText(run.ageSec)}). The agent stops at the next heartbeat; a git hook already running ends only at git's own time limit (25 min), so end it on the machine to free the space now.`,
          sinceSec: run.ageSec,
          stage: run.stage,
          log: run.log,
          actions: [
            ...(run.reportId ? [{ kind: 'open_report' as const, label: 'Open the report', reportId: run.reportId }] : []),
            { kind: 'copy_command', label: 'Find it on the machine', command: stuckCommand(host.platform) },
          ],
        })
        continue
      }
      const title = `${lane.name}: a review follow-up has held an agent space for ${durationText(run.ageSec)}`
      stuckTitles.push(`${lane.name} follow-up (${durationText(run.ageSec)}, ${run.stage})`)
      blockers.push(title)
      flags.push({
        id: `run_stuck:${host.id}:${runId}`,
        kind: 'run_stuck',
        severity: 'danger',
        ...base(host, lane),
        title,
        cause: `It has been ${STAGE_TEXT[run.stage]} for ${durationText(run.stageSec)}. A follow-up is not a claim, so the console cannot stop it: pause the lane, and end it on the machine.`,
        sinceSec: run.ageSec,
        stage: run.stage,
        log: run.log,
        actions: [
          { kind: 'pause_lane', label: 'Pause this lane', laneId: lane.id },
          { kind: 'copy_command', label: 'Find it on the machine', command: stuckCommand(host.platform) },
        ],
      })
    }

    // Lanes waiting for an agent space: one flag for the host, naming who holds the spaces.
    const waiting = lanes.filter((l) => !l.config.paused && word(l.status.state) === 'slot-wait' && (num(l.status.stateSec) ?? 0) * 1000 >= LANE_WAIT_MS)
    if (waiting.length) {
      const longest = Math.max(...waiting.map((l) => num(l.status.stateSec) ?? 0))
      const max = num(s.maxAgents)
      const slots = slotsOf(host)
      const holders = slots
        ? slots.map((x) => `${x.lane} (${durationText(x.ageSec)}, ${x.stage === 'commit' || x.stage === 'push' ? `${x.stage} hook` : x.stage})`)
        : stuckTitles
      const title = `${lanePart(waiting.length)} on ${host.hostname} ${waiting.length === 1 ? 'has' : 'have'} waited ${durationText(longest)} for an agent space`
      blockers.push(title)
      flags.push({
        id: `lanes_waiting:${host.id}`,
        kind: 'lanes_waiting',
        severity: longest * 1000 >= 4 * LANE_WAIT_MS ? 'danger' : 'warn',
        ...base(host, null),
        title,
        cause: `An agent space is one coding agent at a time; this machine allows ${max ?? 'a fixed number of'} at once. ${holders.length ? `They are held by ${holders.join(', ')}.` : 'The machine did not say which runs hold them; update the Mushi CLI there.'} Waiting: ${waiting.map((l) => l.name).join(', ')}.`,
        sinceSec: longest,
        actions: [{ kind: 'copy_command', label: 'Find the runs on the machine', command: stuckCommand(host.platform) }],
      })
    }
  }

  // Repeated failures in the repo's git hooks, per lane.
  for (const lane of input.lanes) {
    const hits = input.claims
      .filter((c) => c.laneId === lane.id && c.status !== 'active' && c.finishedAt && nowMs - Date.parse(c.finishedAt) <= HOOK_WINDOW_MS)
      .filter((c) => (c.outcome === 'failed' || c.outcome === 'timeout') && HOOK_FAILURE_RE.test(c.detail ?? ''))
      .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))
    if (hits.length < HOOK_FAILURES_MIN) continue
    const latest = hits[0]!
    flags.push({
      id: `hook_failures:${lane.id}`,
      kind: 'hook_failures',
      severity: 'warn',
      ...base(input.hosts.find((h) => h.id === lane.hostId) ?? null, lane),
      title: `${lane.name}: ${hits.length} runs failed in the repo's git hooks in 24 h`,
      cause: `The latest: "${(latest.detail ?? '').slice(0, 200)}". The agent's change may be fine; the repo's own commit or pre-push check failed or hung, and each try spends an agent space and credits.`,
      sinceSec: ageSince(latest.finishedAt, now),
      actions: [
        { kind: 'pause_lane', label: 'Pause this lane', laneId: lane.id },
        ...(latest.reportId ? [{ kind: 'open_report' as const, label: 'Open the latest report', reportId: latest.reportId }] : []),
        ...(latest.prUrl ? [{ kind: 'open_pr' as const, label: 'Open its PR', prUrl: latest.prUrl }] : []),
      ],
    })
  }

  // Local runs no worker claims: started by a script, so the console cannot see or stop them. A run
  // is the worker's own when a claim on its report covered its start (active, stopped from the
  // console, or a lease that ran out): the fix row starts after the claim, while it holds.
  const claimedRun = (run: FlagLocalRun) => {
    const started = Date.parse(run.createdAt)
    return input.claims.some((c) => {
      if (c.reportId !== run.reportId) return false
      const from = Date.parse(c.claimedAt)
      const to = c.finishedAt ? Date.parse(c.finishedAt) : Infinity
      return from <= started + CLAIM_SLACK_MS && to >= started - CLAIM_SLACK_MS
    })
  }
  for (const run of input.localRuns) {
    const age = ageSince(run.createdAt, now)
    if (age === null || age * 1000 < RUN_STUCK_MS || claimedRun(run)) continue
    const title = `A local mushi work run has been running ${durationText(age)} outside the worker`
    blockers.push(title)
    flags.push({
      id: `unmanaged_run:${run.fixId}`,
      kind: 'unmanaged_run',
      severity: 'danger',
      hostId: null,
      hostname: null,
      laneId: null,
      laneName: null,
      projectId: run.projectId,
      title,
      cause: 'A script on a machine started it (not mushi work --daemon), so Mushi cannot see its stage or stop it. If it hangs in a git hook it holds that machine\'s agents too. Move the machine to the worker: mushi worker install --lanes-conf <your lanes.conf>.',
      sinceSec: age,
      actions: [
        { kind: 'open_report', label: 'Open the report', reportId: run.reportId },
        { kind: 'copy_command', label: 'Find it on the machine', command: stuckCommand('linux') },
      ],
    })
  }

  // Credits that expire while no agent works.
  const expiries = input.credits
    .map((c) => ({ ...c, at: Date.parse(c.expiresAt) }))
    .filter((c) => Number.isFinite(c.at) && c.at > nowMs && c.at - nowMs <= CREDITS_SOON_MS)
    .sort((a, b) => a.at - b.at)
  if (expiries.length && input.lanes.length) {
    // Agent work: a run with its agent going now, or a claim that ended in a real outcome.
    const working = input.lanes.some((l) => onlineHosts.has(l.hostId) && runsOf(l).some((r) => r.stage === 'agent'))
    const ended = input.claims
      .filter((c) => c.finishedAt && c.outcome && !['skipped', 'stopped', 'lease_expired'].includes(c.outcome))
      .map((c) => Date.parse(c.finishedAt!))
      .filter((t) => Number.isFinite(t))
    const lastWork = ended.length ? Math.max(...ended) : null
    const idleSec = lastWork === null ? null : Math.round((nowMs - lastWork) / 1000)
    if (!working && (idleSec === null || idleSec * 1000 >= CREDITS_IDLE_MS)) {
      const first = expiries[0]!
      const left = Math.round((first.at - nowMs) / 1000)
      const allPaused = input.lanes.every((l) => l.config.paused || l.config.drain)
      const reason = blockers[0]
        ? `What blocks the work: ${blockers[0]}${blockers.length > 1 ? ` (and ${blockers.length - 1} more below)` : ''}.`
        : allPaused
          ? 'Every lane is paused or draining.'
          : 'The lanes found nothing they may take: queue reports to a lane, or check its mode.'
      flags.push({
        id: 'credits_idle',
        kind: 'credits_idle',
        severity: left * 1000 <= 2 * 86_400_000 ? 'danger' : 'warn',
        hostId: null,
        hostname: null,
        laneId: null,
        laneName: null,
        projectId: null,
        title: idleSec === null ? 'Cursor credits idle: no local agent ran in 7 days' : `Cursor credits idle for ${durationText(idleSec)}`,
        cause: `${first.label} expires in ${durationText(left)}. ${reason}`,
        sinceSec: idleSec,
        actions: [
          { kind: 'open_page', label: 'Open Workers', to: '/pipeline?tab=workers' },
          { kind: 'open_page', label: 'Spend credits', to: '/credits' },
        ],
      })
    }
  }

  return flags.sort((a, b) => (a.severity === b.severity ? (b.sinceSec ?? 0) - (a.sinceSec ?? 0) : a.severity === 'danger' ? -1 : 1))
}

/** The flags that touch one app: its lanes, its machines' host-wide flags, its unmanaged runs, and credits. */
export function flagsForProject(flags: readonly WorkerFlag[], lanes: ReadonlyArray<Pick<FlagLane, 'hostId' | 'projectId'>>, projectId: string): WorkerFlag[] {
  const hosts = new Set(lanes.filter((l) => l.projectId === projectId).map((l) => l.hostId))
  return flags.filter((f) => f.projectId === projectId || (f.laneId === null && f.hostId !== null && hosts.has(f.hostId)) || (f.kind === 'credits_idle' && hosts.size > 0))
}

/** The sidebar badge: how many flags, and whether any is danger. */
export function flagSummary(flags: readonly WorkerFlag[]): { flags: number; danger: number; top: string | null } {
  return { flags: flags.length, danger: flags.filter((f) => f.severity === 'danger').length, top: flags[0]?.title ?? null }
}
