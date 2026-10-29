/**
 * FILE: packages/cli/src/worker/cursor-login.test.ts
 * PURPOSE: "Switch account" on the machine (ADR 0048 amendment 2026-10-28):
 *          waits for runs (and gives up waiting after the cap), signs out,
 *          captures the sign-in link, and ends signed_in / wrong_account /
 *          failed / expired as the Cursor CLI really answers. The link never
 *          reaches a log line.
 */

import { describe, expect, it } from 'vitest'
import type { Proc } from '../commands/work.js'
import { createCursorLogin, findLoginLink, signedInAccount, type LoginProcess } from './cursor-login.js'
import { cleanLine } from './telemetry.js'

const RID = '5000000a-0000-4000-8000-000000000000'
const RID2 = '5000000b-0000-4000-8000-000000000000'
const LINK = 'https://cursor.com/loginDeepControl?challenge=abcDEF123_-xyz&uuid=1f95da85-6fc6-4e9c-8795-0ef1b7913f90&mode=login&redirectTarget=cli'
const proc = (stdout: string, code: number | null = 0, stderr = ''): Proc => ({ code, stdout, stderr, timedOut: false })

/** A fake clock: sleep() advances it, so the 30- and 15-minute waits run instantly. */
function clock() {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => { t += ms } }
}

/** A login process whose link and end the test controls. */
function fakeLogin(o: { url?: string | null; code?: number | null; error?: string; never?: boolean } = {}) {
  let killed = false
  const p: LoginProcess = {
    url: Promise.resolve(o.url === undefined ? LINK : o.url),
    done: o.never ? new Promise(() => {}) : Promise.resolve({ code: o.code === undefined ? 0 : o.code, ...(o.error ? { error: o.error } : {}) }),
    kill: () => {
      killed = true
    },
  }
  return { p, killed: () => killed }
}

function setup(o: { runs?: () => number; login?: ReturnType<typeof fakeLogin>; status?: Proc; logout?: Proc; sleep?: (ms: number) => Promise<void> } = {}) {
  const c = clock()
  const logs: string[] = []
  const signedIn: string[] = []
  const login = o.login ?? fakeLogin()
  let logouts = 0
  const cl = createCursorLogin({
    now: c.now,
    sleep: o.sleep ?? c.sleep,
    log: (l) => logs.push(l),
    activeRuns: o.runs ?? (() => 0),
    logout: async () => {
      logouts++
      return o.logout ?? proc('Logged out')
    },
    login: () => login.p,
    status: async () => o.status ?? proc('✓ Logged in as kensaurus@gmail.com'),
    onSignedIn: (a) => signedIn.push(a),
  })
  return { cl, logs, signedIn, login, logouts: () => logouts }
}

describe('switching the Cursor account from the console', () => {
  it('signs out, shows the sign-in link, and ends signed_in when the CLI is the named account', async () => {
    const s = setup()
    s.cl.start(RID, 'kensaurus@gmail.com')
    expect(s.cl.busy()).toBe(true)
    await s.cl.settle()
    expect(s.logouts()).toBe(1)
    expect(s.cl.report()).toMatchObject({ requestId: RID, state: 'signed_in' })
    expect(s.cl.busy()).toBe(false)
    expect(s.signedIn).toEqual(['kensaurus@gmail.com'])
    // The link went to the report while it was the step; never to a log line.
    expect(s.logs.join('\n')).not.toContain('cursor.com/login')
    expect(JSON.stringify(s.cl.report())).not.toContain('kensaurus@gmail.com')
  })

  it('reports the link while the person has not approved yet', async () => {
    // Waits never end here, so the switch stays on the link step.
    const s = setup({ login: fakeLogin({ never: true }), sleep: () => new Promise(() => {}) })
    s.cl.start(RID, 'kensaurus@gmail.com')
    await new Promise((r) => setTimeout(r, 0))
    expect(s.cl.report()).toMatchObject({ state: 'link_ready', url: LINK })
    expect(s.cl.busy()).toBe(true)
  })

  it('waits for the runs in flight, taking nothing new, and goes on after the cap with a note', async () => {
    let runs = 2
    const s = setup({ runs: () => runs })
    s.cl.start(RID, 'kensaurus@gmail.com')
    await Promise.resolve()
    expect(s.cl.report()?.state).toBe('waiting_for_runs')
    expect(s.logouts()).toBe(0)
    runs = 2 // never finish: the 30-minute cap applies
    await s.cl.settle()
    expect(s.logouts()).toBe(1)
    expect(s.cl.report()?.state).toBe('signed_in')
    expect(s.logs.join('\n')).toMatch(/2 run\(s\) were still going after 30 min; switched anyway/)
  })

  it('does not sign out while a run is still going and the cap is not reached', async () => {
    let runs = 1
    // A real tick per poll and a clock that does not move: the cap is never reached.
    const s = setup({ runs: () => runs, sleep: () => new Promise((r) => setTimeout(r, 0)) })
    s.cl.start(RID, 'kensaurus@gmail.com')
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
    expect(s.cl.report()?.state).toBe('waiting_for_runs')
    expect(s.logouts()).toBe(0)
    runs = 0
    await s.cl.settle()
    expect(s.logouts()).toBe(1)
    expect(s.logs.join('\n')).not.toMatch(/switched anyway/)
  })

  it('ends wrong_account when the person approved as someone else; the lanes keep taking nothing', async () => {
    const s = setup({ status: proc('✓ Logged in as suzu.haruka1130@gmail.com') })
    s.cl.start(RID, 'kensaurus@gmail.com')
    await s.cl.settle()
    const r = s.cl.report()!
    expect(r.state).toBe('wrong_account')
    expect(r.detail).toMatch(/Signed in as s\*\*\*@g\*\*\*\.com, not k\*\*\*@g\*\*\*\.com/)
    expect(s.signedIn).toEqual([])
  })

  it('ends failed with why when cursor-agent login cannot start or exits non-zero', async () => {
    const boom = setup({ login: fakeLogin({ url: null, code: null, error: 'spawn cursor-agent ENOENT' }) })
    boom.cl.start(RID, 'kensaurus@gmail.com')
    await boom.cl.settle()
    expect(boom.cl.report()).toMatchObject({ state: 'failed' })
    expect(boom.cl.report()!.detail).toMatch(/spawn cursor-agent ENOENT/)

    const exit = setup({ login: fakeLogin({ code: 1 }) })
    exit.cl.start(RID, 'kensaurus@gmail.com')
    await exit.cl.settle()
    expect(exit.cl.report()!.detail).toMatch(/exit code 1/)

    const missing = setup({ logout: proc('', null, 'spawn cursor-agent ENOENT') })
    missing.cl.start(RID, 'kensaurus@gmail.com')
    await missing.cl.settle()
    expect(missing.cl.report()!.detail).toMatch(/not installed/)
  })

  it('ends failed when the login printed no link in time', async () => {
    const quiet = fakeLogin({ never: true })
    const s = setup({ login: { ...quiet, p: { ...quiet.p, url: new Promise(() => {}) } } })
    s.cl.start(RID, 'kensaurus@gmail.com')
    await s.cl.settle()
    expect(s.cl.report()).toMatchObject({ state: 'failed' })
    expect(s.cl.report()!.detail).toMatch(/printed no sign-in link/)
    expect(s.login.killed()).toBe(true)
  })

  it('expires after 15 minutes without an approval, and stops the login', async () => {
    const s = setup({ login: fakeLogin({ never: true }) })
    s.cl.start(RID, 'kensaurus@gmail.com')
    await s.cl.settle()
    expect(s.cl.report()).toMatchObject({ state: 'expired' })
    expect(s.cl.report()!.url).toBeUndefined()
    expect(s.login.killed()).toBe(true)
  })

  it('ends failed when the status after the sign-in names no account', async () => {
    const s = setup({ status: proc('Not logged in', 0) })
    s.cl.start(RID, 'kensaurus@gmail.com')
    await s.cl.settle()
    expect(s.cl.report()).toMatchObject({ state: 'failed' })
    expect(s.cl.report()!.detail).toMatch(/did not confirm an account: "Not logged in"/)
  })

  it('the same request again changes nothing; Start again stops the earlier sign-in and starts the new one', async () => {
    const first = fakeLogin({ never: true })
    let logins = 0
    const c = clock()
    const cl = createCursorLogin({
      now: c.now,
      sleep: (ms) => (ms >= 60_000 ? new Promise(() => {}) : c.sleep(ms)),
      log: () => {},
      activeRuns: () => 0,
      logout: async () => proc('Logged out'),
      login: () => (++logins === 1 ? first.p : fakeLogin().p),
      status: async () => proc('✓ Logged in as other@example.com'),
      onSignedIn: () => {},
    })
    cl.start(RID, 'kensaurus@gmail.com')
    await new Promise((r) => setTimeout(r, 0))
    expect(cl.report()).toMatchObject({ requestId: RID, state: 'link_ready' })
    cl.start(RID, 'kensaurus@gmail.com')
    expect(logins).toBe(1)
    cl.start(RID2, 'other@example.com')
    expect(first.killed()).toBe(true)
    expect(cl.report()).toMatchObject({ requestId: RID2, state: 'waiting_for_runs' })
    await cl.settle()
    // The replaced switch never reports again; the new one ends on its own result.
    expect(cl.report()).toMatchObject({ requestId: RID2, state: 'signed_in' })
    expect(logins).toBe(2)
  })

  it('finds the sign-in link and the account in what the CLI prints', () => {
    expect(findLoginLink(`\u001b[32mOpen a browser and navigate to this link: ${LINK}\u001b[0m`)).toBe(LINK)
    expect(findLoginLink('Waiting for browser authentication...')).toBeNull()
    expect(signedInAccount(proc('✓ Logged in as Kensaurus@Gmail.com.'))).toBe('kensaurus@gmail.com')
    expect(signedInAccount(proc('Not logged in'))).toBeNull()
  })

  it('never lets the link into a log line sent to the console', () => {
    expect(cleanLine(`Open a browser and navigate to this link: ${LINK}`)).toBe('Open a browser and navigate to this link: [sign-in link hidden]')
  })
})
