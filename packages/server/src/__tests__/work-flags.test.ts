/**
 * FILE: work-flags.test.ts
 * PURPOSE: Worker flags (ADR 0048 amendment 2026-10-28, _shared/work-flags.ts)
 *          and the telemetry they read (_shared/work-telemetry.ts):
 *            - the heartbeat keeps each run's stage, ages and log lines, which
 *              lane holds each agent space, and the account and gh checks;
 *              cleanStatus alone dropped all of it;
 *            - every log line loses keys, tokens, e-mails, paths and quoted
 *              source;
 *            - the 2026-10-28 incident raises the flags that explain it: three
 *              runs stuck in the repos' own git hooks for 4 to 6 hours, one
 *              "waiting for an agent space" flag naming them, the account check
 *              timing out under load, and Cursor credits idle;
 *            - a daemon too old to send telemetry raises no false flag.
 */

import { describe, expect, it } from 'vitest'
import { cleanStatus, parseHeartbeat, type LaneConfig } from '../../supabase/functions/_shared/work-lanes.ts'
import { cleanLogLine } from '../../supabase/functions/_shared/work-telemetry.ts'
import { deriveWorkerFlags, durationText, flagsForProject, flagSummary, type FlagClaim, type FlagHost, type FlagLane, type FlagInput } from '../../supabase/functions/_shared/work-flags.ts'

const NOW = new Date('2026-10-28T12:00:00Z')
const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'
const H = 'h0000000-0000-4000-8000-000000000000'
const C = (n: number) => `c000000${n}-0000-4000-8000-000000000000`
const L = (n: number) => `l000000${n}-0000-4000-8000-000000000000`
const R = (n: number) => `2000000${n}-0000-4000-8000-000000000000`
const ago = (sec: number) => new Date(NOW.getTime() - sec * 1000).toISOString()
const HOUR = 3600
const CFG: LaneConfig = { paused: false, concurrency: 1, model: 'grok-4.7-xhigh-fast', mode: 'fix', stop_at: null, drain: false, prune_own: false }

const host = (status: Record<string, unknown>, over: Partial<FlagHost> = {}): FlagHost => ({ id: H, hostname: 'alienware', platform: 'wsl2', lastHeartbeatAt: ago(30), revoked: false, status, ...over })
const lane = (n: number, status: Record<string, unknown>, over: Partial<FlagLane> = {}): FlagLane => ({ id: L(n), hostId: H, projectId: P1, name: `lane-${n}`, config: CFG, status, queued: 0, ...over })
const claim = (n: number, over: Partial<FlagClaim> = {}): FlagClaim => ({
  id: C(n),
  laneId: L(n),
  reportId: R(n),
  kind: 'fix',
  status: 'active',
  claimedAt: ago(5 * HOUR),
  leaseUntil: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
  finishedAt: null,
  outcome: null,
  failureKind: null,
  detail: null,
  prUrl: null,
  ...over,
})
const input = (over: Partial<FlagInput>): FlagInput => ({ hosts: [], lanes: [], claims: [], localRuns: [], credits: [], now: NOW, ...over })

describe('the heartbeat keeps what the console needs (it dropped it before)', () => {
  it('keeps runs, agent spaces and checks, cleaned and capped', () => {
    const raw = {
      host: { hostId: 'a'.repeat(64), hostname: 'alienware', platform: 'wsl2', version: '0.31.0' },
      status: {
        state: 'slot-wait',
        agents: 4,
        maxAgents: 4,
        load1: 37.2,
        cpus: 16,
        stateSec: 3 * HOUR,
        waitWhy: '4 agents running, the host\'s cap is 4',
        checks: { cursor: { result: 'timed_out', ageSec: 600, detail: 'timed out after 90 s', account: 's***@g***.com' }, gh: { result: 'signed_in', ageSec: 60, detail: 'signed in' }, bogus: 1 },
        slots: [{ lane: 'glot', runId: C(1), kind: 'fix', ageSec: 4 * HOUR, stage: 'commit', stageSec: 4 * HOUR }, { lane: '../etc', runId: 'x', kind: 'fix', ageSec: 1 }],
      },
      lanes: [
        {
          name: 'glot',
          projectId: P1,
          status: {
            state: 'working',
            // lane-v4's counter keeps its name beside the runs in flight.
            runs: 4,
            stateSec: 4 * HOUR,
            inflight: [
              {
                runId: C(1),
                kind: 'fix',
                reportId: R(1),
                ageSec: 4 * HOUR + 600,
                stage: 'commit',
                stageSec: 4 * HOUR,
                model: 'grok-4.7-xhigh-fast',
                log: ['  12 | const k = process.env.KEY', 'push to https://x-access-token:ghs_abcdefghijklmnopqrstuvwxyz0123@github.com/o/r.git', 'as suzu.haruka1130@gmail.com in /home/mushi-agent/.cache/mushi/work/glot/2000000a'],
              },
            ],
          },
        },
      ],
      claims: [C(1)],
    }
    // Before: the flat parser drops every structured field.
    expect(cleanStatus(raw.status)).not.toHaveProperty('slots')
    expect(cleanStatus(raw.lanes[0]!.status)).not.toHaveProperty('inflight')
    const parsed = parseHeartbeat(raw)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const s = parsed.value.status
    expect(s).toMatchObject({ state: 'slot-wait', load1: 37.2, cpus: 16, stateSec: 3 * HOUR, waitWhy: "4 agents running, the host's cap is 4" })
    expect(s.checks).toEqual({ cursor: { result: 'timed_out', ageSec: 600, detail: 'timed out after 90 s', account: 's***@g***.com' }, gh: { result: 'signed_in', ageSec: 60, detail: 'signed in' } })
    expect(s.slots).toEqual([{ lane: 'glot', runId: C(1), kind: 'fix', ageSec: 4 * HOUR, stage: 'commit', stageSec: 4 * HOUR }])
    expect(parsed.value.lanes[0]!.status.runs).toBe(4)
    const run = (parsed.value.lanes[0]!.status.inflight as Array<{ log: string[] }>)[0]!
    expect(run).toMatchObject({ runId: C(1), stage: 'commit', stageSec: 4 * HOUR, model: 'grok-4.7-xhigh-fast' })
    expect(run.log).toEqual(['push to https://github.com/o/r.git', 'as s***@g***.com in …/2000000a'])
  })

  it('refuses an unmasked account and caps every list', () => {
    const parsed = parseHeartbeat({
      host: { hostId: 'b'.repeat(64), hostname: 'x', platform: 'linux' },
      status: { checks: { cursor: { result: 'expected', ageSec: 1, detail: '', account: 'suzu.haruka1130@gmail.com' } }, slots: Array.from({ length: 40 }, (_, i) => ({ lane: 'l', runId: C(1), kind: 'fix', ageSec: i })) },
      lanes: [],
    })
    expect(parsed.ok && (parsed.value.status.checks as { cursor: { account: string | null } }).cursor.account).toBeNull()
    expect(parsed.ok && (parsed.value.status.slots as unknown[]).length).toBe(16)
  })
})

describe('cleanLogLine', () => {
  it('keeps no key, token, e-mail, path or source line', () => {
    expect(cleanLogLine('Authorization: Bearer abcdef')).toBe('Authorization: Bearer [hidden]')
    expect(cleanLogLine('sk-ant-api03-abcdefghijklmnopqrstuvwxyz')).toBe('[a line was hidden: it looked like a key or token]')
    expect(cleanLogLine('12   const secret = "x"')).toBeNull()
    expect(cleanLogLine('git commit timed out after 25 min (the repo\'s commit hook did not finish); stopped it')).toBe("git commit timed out after 25 min (the repo's commit hook did not finish); stopped it")
    expect(cleanLogLine(42)).toBeNull()
  })
})

describe('deriveWorkerFlags: the 2026-10-28 incident', () => {
  // 4 agent spaces: glot 4 h in its commit hook, yen-yen 5.6 h in its pre-push hook,
  // tsumagoi 6 h in its commit hook, one healthy run; 6 lanes waited 3 h.
  const spaces = [
    { n: 1, stage: 'commit', age: 4 * HOUR + 600, stageSec: 4 * HOUR },
    { n: 2, stage: 'push', age: 5.6 * HOUR, stageSec: 5.5 * HOUR },
    { n: 3, stage: 'commit', age: 6 * HOUR, stageSec: 5.9 * HOUR },
    { n: 4, stage: 'agent', age: 10 * 60, stageSec: 8 * 60 },
  ]
  const busy = spaces.map((x) =>
    lane(x.n, { state: 'working', inflight: [{ runId: C(x.n), kind: 'fix', reportId: R(x.n), ageSec: x.age, stage: x.stage, stageSec: x.stageSec, model: null, log: ['commit: pnpm exec tsc --noEmit'] }] }),
  )
  const waiting = [5, 6, 7, 8, 9].map((n) => lane(n, { state: 'slot-wait', stateSec: 3 * HOUR }))
  const queuedWaiting = lane(10, { state: 'slot-wait', stateSec: 3 * HOUR }, { queued: 3 })
  const machine = host({
    state: 'slot-wait',
    agents: 4,
    maxAgents: 4,
    load1: 37,
    cpus: 16,
    checks: { cursor: { result: 'timed_out', ageSec: 900, detail: 'timed out after 90 s', account: 's***@g***.com' }, gh: { result: 'signed_in', ageSec: 60, detail: '' } },
    slots: spaces.map((x) => ({ lane: `lane-${x.n}`, runId: C(x.n), kind: 'fix', ageSec: x.age, stage: x.stage, stageSec: x.stageSec })),
  })
  const flags = deriveWorkerFlags(
    input({
      hosts: [machine],
      lanes: [...busy, ...waiting, queuedWaiting],
      claims: spaces.map((x) => claim(x.n, { claimedAt: ago(x.age) })),
      credits: [{ label: 'Cursor key "suzu"', expiresAt: '2026-10-31T00:00:00Z' }],
    }),
  )
  const kinds = flags.map((f) => f.kind)

  it('names each run stuck in a git hook, with its stage and duration, and offers Stop', () => {
    const stuck = flags.filter((f) => f.kind === 'run_stuck')
    expect(stuck.map((f) => f.laneName).sort()).toEqual(['lane-1', 'lane-2', 'lane-3'])
    const glot = stuck.find((f) => f.laneName === 'lane-1')!
    expect(glot).toMatchObject({ severity: 'danger', stage: 'commit', sinceSec: 4 * HOUR + 600 })
    expect(glot.title).toBe('lane-1: a run has held an agent space for 4 h 10 min')
    expect(glot.cause).toContain("in the repo's own commit hook (git commit) for 4 h")
    expect(glot.log).toEqual(['commit: pnpm exec tsc --noEmit'])
    expect(glot.actions.map((a) => a.kind)).toEqual(['stop_run', 'open_report', 'copy_command'])
    expect(glot.actions[0]).toEqual({ kind: 'stop_run', label: 'Stop this run', claimId: C(1) })
    expect(stuck.find((f) => f.laneName === 'lane-2')!.cause).toContain('pre-push hook (git push)')
  })

  it('raises one waiting flag for the machine, naming who holds the spaces', () => {
    const w = flags.filter((f) => f.kind === 'lanes_waiting')
    expect(w).toHaveLength(1)
    expect(w[0]!.title).toBe('6 lanes on alienware have waited 3 h for an agent space')
    expect(w[0]!.cause).toContain('this machine allows 4 at once')
    expect(w[0]!.cause).toContain('lane-2 (5 h 36 min, push hook)')
    expect(w[0]!.cause).toContain('Waiting: lane-5, lane-6, lane-7, lane-8, lane-9, lane-10')
  })

  it('says the account check timed out under load, and that the machine is overloaded', () => {
    const acct = flags.find((f) => f.kind === 'account_check')!
    expect(acct).toMatchObject({ severity: 'warn', title: 'The Cursor account check timed out on alienware' })
    expect(acct.cause).toContain('under load 37 on 16 cores')
    expect(acct.actions.map((a) => a.kind)).toEqual(['recheck_account', 'copy_command'])
    expect(kinds).toContain('machine_busy')
  })

  it('does not call the credits idle while an agent works', () => {
    expect(kinds).not.toContain('credits_idle')
  })

  it('calls the credits idle when no agent has worked for 2 h, with what blocks the work', () => {
    const blocked = deriveWorkerFlags(
      input({
        hosts: [machine],
        lanes: [...busy.slice(0, 3), ...waiting],
        claims: [...spaces.slice(0, 3).map((x) => claim(x.n, { claimedAt: ago(x.age) })), claim(9, { status: 'done', outcome: 'pr_opened', finishedAt: ago(7 * HOUR), claimedAt: ago(7.5 * HOUR) })],
        credits: [{ label: 'Cursor key "suzu"', expiresAt: '2026-10-29T12:00:00Z' }],
      }),
    )
    const idle = blocked.find((f) => f.kind === 'credits_idle')!
    expect(idle).toMatchObject({ severity: 'danger', title: 'Cursor credits idle for 7 h' })
    expect(idle.cause).toMatch(/^Cursor key "suzu" expires in 24 h\. What blocks the work: lane-\d: a run has held an agent space/)
  })

  it('puts danger first and counts the same for the badge', () => {
    expect(flags[0]!.severity).toBe('danger')
    const sum = flagSummary(flags)
    expect(sum.flags).toBe(flags.length)
    expect(sum.danger).toBe(flags.filter((f) => f.severity === 'danger').length)
    expect(sum.top).toBe(flags[0]!.title)
  })
})

describe('deriveWorkerFlags: each other failure', () => {
  it('an offline machine with lanes, and nothing about its stale telemetry', () => {
    const flags = deriveWorkerFlags(input({ hosts: [host({ state: 'slot-wait', checks: { gh: { result: 'signed_out', ageSec: 1, detail: '' } } }, { lastHeartbeatAt: ago(2 * HOUR) })], lanes: [lane(1, { state: 'slot-wait', stateSec: HOUR }, { queued: 2 })] }))
    expect(flags.map((f) => f.kind)).toEqual(['host_offline'])
    expect(flags[0]!.title).toBe('alienware is offline')
    expect(flags[0]!.cause).toContain('No heartbeat for 2 h')
    expect(flags[0]!.cause).toContain('2 queued reports wait')
    expect(flags[0]!.actions[0]).toMatchObject({ kind: 'copy_command', command: expect.stringContaining('systemctl --user status mushi-worker.service') })
  })

  it('gh signed out, another Cursor account, a lane that could not start, a memory wait', () => {
    const flags = deriveWorkerFlags(
      input({
        hosts: [
          host({
            state: 'mem-wait',
            stateSec: 20 * 60,
            waitWhy: '2 GB free, under the 5 GB floor',
            checks: { gh: { result: 'signed_out', ageSec: 30, detail: 'gh auth login' }, cursor: { result: 'other_account', ageSec: 60, detail: 'Logged in as o***@e***.com', account: 's***@g***.com' }, notReady: [{ lane: 'lane-1', problem: 'Its folder on this machine is not a git clone' }] },
          }),
        ],
        lanes: [lane(1, {})],
      }),
    )
    const by = Object.fromEntries(flags.map((f) => [f.kind, f]))
    expect(by.gh_signed_out).toMatchObject({ severity: 'danger', title: 'gh is not signed in on alienware' })
    expect(by.account_check).toMatchObject({ severity: 'danger', title: 'Cursor on alienware is signed in as another account' })
    expect(by.account_check!.cause).toContain('they must run as s***@g***.com')
    expect(by.machine_not_ready).toMatchObject({ severity: 'danger', laneName: 'lane-1' })
    expect(by.machine_waiting!.cause).toMatch(/^2 GB free, under the 5 GB floor\./)
  })

  it('two runs of a lane failed in the repo hooks within 24 h', () => {
    const flags = deriveWorkerFlags(
      input({
        hosts: [host({ state: 'idle' })],
        lanes: [lane(1, { state: 'idle' })],
        claims: [
          claim(1, { status: 'done', outcome: 'failed', failureKind: 'infra', finishedAt: ago(HOUR), detail: "failed (infra): git commit timed out after 25 min (the repo's commit hook did not finish); stopped it" }),
          claim(2, { laneId: L(1), status: 'done', outcome: 'failed', failureKind: 'code', finishedAt: ago(3 * HOUR), detail: 'failed (code): git push failed: husky - pre-push hook exited with code 1 (pnpm lint)', prUrl: null }),
          claim(3, { laneId: L(1), status: 'done', outcome: 'failed', finishedAt: ago(30 * HOUR), detail: 'git push failed: old' }),
        ],
      }),
    )
    const f = flags.find((x) => x.kind === 'hook_failures')!
    expect(f.title).toBe("lane-1: 2 runs failed in the repo's git hooks in 24 h")
    expect(f.actions.map((a) => a.kind)).toEqual(['pause_lane', 'open_report'])
  })

  it('a local mushi work run no worker claims (lane-v4 on 2026-10-28)', () => {
    const flags = deriveWorkerFlags(input({ localRuns: [{ fixId: 'f1', reportId: R(1), projectId: P1, createdAt: ago(4 * HOUR) }, { fixId: 'f2', reportId: R(2), projectId: P1, createdAt: ago(10 * 60) }] }))
    expect(flags.map((f) => f.id)).toEqual(['unmanaged_run:f1'])
    expect(flags[0]!.title).toBe('A local mushi work run has been running 4 h outside the worker')
  })

  it('a run stopped from the console while its commit hook hangs: flagged as still holding the space, never as a script', () => {
    const flags = deriveWorkerFlags(
      input({
        hosts: [host({ state: 'working', slots: [{ lane: 'lane-1', runId: C(1), kind: 'fix', ageSec: 4 * HOUR, stage: 'commit', stageSec: 3.9 * HOUR }] })],
        lanes: [lane(1, { state: 'working', inflight: [{ runId: C(1), kind: 'fix', reportId: R(1), ageSec: 4 * HOUR, stage: 'commit', stageSec: 3.9 * HOUR, model: null, log: ['commit: eslint .'] }] })],
        claims: [claim(1, { status: 'done', outcome: 'stopped', claimedAt: ago(4 * HOUR), finishedAt: ago(5 * 60) })],
        // The fix row stays running until the hook ends: it is the worker's run, not a script's.
        localRuns: [{ fixId: 'f1', reportId: R(1), projectId: P1, createdAt: ago(3.95 * HOUR) }],
      }),
    )
    expect(flags.map((f) => f.kind)).toEqual(['run_stuck'])
    expect(flags[0]).toMatchObject({ title: 'lane-1: a run that was stopped 5 min ago still holds an agent space', stage: 'commit', log: ['commit: eslint .'] })
    expect(flags[0]!.cause).toContain("ends only at git's own time limit (25 min)")
    expect(flags[0]!.actions.map((a) => a.kind)).toEqual(['open_report', 'copy_command'])
  })

  it('a script run on a report the worker held days ago is still a script run', () => {
    const flags = deriveWorkerFlags(
      input({ claims: [claim(1, { status: 'done', outcome: 'pr_opened', claimedAt: ago(3 * 86_400), finishedAt: ago(3 * 86_400 - 1800) })], localRuns: [{ fixId: 'f1', reportId: R(1), projectId: P1, createdAt: ago(2 * HOUR) }] }),
    )
    expect(flags.map((f) => f.kind)).toEqual(['unmanaged_run'])
  })

  it('an old daemon that sends no telemetry raises no false flag', () => {
    const flags = deriveWorkerFlags(input({ hosts: [host({ state: 'working', agents: 1 })], lanes: [lane(1, { state: 'working' }), lane(2, { state: 'slot-wait' })], claims: [claim(1, { claimedAt: ago(20 * 60) })] }))
    expect(flags).toEqual([])
    // A long claim still shows, and says how to see its stage.
    const long = deriveWorkerFlags(input({ hosts: [host({ state: 'working' })], lanes: [lane(1, { state: 'working' })], claims: [claim(1, { claimedAt: ago(2 * HOUR) })] }))
    expect(long.map((f) => f.kind)).toEqual(['run_stuck'])
    expect(long[0]!.cause).toContain('does not report the stage yet; update it')
  })

  it('a project sees its own lanes, its machines and the credits', () => {
    const flags = deriveWorkerFlags(
      input({
        hosts: [host({ state: 'idle', load1: 40, cpus: 16 })],
        lanes: [lane(1, { state: 'idle' }), lane(2, { state: 'idle' }, { projectId: P2 })],
        claims: [claim(2, { laneId: L(2), status: 'done', outcome: 'failed', finishedAt: ago(HOUR), detail: 'git commit failed: hook' }), claim(3, { laneId: L(2), status: 'done', outcome: 'failed', finishedAt: ago(HOUR), detail: 'git push failed: hook' })],
      }),
    )
    expect(flags.map((f) => f.kind).sort()).toEqual(['hook_failures', 'machine_busy'])
    expect(flagsForProject(flags, [lane(1, {}), lane(2, {}, { projectId: P2 })], P1).map((f) => f.kind)).toEqual(['machine_busy'])
    expect(flagsForProject(flags, [lane(1, {}), lane(2, {}, { projectId: P2 })], P2).map((f) => f.kind).sort()).toEqual(['hook_failures', 'machine_busy'])
  })
})

describe('durationText', () => {
  it('reads like a person', () => {
    expect(durationText(30)).toBe('under a minute')
    expect(durationText(12 * 60)).toBe('12 min')
    expect(durationText(4 * HOUR + 20 * 60)).toBe('4 h 20 min')
    expect(durationText(30 * HOUR)).toBe('30 h')
    expect(durationText(4 * 86_400)).toBe('4 d')
  })
})
