/**
 * FILE: packages/cli/src/worker/cursor-login.ts
 * PURPOSE: "Switch account" from the console (ADR 0048 amendment 2026-10-28):
 *          the machine's owner names a Cursor account on the Workers tab; the
 *          next heartbeat answer carries `cursorLogin: { requestId }` and
 *          `cursorAccount`. The daemon then:
 *
 *            1. takes nothing new and lets the runs in flight finish (at most
 *               30 minutes; after that it goes on and says so);
 *            2. signs the Cursor CLI out (`cursor-agent logout`);
 *            3. starts `cursor-agent login` with NO_OPEN_BROWSER=1, no shell,
 *               and reports the approve link it prints (link_ready);
 *            4. waits for the owner to approve it on cursor.com (at most
 *               15 minutes, then expired);
 *            5. checks which account it now is: the named one → signed_in,
 *               another → wrong_account (the lanes keep taking nothing),
 *               anything else → failed, with why.
 *
 *          No key or password reaches the machine: the person signs in on
 *          cursor.com. The link goes to the console only in this report (the
 *          server shows it to the machine's owner alone), never into a log
 *          line or the run telemetry.
 */

import { spawn } from 'node:child_process'
import { stripVTControlCharacters } from 'node:util'
import { cursorSignInState, runProc, type Proc } from '../commands/work.js'
import { cleanLine, maskEmail } from './telemetry.js'

export type CursorLoginState = 'waiting_for_runs' | 'link_ready' | 'signed_in' | 'wrong_account' | 'failed' | 'expired'

export interface CursorLoginReport {
  requestId: string
  state: CursorLoginState
  url?: string
  detail?: string
}

/** @internal Exported for tests only. A running `cursor-agent login`: its approve link once printed, and its end. */
export interface LoginProcess {
  url: Promise<string | null>
  done: Promise<{ code: number | null; error?: string }>
  kill: () => void
}

const RUNS_WAIT_MS = 30 * 60_000
const LINK_WAIT_MS = 15 * 60_000
/** How long `cursor-agent login` may take to print its link. */
const LINK_PRINT_MS = 60_000
const POLL_MS = 5_000
const FINAL: ReadonlySet<CursorLoginState> = new Set(['signed_in', 'wrong_account', 'failed', 'expired'])
const LINK_RE = /https:\/\/(?:www\.)?cursor\.com\/[A-Za-z0-9/._~%?&=:+-]+/

/** @internal Exported for tests only. The first Cursor sign-in link in some output, or null. */
export function findLoginLink(text: string): string | null {
  return stripVTControlCharacters(text).match(LINK_RE)?.[0] ?? null
}

/** `cursor-agent login` with NO_OPEN_BROWSER=1, no shell; the link is read from what it prints. */
function spawnCursorLogin(): LoginProcess {
  const child = spawn('cursor-agent', ['login'], { env: { ...process.env, NO_OPEN_BROWSER: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let seen = ''
  let resolveUrl: (u: string | null) => void = () => {}
  const url = new Promise<string | null>((r) => {
    resolveUrl = r
  })
  const onData = (chunk: Buffer) => {
    seen = (seen + chunk.toString('utf8')).slice(-8000)
    const link = findLoginLink(seen)
    if (link) resolveUrl(link)
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  const done = new Promise<{ code: number | null; error?: string }>((resolve) => {
    child.on('error', (e) => {
      resolveUrl(null)
      resolve({ code: null, error: e.message })
    })
    child.on('close', (code) => {
      resolveUrl(null)
      resolve({ code })
    })
  })
  return {
    url,
    done,
    kill: () => {
      try {
        child.kill('SIGTERM')
      } catch {
        // already gone
      }
    },
  }
}

export interface CursorLoginDeps {
  now: () => number
  sleep: (ms: number) => Promise<void>
  log: (line: string) => void
  /** Agents running on the machine now (fix runs, follow-ups, other claims). */
  activeRuns: () => number
  logout: () => Promise<Proc>
  login: () => LoginProcess
  status: () => Promise<Proc>
  /** The switch ended as signed_in: the readings now expect this account, and re-check at once. */
  onSignedIn: (account: string) => void
  runsWaitMs?: number
  linkWaitMs?: number
  linkPrintMs?: number
}

const realDeps = (): Pick<CursorLoginDeps, 'logout' | 'login' | 'status' | 'sleep'> => ({
  logout: () => runProc('cursor-agent', ['logout'], { timeoutMs: 60_000 }),
  login: spawnCursorLogin,
  status: () => runProc('cursor-agent', ['status'], { timeoutMs: 120_000 }),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
})

/** @internal Exported for tests only. The account `cursor-agent status` names, or null. */
export function signedInAccount(p: Proc): string | null {
  const out = stripVTControlCharacters(`${p.stdout}\n${p.stderr}`)
  return out.match(/\b(?:logged|signed)\s+in\s+as\s+([^\s]+@[^\s]+)/i)?.[1]?.replace(/[.,;)]+$/, '').toLowerCase() ?? null
}

const race = <T>(p: Promise<T>, ms: number, sleep: (ms: number) => Promise<void>): Promise<T | 'timeout'> =>
  Promise.race([p, sleep(ms).then(() => 'timeout' as const)])

/**
 * One switch at a time. `start` is called from each heartbeat answer that
 * carries a request; the same request id starts nothing new, a new one
 * replaces a finished switch (never one still running).
 */
export function createCursorLogin(partial: Omit<CursorLoginDeps, 'logout' | 'login' | 'status' | 'sleep'> & Partial<CursorLoginDeps>) {
  const d: CursorLoginDeps = { ...realDeps(), ...partial }
  const runsWaitMs = d.runsWaitMs ?? RUNS_WAIT_MS
  const linkWaitMs = d.linkWaitMs ?? LINK_WAIT_MS
  const linkPrintMs = d.linkPrintMs ?? LINK_PRINT_MS
  let cur: (CursorLoginReport & { account: string }) | null = null
  let running: Promise<void> | null = null
  /** The switch in flight: replaced by "Start again" from the console. */
  let token = 0
  let liveLogin: LoginProcess | null = null

  const set = (state: CursorLoginState, extra: { url?: string; detail?: string } = {}, mine = token) => {
    // A replaced switch reports nothing more.
    if (!cur || mine !== token) return
    cur = { requestId: cur.requestId, account: cur.account, state, ...(extra.url ? { url: extra.url } : {}), ...(extra.detail ? { detail: cleanLine(extra.detail) ?? undefined } : {}) }
  }

  async function run(account: string, mine: number): Promise<void> {
    const t0 = d.now()
    const stale = () => mine !== token
    let note = ''
    set('waiting_for_runs')
    d.log('worker: switching the Cursor account (asked from the console): taking nothing new until it is done.')
    while (d.activeRuns() > 0) {
      if (stale()) return
      if (d.now() - t0 >= runsWaitMs) {
        note = `${d.activeRuns()} run(s) were still going after ${Math.round(runsWaitMs / 60_000)} min; switched anyway. `
        d.log(`worker: ${note.trim()}`)
        break
      }
      await d.sleep(POLL_MS)
    }
    if (stale()) return
    const out = await d.logout()
    if (stale()) return
    if (out.code === null && /\bENOENT\b/.test(out.stderr)) return set('failed', { detail: `${note}The Cursor CLI (cursor-agent) is not installed on this machine.` })
    const login = d.login()
    liveLogin = login
    const url = await race(login.url, linkPrintMs, d.sleep)
    if (stale()) return login.kill()
    if (url === 'timeout' || !url) {
      login.kill()
      const end = await race(login.done, 1000, d.sleep)
      const why = end !== 'timeout' && end.error ? `cursor-agent login failed: ${end.error}` : 'cursor-agent login printed no sign-in link.'
      return set('failed', { detail: `${note}${why}` })
    }
    // The link goes to the console only (the owner's switch dialog), never to the log.
    set('link_ready', { url, detail: note ? note.trim() : undefined })
    d.log('worker: the Cursor sign-in link is on the console (Pipeline → Workers → Switch account).')
    const end = await race(login.done, linkWaitMs, d.sleep)
    if (stale()) return
    if (end === 'timeout') {
      login.kill()
      return set('expired', { detail: `Nobody approved the sign-in within ${Math.round(linkWaitMs / 60_000)} minutes. Start again from the console.` })
    }
    if (end.error || end.code !== 0) return set('failed', { detail: end.error ? `cursor-agent login failed: ${end.error}` : `cursor-agent login ended with exit code ${end.code}.` })
    const st = await d.status()
    if (stale()) return
    const state = cursorSignInState(st)
    const who = signedInAccount(st)
    if (state === 'signed_in' && who === account.toLowerCase()) {
      d.onSignedIn(account)
      d.log(`worker: signed in to Cursor as ${maskEmail(account)}; lanes take work again.`)
      return set('signed_in', { detail: `Signed in as ${maskEmail(account)}.` })
    }
    if (state === 'signed_in') {
      d.log(`worker: Cursor signed in as ${who ? maskEmail(who) : 'another account'}, not ${maskEmail(account)}; lanes take nothing.`)
      return set('wrong_account', { detail: `Signed in as ${who ? maskEmail(who) : 'another account'}, not ${maskEmail(account)}. Start again and approve with the right account.` })
    }
    const said = stripVTControlCharacters(`${st.stdout}\n${st.stderr}`).trim().split('\n')[0] ?? ''
    return set('failed', { detail: `After the sign-in, cursor-agent status did not confirm an account${said ? `: "${said.slice(0, 120)}"` : ''}.` })
  }

  return {
    /** A request from the heartbeat answer. Ignored while the same request runs or after it finished. */
    start(requestId: string, account: string): void {
      if (cur?.requestId === requestId) return
      // "Start again" from the console: the old sign-in stops at once, the new one starts.
      if (running && cur && !FINAL.has(cur.state)) {
        liveLogin?.kill()
        d.log('worker: the console started the account switch again; the earlier sign-in is stopped.')
      }
      const mine = ++token
      liveLogin = null
      cur = { requestId, account, state: 'waiting_for_runs' }
      const job = run(account, mine)
        .catch((e: unknown) => set('failed', { detail: e instanceof Error ? e.message : String(e) }, mine))
        .finally(() => {
          if (running === job) running = null
        })
      running = job
    },
    /** For the heartbeat's `status.cursorLogin`. */
    report(): CursorLoginReport | null {
      if (!cur) return null
      const { account: _account, ...r } = cur
      return r
    },
    /** True while a switch runs: the daemon takes nothing new. */
    busy(): boolean {
      return !!cur && !FINAL.has(cur.state)
    },
    /** For tests: the switch in flight. */
    settle: () => running ?? Promise.resolve(),
  }
}

export type CursorLogin = ReturnType<typeof createCursorLogin>
