import { describe, expect, it } from 'vitest'
import type { ApiResult } from '../cli-shared.js'
import { assertWorkerKey, createDaemon, workerHostId, type DaemonDeps } from './daemon.js'
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

function harness(opts: { heartbeat?: Reply | ((n: number) => Reply | undefined); claim?: Reply[]; readings?: Partial<Awaited<ReturnType<DaemonDeps['readings']>>>; lane?: Record<string, unknown>; workOne?: DaemonDeps['workOne'] } = {}) {
  const calls: Array<{ path: string; body: unknown }> = []
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
    log: () => {},
    host: { hostId: 'a'.repeat(64), hostname: 'alienware', platform: 'wsl2', version: '0.31.0' },
  }
  return { daemon: createDaemon(CONFIG, deps), calls, runs }
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
