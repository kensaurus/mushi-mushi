/**
 * FILE: packages/cli/src/worker/daemon-account.test.ts
 * PURPOSE: The daemon's side of "Switch account" (ADR 0048 amendment
 *          2026-10-28): the console's account overrides worker.json, a switch
 *          in progress takes nothing new, and the heartbeat says the daemon
 *          can switch and how the switch stands.
 */

import { describe, expect, it } from 'vitest'
import type { ApiResult } from '../cli-shared.js'
import { createDaemon, createHostReadings, type DaemonDeps } from './daemon.js'
import { parseHeartbeatAnswer, type WorkerConfig } from './protocol.js'
import type { CursorLogin } from './cursor-login.js'

const P1 = '67a6453c-375d-41d7-833a-b33471159442'
const LANE = '7000000a-0000-4000-8000-000000000000'
const RID = '5000000a-0000-4000-8000-000000000000'
const CFG = { paused: false, concurrency: 1, model: 'grok-4.7-xhigh-fast', mode: 'fix', stop_at: null, drain: false, prune_own: false }
const CONFIG: WorkerConfig = { version: 1, lanes: [{ name: 'glot', projectId: P1, repoDir: '/home/u/glot' }] }
const ok = (data: unknown): ApiResult<unknown> => ({ ok: true, data })
const answer = (extra: Record<string, unknown> = {}) => ok({ hostId: 'h', guards: { max_agents: 6, min_free_mem_gb: 5, gh_floor: 800 }, lanes: [{ id: LANE, name: 'glot', projectId: P1, config: CFG }], refused: [], renewed: [], lost: [], ...extra })

function fakeSwitch(busy: boolean) {
  const started: Array<[string, string]> = []
  const cl = {
    start: (id: string, account: string) => started.push([id, account]),
    report: () => ({ requestId: RID, state: busy ? ('link_ready' as const) : ('signed_in' as const), ...(busy ? { url: 'https://cursor.com/loginDeepControl?challenge=x' } : {}) }),
    busy: () => busy,
    settle: async () => {},
  } as unknown as CursorLogin
  return { cl, started }
}

function harness(o: { heartbeat: ApiResult<unknown>; extra?: Partial<DaemonDeps> }) {
  const calls: Array<{ path: string; body: unknown }> = []
  const logs: string[] = []
  const deps: DaemonDeps = {
    call: (async (path: string, init?: RequestInit) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (path === '/v1/worker/heartbeat') return o.heartbeat
      if (path.endsWith('/local-followups')) return ok({ fixes: [] })
      if (path === '/v1/worker/claim') return ok({ claim: null })
      return ok({})
    }) as DaemonDeps['call'],
    workOne: async () => ({ reportId: 'r', result: 'no_change', outcome: 'no change' }) as never,
    followUpOne: async () => ({ fixId: 'x', outcome: 'no change' }),
    readings: async () => ({ memAvailableGb: 12, ghRemaining: 4000, cursor: 'signed_in', checks: { cursor: { result: 'expected', at: 0, detail: 'Logged in' } } }),
    now: () => Date.parse('2026-10-28T12:00:00Z'),
    log: (l) => logs.push(l),
    host: { hostId: 'a'.repeat(64), hostname: 'alienware', platform: 'wsl2', version: '0.34.0' },
    ...o.extra,
  }
  return { daemon: createDaemon(CONFIG, deps), calls, logs }
}

describe('Switch account, on the daemon', () => {
  it('says it can switch, and sends how the switch stands (with the link, for the server to keep for the owner)', async () => {
    const sw = fakeSwitch(true)
    const { daemon, calls } = harness({ heartbeat: answer(), extra: { cursorLogin: sw.cl } })
    await daemon.tick()
    const hb = calls.find((c) => c.path === '/v1/worker/heartbeat')!.body as { host: { can: string[] }; status: { cursorLogin?: { state: string; url?: string } } }
    expect(hb.host.can).toEqual(['cursor_login'])
    expect(hb.status.cursorLogin).toMatchObject({ requestId: RID, state: 'link_ready' })
  })

  it('an older setup without the switch says it cannot', async () => {
    const { daemon, calls } = harness({ heartbeat: answer() })
    await daemon.tick()
    const hb = calls.find((c) => c.path === '/v1/worker/heartbeat')!.body as { host: { can: string[] }; status: Record<string, unknown> }
    expect(hb.host.can).toEqual([])
    expect(hb.status.cursorLogin).toBeUndefined()
  })

  it('takes nothing new while a switch runs', async () => {
    const sw = fakeSwitch(true)
    const { daemon, calls } = harness({ heartbeat: answer(), extra: { cursorLogin: sw.cl } })
    await daemon.tick()
    expect(calls.some((c) => c.path === '/v1/worker/claim')).toBe(false)
    expect(daemon.hostState).toBe('switching-account')
    expect(daemon.lanes[0]!.state).toBe('switching-account')
  })

  it("the console's account overrides worker.json, and a request starts the switch for it", async () => {
    const sw = fakeSwitch(false)
    const set: string[] = []
    const { daemon, calls, logs } = harness({
      heartbeat: answer({ cursorAccount: 'kensaurus@gmail.com', cursorLogin: { requestId: RID } }),
      extra: { cursorAccount: 'suzu.haruka1130@gmail.com', setCursorAccount: (a) => set.push(a), cursorLogin: sw.cl },
    })
    await daemon.tick()
    expect(set).toEqual(['kensaurus@gmail.com'])
    expect(sw.started).toEqual([[RID, 'kensaurus@gmail.com']])
    expect(logs.join('\n')).toMatch(/set the Cursor account to k\*\*\*@g\*\*\*\.com/)
    expect(logs.join('\n')).not.toContain('kensaurus@gmail.com')
    await daemon.tick()
    const hb = calls.filter((c) => c.path === '/v1/worker/heartbeat')[1]!.body as { status: { checks: { cursor: { account: string } } } }
    // Only the masked form of the new account leaves the machine.
    expect(hb.status.checks.cursor.account).toBe('k***@g***.com')
  })

  it('the readings expect the new account at once and check again', async () => {
    let checks = 0
    const r = createHostReadings({
      cursorAccount: 'suzu.haruka1130@gmail.com',
      now: () => 0,
      log: () => {},
      memGb: () => 20,
      run: async () => ({ code: 0, stdout: '4900', stderr: '', timedOut: false }),
      checkCursor: async () => {
        checks++
        return { state: 'signed_in', detail: 'Logged in', output: 'Logged in as kensaurus@gmail.com' }
      },
    })
    expect((await r.read()).cursor).toBe('signed_out') // signed in, but not as suzu
    r.setAccount('kensaurus@gmail.com')
    await r.read()
    await new Promise((res) => setTimeout(res, 0))
    expect(checks).toBe(2)
    expect((await r.read()).cursor).toBe('signed_in')
  })

  it('reads the new answer fields strictly', () => {
    const base = { hostId: 'h', guards: { max_agents: 6, min_free_mem_gb: 5, gh_floor: 800 }, lanes: [], refused: [], renewed: [], lost: [] }
    const good = parseHeartbeatAnswer({ ...base, cursorAccount: 'Kensaurus@Gmail.com', cursorLogin: { requestId: RID } })
    expect('answer' in good && good.answer.cursorAccount).toBe('kensaurus@gmail.com')
    expect('answer' in good && good.answer.cursorLogin).toEqual({ requestId: RID })
    const bad = parseHeartbeatAnswer({ ...base, cursorAccount: 'rm -rf /', cursorLogin: { requestId: 'nope' } })
    expect('answer' in bad && bad.answer.cursorAccount).toBeNull()
    expect('answer' in bad && bad.answer.cursorLogin).toBeNull()
    const old = parseHeartbeatAnswer(base)
    expect('answer' in old && old.answer.cursorLogin).toBeNull()
  })
})
