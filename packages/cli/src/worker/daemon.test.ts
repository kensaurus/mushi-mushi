import { describe, expect, it } from 'vitest'
import type { ApiResult } from '../cli-shared.js'
import { assertWorkerKey, createDaemon, createHostReadings, cursorStateFor, workerHostId, type DaemonDeps } from './daemon.js'
import type { WorkerConfig } from './protocol.js'
import type { HostIO } from '../runner/host.js'

const P1 = '67a6453c-375d-41d7-833a-b33471159442'
const LANE = '7000000a-0000-4000-8000-000000000000'
const CLAIM = '8000000a-0000-4000-8000-000000000000'
const R1 = '2000000a-0000-4000-8000-000000000000'
const CFG = { paused: false, concurrency: 1, model: 'grok-4.7-xhigh-fast', mode: 'fix', stop_at: null, drain: false, prune_own: false }
const CONFIG: WorkerConfig = { version: 1, lanes: [{ name: 'glot', projectId: P1, repoDir: '/home/u/glot' }] }

type Reply = ApiResult<unknown>
const ok = (data: unknown): Reply => ({ ok: true, data })

function harness(opts: { heartbeat?: Reply | ((n: number) => Reply | undefined); claim?: Reply[]; readings?: Partial<Awaited<ReturnType<DaemonDeps['readings']>>>; lane?: Record<string, unknown>; workOne?: DaemonDeps['workOne']; resolveConflict?: DaemonDeps['resolveConflict']; auditPass?: DaemonDeps['auditPass']; freshEyes?: DaemonDeps['freshEyes']; extra?: Partial<DaemonDeps> } = {}) {
  const calls: Array<{ path: string; body: unknown }> = []
  const logs: string[] = []
  const claims = [...(opts.claim ?? [ok({ claim: null, reason: 'Nothing to work on.' })])]
  const runs: Array<Parameters<DaemonDeps['workOne']>> = []
  const deps: DaemonDeps = {
    call: (async (path: string, init?: RequestInit) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (path === '/v1/worker/heartbeat') {
        const custom = typeof opts.heartbeat === 'function' ? opts.heartbeat(calls.filter((c) => c.path === path).length) : opts.heartbeat
        return custom ?? ok({ hostId: 'h', guards: { max_agents: 6, min_free_mem_gb: 5, gh_floor: 800 }, lanes: [{ id: LANE, name: 'glot', projectId: P1, config: { ...CFG, ...opts.lane } }], refused: [], renewed: [], lost: [] })
      }
      if (path.endsWith('/local-followups')) return ok({ fixes: [] })
      if (path === '/v1/worker/claim') return claims.shift() ?? ok({ claim: null })
      if (path.startsWith('/v1/worker/claims/')) return ok({ requeued: true })
      return { ok: false, error: { code: 'NOT_FOUND', message: path } }
    }) as DaemonDeps['call'],
    workOne:
      opts.workOne ??
      (async (...args) => {
        runs.push(args)
        return { reportId: R1, result: 'failed', failureKind: 'infra', outcome: 'failed (infra): git fetch: Permission denied', fixId: 'f1' }
      }),
    followUpOne: async () => ({ fixId: 'x', outcome: 'no change' }),
    readings: async () => ({ memAvailableGb: 12, ghRemaining: 4000, cursor: 'signed_in', ...opts.readings }),
    now: () => Date.parse('2026-10-27T12:00:00Z'),
    log: (l) => logs.push(l),
    host: { hostId: 'a'.repeat(64), hostname: 'alienware', platform: 'wsl2', version: '0.31.0' },
    repos: new Map([['glot', 'kensaurus/glot.it']]),
    resolveConflict: opts.resolveConflict ?? (async () => { throw new Error('unexpected conflict run') }),
    auditPass: opts.auditPass ?? (async () => { throw new Error('unexpected audit run') }),
    ...(opts.freshEyes ? { freshEyes: opts.freshEyes } : {}),
    ...opts.extra,
  }
  return { daemon: createDaemon(CONFIG, deps), calls, runs, logs }
}

const claimReply = ok({
  claim: {
    id: CLAIM,
    laneId: LANE,
    model: 'claude-opus-5-5-medium',
    report: { id: R1, summary: 'Checkout total wrong', fix_attempts: [] },
    earlier: [{ createdAt: '2026-10-20', prUrl: null, verdict: null, summary: null, findings: [], note: 'timed out' }],
  },
})

describe('mushi work --daemon', () => {
  it('registers its lanes with a heartbeat that carries no path and no key', async () => {
    const { daemon, calls } = harness()
    await daemon.tick()
    const hb = calls.find((c) => c.path === '/v1/worker/heartbeat')!.body as Record<string, unknown>
    expect(JSON.stringify(hb)).not.toContain('/home/u/glot')
    expect(JSON.stringify(hb)).not.toMatch(/mushi_[A-Za-z0-9]/)
    expect((hb.lanes as Array<{ name: string; projectId: string }>)[0]).toMatchObject({ name: 'glot', projectId: P1 })
  })

  it('claims nothing while memory is under the floor', async () => {
    const { daemon, calls } = harness({ readings: { memAvailableGb: 2 }, claim: [claimReply] })
    await daemon.tick()
    expect(calls.some((c) => c.path === '/v1/worker/claim')).toBe(false)
    expect(daemon.hostState).toBe('mem-wait')
  })

  it('claims nothing on a paused lane or past its stop date', async () => {
    for (const lane of [{ paused: true }, { stop_at: '2026-10-27T11:00:00Z' }]) {
      const { daemon, calls } = harness({ lane, claim: [claimReply] })
      await daemon.tick()
      expect(calls.some((c) => c.path === '/v1/worker/claim')).toBe(false)
    }
  })

  it('runs a claim in its clone with the server model and earlier attempts, and reports the outcome with infra/code', async () => {
    const { daemon, calls, runs } = harness({ claim: [claimReply] })
    await daemon.tick()
    await daemon.settle()
    expect(runs).toHaveLength(1)
    const [, detail, opts] = runs[0]!
    expect(detail.id).toBe(R1)
    expect(opts).toMatchObject({ repoDir: '/home/u/glot', agent: 'cursor', model: 'claude-opus-5-5-medium' })
    expect(opts.earlier).toHaveLength(1)
    const done = calls.find((c) => c.path === `/v1/worker/claims/${CLAIM}/done`)!
    expect(done.body).toMatchObject({ outcome: 'failed', failureKind: 'infra', fixId: 'f1' })
  })

  it('renews the leases it holds and stops an agent whose lease was lost', async () => {
    let release: () => void = () => {}
    let aborted = false
    const lost = ok({ hostId: 'h', guards: { max_agents: 6, min_free_mem_gb: 5, gh_floor: 800 }, lanes: [{ id: LANE, name: 'glot', projectId: P1, config: CFG }], refused: [], renewed: [], lost: [CLAIM] })
    const { daemon, calls } = harness({
      heartbeat: (n) => (n === 3 ? lost : undefined),
      claim: [claimReply],
      workOne: async (_api, _d, o) => {
        o.signal?.addEventListener('abort', () => (aborted = true))
        await new Promise<void>((r) => (release = r))
        return { reportId: R1, result: 'stopped', outcome: 'stopped by lost lease' }
      },
    })
    await daemon.tick()
    await daemon.tick()
    const second = calls.filter((c) => c.path === '/v1/worker/heartbeat')[1]!.body as { claims: string[] }
    expect(second.claims).toEqual([CLAIM])
    expect(aborted).toBe(false)
    await daemon.tick()
    expect(aborted).toBe(true)
    release()
    await daemon.settle()
  })

  it('stops for good when the server refuses its key (revoked in the console)', async () => {
    const { daemon, calls } = harness({ heartbeat: { ok: false, httpStatus: 403, error: { code: 'HOST_REVOKED', message: 'revoked' } }, claim: [claimReply] })
    await daemon.tick()
    expect(daemon.stopped).toMatch(/HOST_REVOKED/)
    expect(calls.some((c) => c.path === '/v1/worker/claim')).toBe(false)
  })

  it('backs off after a network error instead of stopping', async () => {
    const { daemon } = harness({ heartbeat: { ok: false, error: { code: 'NETWORK_ERROR', message: 'ECONNRESET' } } })
    await daemon.tick()
    expect(daemon.stopped).toBeNull()
    expect(daemon.hostState).toBe('backoff')
  })
})

describe('lane modes (P3)', () => {
  const Q = '9000000a-0000-4000-8000-000000000000'
  const conflictReply = ok({
    claim: { id: CLAIM, kind: 'conflict', laneId: LANE, model: 'grok-4.7-xhigh-fast', conflict: { queueId: Q, repo: 'kensaurus/glot.it', prNumber: 7, headRef: 'cursor/mushi-fix-7', headSha: 'c'.repeat(40), prUrl: null } },
  })

  it("tells the server which repository each lane's clone is, never its path", async () => {
    const { daemon, calls } = harness()
    await daemon.tick()
    const hb = calls.find((c) => c.path === '/v1/worker/heartbeat')!.body as { lanes: Array<{ repo?: string }> }
    expect(hb.lanes[0]!.repo).toBe('kensaurus/glot.it')
  })

  it('a conflicts lane runs the conflict in its clone and reports the pushed merge; it takes no follow-ups', async () => {
    const seen: unknown[] = []
    const { daemon, calls } = harness({
      lane: { mode: 'conflicts' },
      claim: [conflictReply],
      resolveConflict: async (t, o) => (seen.push([t.prNumber, o.repoDir, o.model]), { result: 'pushed', headAfter: 'd'.repeat(40), detail: 'merged main' }),
    })
    await daemon.tick()
    await daemon.settle()
    expect(seen).toEqual([[7, '/home/u/glot', 'grok-4.7-xhigh-fast']])
    expect(calls.some((c) => c.path.endsWith('/local-followups'))).toBe(false)
    const done = calls.find((c) => c.path === `/v1/worker/claims/${CLAIM}/done`)!
    expect(done.body).toEqual({ outcome: 'pushed', failureKind: null, detail: 'merged main', headAfter: 'd'.repeat(40) })
  })

  it('an audit lane passes the veto model and reports what it filed', async () => {
    const seen: unknown[] = []
    const { daemon, calls } = harness({
      lane: { mode: 'audit' },
      claim: [ok({ claim: { id: CLAIM, kind: 'audit', laneId: LANE, model: 'grok-4.7-xhigh-fast', audit: { reviewModel: 'claude-opus-5-5-medium', findingsLeft: 12 } } })],
      auditPass: async (_api, id, o) => (seen.push([id, o.laneName, o.reviewModel]), { result: 'filed', detail: 'src/a.tsx: 1 filed' }),
    })
    await daemon.tick()
    await daemon.settle()
    expect(seen).toEqual([[CLAIM, 'glot', 'claude-opus-5-5-medium']])
    expect(calls.find((c) => c.path === `/v1/worker/claims/${CLAIM}/done`)!.body).toMatchObject({ outcome: 'filed', failureKind: null })
  })

  it('gives back a claim of the wrong kind, or one it cannot read, and runs nothing', async () => {
    const unreadable = ok({ claim: { id: CLAIM, kind: 'conflict', model: null, conflict: { queueId: Q, repo: 'kensaurus/glot.it', prNumber: 7, headRef: '--upload-pack=sh', headSha: 'c'.repeat(40) } } })
    for (const reply of [conflictReply, unreadable]) {
      const { daemon, calls, runs } = harness({ claim: [reply] })
      await daemon.tick()
      await daemon.settle()
      expect(runs).toHaveLength(0)
      expect(calls.find((c) => c.path === `/v1/worker/claims/${CLAIM}/done`)!.body).toMatchObject({ outcome: 'skipped' })
    }
  })

  it('a skill lane runs its claim like a fix', async () => {
    const { daemon, runs } = harness({ lane: { mode: 'skill' }, claim: [claimReply] })
    await daemon.tick()
    await daemon.settle()
    expect(runs).toHaveLength(1)
  })
})

describe('the worker key and host id', () => {
  it('refuses the CLI key and anything that is not a Mushi key', () => {
    expect(() => assertWorkerKey('mushi_cli1234567890', 'mushi_cli1234567890')).toThrow(/CLI key/)
    expect(() => assertWorkerKey('sk-ant-123', undefined)).toThrow(/Mushi key/)
    expect(assertWorkerKey('mushi_worker123456', 'mushi_cli1234567890')).toBe('mushi_worker123456')
  })

  it('hashes the machine id, and MachineGuid on Windows', () => {
    const io = (platform: NodeJS.Platform, files: Record<string, string>, exec: string | null = null) =>
      ({ platform, readFile: (p: string) => files[p] ?? null, exec: () => exec }) as unknown as HostIO
    const linux = workerHostId(io('linux', { '/etc/machine-id': 'abc123\n' }))
    expect(linux).toMatch(/^[0-9a-f]{64}$/)
    expect(linux).not.toContain('abc123')
    const win = workerHostId(io('win32', {}, '\r\n    MachineGuid    REG_SZ    4c4c4544-0042-3510-8051-b4c04f4d3332\r\n'))
    expect(win).toMatch(/^[0-9a-f]{64}$/)
    expect(workerHostId(io('win32', {}, null))).toBeNull()
  })
})

describe('the Cursor account a worker may spend', () => {
  const out = 'Logged in as suzu.haruka1130@gmail.com'
  it('counts a sign-in as another account as signed out, and leaves unclear answers unclear', () => {
    expect(cursorStateFor({ state: 'signed_in', output: out }, 'suzu.haruka1130@gmail.com')).toBe('signed_in')
    expect(cursorStateFor({ state: 'signed_in', output: out }, 'someone@else.com')).toBe('signed_out')
    expect(cursorStateFor({ state: 'unknown', output: '' }, 'someone@else.com')).toBe('unknown')
    expect(cursorStateFor({ state: 'signed_in', output: out }, undefined)).toBe('signed_in')
  })
})

describe('a first-time user test the console queued (ADR 0053 amendment)', () => {
  const PASSWORD = 'test-fixture-not-a-real-password'
  const testClaim = ok({
    claim: {
      id: CLAIM,
      kind: 'fresh_eyes',
      laneId: LANE,
      model: null,
      freshEyes: { runId: '20261028-090000-ab12', url: 'https://glot.it/', goal: 'sign up', sessions: 1, successText: null, dryRun: false, accounts: [{ email: 'fresh-eyes-abc@synthetic.kensaur.us', password: PASSWORD, name: 'Fresh Eyes' }] },
    },
  })

  it('says in its heartbeat that it runs these tests only when it can', async () => {
    const without = harness()
    await without.daemon.tick()
    expect((without.calls[0]!.body as { host: { takes: string[] } }).host.takes).toEqual([])
    const able = harness({ freshEyes: async () => ({ result: 'ran', detail: 'ok' }) })
    await able.daemon.tick()
    expect((able.calls[0]!.body as { host: { takes: string[] } }).host.takes).toEqual(['fresh_eyes'])
  })

  it('a fix lane runs it before its own work, reports ran, and never logs the test account', async () => {
    const seen: unknown[] = []
    const { daemon, calls, logs, runs } = harness({
      claim: [testClaim],
      freshEyes: async (t, o) => {
        seen.push({ t, projectId: o.projectId })
        return { result: 'ran', detail: '1 of 1 session(s) reached the goal' }
      },
    })
    await daemon.tick()
    await daemon.settle()
    expect(runs).toHaveLength(0)
    expect(seen).toEqual([{ t: expect.objectContaining({ runId: '20261028-090000-ab12', accounts: [expect.objectContaining({ password: PASSWORD })] }), projectId: P1 }])
    expect(calls.find((c) => c.path === `/v1/worker/claims/${CLAIM}/done`)!.body).toMatchObject({ outcome: 'ran', failureKind: null })
    expect(logs.join(' / ')).not.toContain(PASSWORD)
    expect(logs.join(' / ')).not.toContain('synthetic.kensaur.us')
    expect(logs.join(' / ')).toContain('first-time user test 20261028-090000-ab12')
  })

  it('gives a test back when this CLI cannot run it', async () => {
    const { daemon, calls } = harness({ claim: [testClaim] })
    await daemon.tick()
    expect(calls.find((c) => c.path === `/v1/worker/claims/${CLAIM}/done`)!.body).toMatchObject({ outcome: 'skipped' })
  })

  it('asks for work at once when the heartbeat says a test waits for its lane', async () => {
    const wake = ok({ hostId: 'h', guards: { max_agents: 6, min_free_mem_gb: 5, gh_floor: 800 }, lanes: [{ id: LANE, name: 'glot', projectId: P1, config: CFG }], refused: [], renewed: [], lost: [], wake: [LANE] })
    const { daemon, calls } = harness({ heartbeat: (n) => (n === 2 ? wake : undefined), freshEyes: async () => ({ result: 'ran', detail: 'ok' }) })
    await daemon.tick()
    expect(calls.filter((c) => c.path === '/v1/worker/claim')).toHaveLength(1)
    // Idle: the lane would wait 15 minutes; the wake makes it ask on the next beat.
    await daemon.tick()
    expect(calls.filter((c) => c.path === '/v1/worker/claim')).toHaveLength(2)
    await daemon.tick()
    expect(calls.filter((c) => c.path === '/v1/worker/claim')).toHaveLength(2)
  })
})

describe('what the console sees of a run (ADR 0048 amendment 2026-10-28)', () => {
  const T0 = Date.parse('2026-10-28T08:00:00Z')

  it('sends the stage, its age, the model, cleaned log lines and which lane holds the agent space', async () => {
    let clock = T0
    let release: () => void = () => {}
    const { daemon, calls } = harness({
      claim: [claimReply],
      extra: { now: () => clock },
      workOne: async (_api, _d, o) => {
        o.log('  agent: cursor-agent in /home/mushi-agent/.cache/mushi/work/glot/2000000a (up to 30 min)')
        o.onStage?.('agent')
        clock += 20 * 60_000
        o.onStage?.('commit')
        o.log('  git push https://x-access-token:ghs_abcdefghijklmnopqrstuvwxyz0123@github.com/kensaurus/glot.it.git as suzu.haruka1130@gmail.com')
        o.log('  12 | const secret = process.env.KEY')
        await new Promise<void>((r) => (release = r))
        return { reportId: R1, result: 'failed', failureKind: 'infra', outcome: 'failed (infra): git commit timed out after 25 min' }
      },
    })
    await daemon.tick()
    clock += 4 * 3600_000
    await daemon.tick()
    const hb = calls.filter((c) => c.path === '/v1/worker/heartbeat')[1]!.body as { status: { slots: unknown[] }; lanes: Array<{ status: { inflight: Array<Record<string, unknown>> } }> }
    const [run] = hb.lanes[0]!.status.inflight
    expect(run).toMatchObject({ runId: CLAIM, kind: 'fix', reportId: R1, stage: 'commit', stageSec: 4 * 3600, ageSec: 4 * 3600 + 20 * 60, model: 'claude-opus-5-5-medium' })
    expect(hb.status.slots).toEqual([{ lane: 'glot', runId: CLAIM, kind: 'fix', ageSec: 4 * 3600 + 20 * 60, stage: 'commit', stageSec: 4 * 3600 }])
    const log = (run!.log as string[]).join(' / ')
    expect(log).toContain('…/2000000a')
    expect(log).not.toContain('/home/mushi-agent')
    expect(log).not.toContain('ghs_')
    expect(log).not.toContain('suzu.haruka1130')
    expect(log).toContain('s***@g***.com')
    expect(log).not.toContain('process.env.KEY')
    release()
    await daemon.settle()
    clock += 60_000
    await daemon.tick()
    const after = calls.filter((c) => c.path === '/v1/worker/heartbeat')[2]!.body as { status: { slots: unknown[] }; lanes: Array<{ status: { inflight: unknown[] } }> }
    expect(after.lanes[0]!.status.inflight).toEqual([])
    expect(after.status.slots).toEqual([])
  })

  it('says how long a lane has waited, and why the machine waits', async () => {
    let clock = T0
    const { daemon, calls } = harness({ extra: { now: () => clock }, readings: { memAvailableGb: 2 } })
    await daemon.tick()
    clock += 30 * 60_000
    await daemon.tick()
    clock += 30 * 60_000
    await daemon.tick()
    const hb = calls.filter((c) => c.path === '/v1/worker/heartbeat')[2]!.body as { status: Record<string, unknown>; lanes: Array<{ status: Record<string, unknown> }> }
    expect(hb.lanes[0]!.status).toMatchObject({ state: 'mem-wait', stateSec: 30 * 60 })
    expect(hb.status).toMatchObject({ state: 'mem-wait', waitWhy: '2 GB free, under the 5 GB floor' })
  })

  it('re-checks the account when the console asks, and keeps a lane whose clone is broken out of work', async () => {
    let rechecks = 0
    const answer = ok({ hostId: 'h', guards: { max_agents: 6, min_free_mem_gb: 5, gh_floor: 800 }, lanes: [{ id: LANE, name: 'glot', projectId: P1, config: CFG }], refused: [], renewed: [], lost: [], recheckAccount: true })
    const { daemon, calls } = harness({
      heartbeat: answer,
      claim: [claimReply],
      extra: { recheck: () => rechecks++, notReady: new Map([['glot', 'Its folder on /home/u/glot is not a git clone']]), cursorAccount: 'suzu.haruka1130@gmail.com' },
      readings: { checks: { cursor: { result: 'timed_out', at: Date.parse('2026-10-27T11:50:00Z'), detail: 'timed out after 90 s' } } },
    })
    await daemon.tick()
    expect(rechecks).toBe(1)
    expect(calls.some((c) => c.path === '/v1/worker/claim')).toBe(false)
    expect(daemon.lanes[0]!.state).toBe('not-ready')
    await daemon.tick()
    const hb = calls.filter((c) => c.path === '/v1/worker/heartbeat')[1]!.body as { status: { checks: Record<string, unknown> } }
    expect(hb.status.checks).toEqual({
      cursor: { result: 'timed_out', ageSec: 600, detail: 'timed out after 90 s', account: 's***@g***.com' },
      notReady: [{ lane: 'glot', problem: 'Its folder on …/glot is not a git clone' }],
    })
  })
})

describe('the machine readings behind the gate', () => {
  const proc = (code: number | null, stdout = '', stderr = '', timedOut = false) => ({ code, stdout, stderr, timedOut })

  it('reports a timed-out account check as timed out, and runs later checks in the background', async () => {
    let clock = 0
    let checks = 0
    let finish: (v: { state: 'unknown'; detail: string; output: string }) => void = () => {}
    const r = createHostReadings({
      cursorAccount: 'suzu.haruka1130@gmail.com',
      now: () => clock,
      log: () => {},
      memGb: () => 20,
      load: () => 37.2,
      cpus: () => 16,
      run: async () => proc(0, '4900'),
      checkCursor: async () => {
        checks++
        if (checks === 1) return { state: 'unknown', detail: 'timed out after 90 s', output: '' }
        return new Promise((res) => (finish = res))
      },
    })
    const first = await r.read()
    expect(first.checks?.cursor).toMatchObject({ result: 'timed_out', detail: 'timed out after 90 s' })
    expect(first.checks?.gh).toMatchObject({ result: 'signed_in' })
    expect(first).toMatchObject({ load1: 37.2, cpus: 16, ghRemaining: 4900, cursor: 'unknown' })
    r.recheck()
    clock += 1000
    // The second check hangs; the reading still answers at once.
    const second = await r.read()
    expect(checks).toBe(2)
    expect(second.checks?.cursor?.result).toBe('timed_out')
    finish({ state: 'unknown', detail: 'still nothing', output: '' })
  })

  it('reads a gh call that asks for a login as signed out, which the gate waits on', async () => {
    const r = createHostReadings({
      now: () => 0,
      log: () => {},
      memGb: () => 20,
      run: async () => proc(4, '', 'To get started with GitHub CLI, please run:  gh auth login'),
      checkCursor: async () => ({ state: 'signed_in', detail: 'Logged in', output: 'Logged in as a@b.co' }),
    })
    const got = await r.read()
    expect(got.gh).toBe('signed_out')
    expect(got.checks?.cursor?.result).toBe('expected')
  })
})
