// SPDX-License-Identifier: MIT
/**
 * Runs only with MUSHI_UX_BROWSER_TESTS=1 (launches Chromium).
 *
 * A fresh-eyes run (ADR 0053) against a tiny local app with a landing page, a
 * sign-in form, a dashboard and a report page, driven by a scripted "model":
 *
 * - with a synthetic identity it signs in (the real values reach the app, the
 *   placeholders reach the record), creates an app with a same-origin write,
 *   reaches the goal and gets a time to first value;
 * - a write to another origin, a third-party sign-in and a payment page are
 *   refused, whatever the model asks;
 * - with no account (dry run) nothing is written, the run stops at the
 *   sign-in wall, and the wall is a confirmed finding;
 * - an opinion two sessions share is filed once, one session's is not.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runFreshEyes, type FreshAsk } from './fresh-eyes.js'

const IDENTITY = { email: 'fe-test@synthetic.example', password: 'TEST-FIXTURE-NOT-A-REAL-SECRET' }

interface Fixture {
  url: string
  writes: Array<{ method: string; path: string; body: string }>
  close(): Promise<void>
}

const body = (req: IncomingMessage) => new Promise<string>((r) => {
  let b = ''
  req.on('data', (c) => (b += c))
  req.on('end', () => r(b))
})

async function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; url: string }> {
  const server = createServer(handler)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}

const html = (title: string, main: string, script = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main>${main}</main>${script ? `<script>${script}</script>` : ''}</body></html>`

async function startFixture(otherOrigin: string): Promise<Fixture> {
  const writes: Fixture['writes'] = []
  const { server, url } = await listen(async (req, res) => {
    const method = req.method ?? 'GET'
    const path = (req.url ?? '/').split('?')[0]!
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) writes.push({ method, path, body: await body(req) })
    const send = (status: number, page: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers })
      res.end(page)
    }
    if (path === '/') {
      return send(200, html('Acme', `<h1>Acme explains your bugs</h1><p>Sign in to see why your app broke, in plain words, with a fix ready for your editor. It takes about a minute.</p><a href="/login">Get started</a> <a href="/pricing">Pricing</a> <button id="copy">Copy the install line</button> <label>Your name <input name="who"></label> <button id="join">Join the waitlist</button> <form method="post" action="/api/newsletter"><label>Your city <input name="city"></label> <button type="submit">Keep me posted</button></form>`, "document.getElementById('copy').onclick = () => navigator.clipboard.writeText('npm i acme'); document.getElementById('join').onclick = () => fetch('/api/waitlist', { method: 'POST', body: 'x' }).catch(() => {})"))
    }
    if (path === '/pricing') return send(200, html('Pricing', `<h1>Pricing</h1><p>Free for one app, more when you grow.</p><a href="https://checkout.stripe.com/c/pay/cs_test_1">Upgrade</a> <a href="https://checkout.stripe.com/c/pay/cs_test_2">See plans</a> <a href="/">Home</a>`))
    if (path === '/login' && method === 'GET') {
      return send(200, html('Sign in', `<h1>Sign in to Acme</h1><a href="https://github.com/login/oauth/authorize?client_id=1">Continue with GitHub</a> <a href="https://github.com/login/oauth/authorize?client_id=2">More ways in</a><form method="post" action="/api/session"><label>Email <input type="email" name="email"></label><label>Password <input type="password" name="password"></label><button type="submit">Sign in</button></form>`))
    }
    if (path === '/api/session' && method === 'POST') {
      const w = writes.at(-1)!
      const ok = w.body.includes(encodeURIComponent(IDENTITY.email)) && w.body.includes(encodeURIComponent(IDENTITY.password))
      return send(303, '', ok ? { location: '/dashboard', 'set-cookie': 'sid=1; Path=/' } : { location: '/login' })
    }
    if (path === '/dashboard') {
      return send(200, html('Dashboard', `<h1>Welcome to your dashboard</h1><p>Create your first app to get a report and its diagnosis.</p><button id="create">Create app</button> <button id="del" onclick="fetch('/api/projects/1', { method: 'DELETE' })">Delete project</button> <form action="/api/projects/1/delete" method="post"><label>Type the project name <input name="confirm"></label> <button type="submit">Delete project</button></form> <div role="dialog" aria-label="Delete project"><button onclick="fetch('/api/projects/1', { method: 'DELETE' })">Confirm</button></div> <div role="alertdialog" aria-labelledby="dels-title t2"><h2 id="dels-title">Delete project</h2><p id="t2">This cannot be undone.</p><button id="yes" onclick="fetch('/api/projects/1', { method: 'DELETE' })">Yes, go ahead</button></div> <button onclick="document.getElementById('yes').focus()">Review the deletion</button>`, `fetch('${otherOrigin}/collect', { method: 'POST', body: 'x' }).catch(() => {})
document.getElementById('create').onclick = async () => { await fetch('/api/apps', { method: 'POST', body: '{}' }); location.href = '/reports/1' }`))
    }
    if (path === '/api/apps' && method === 'POST') {
      res.writeHead(201, { 'content-type': 'application/json' })
      return res.end('{"ok":true}')
    }
    if (path === '/reports/1') return send(200, html('Report', `<h1>Save does nothing</h1><h2>Why it broke</h2><p>The Save handler never awaited the request, so the page moved on before it finished.</p><a href="/dashboard">Back to dashboard</a>`))
    send(404, 'not found')
  })
  return { url, writes, close: () => new Promise<void>((r) => server.close(() => r())) }
}

/** A scripted visitor: reads the snapshot and the steps so far, like the model would. */
function scriptedAsk(feelingOnLanding: (session: number) => boolean, prompts: string[] = []): FreshAsk {
  return async (prompt, dir) => {
    prompts.push(prompt)
    const snap = prompt.split('<snapshot>')[1]?.split('</snapshot>')[0] ?? ''
    const did = prompt.split('<snapshot>')[0] ?? ''
    const session = Number(/[\\/]s(\d+)-\d+$/.exec(dir)?.[1] ?? '1')
    const noAccount = prompt.includes('You have no account yet')
    const j = (o: object) => ({ text: JSON.stringify(o) })
    if (snap.includes('Why it broke')) return j({ action: 'done' })
    if (snap.includes('Create app')) {
      // "project" resolves to "Delete project": the resolved label is checked, not only the words the model used.
      if (!did.includes('Click the button "project"')) return j({ action: 'click', role: 'button', name: 'project' })
      // Enter in a field submits its form through "Delete project": checked on the form's submit buttons.
      if (!did.includes('Type the project name')) return j({ action: 'fill', role: 'textbox', name: 'Type the project name', value: 'acme' })
      if (!did.includes('Press Enter')) return j({ action: 'press', key: 'Enter' })
      // A neutral button inside a dialog labelled 'Delete project' acts for the dialog.
      if (!did.includes('Click the button "Confirm"')) return j({ action: 'click', role: 'button', name: 'Confirm' })
      // Same, with the dialog named through aria-labelledby (an id with an "s", and two ids).
      if (!did.includes('Yes, go ahead')) return j({ action: 'click', role: 'button', name: 'Yes, go ahead' })
      // The keyboard twin: a harmless button moves focus onto it, then Space.
      if (!did.includes('Review the deletion')) return j({ action: 'click', role: 'button', name: 'Review the deletion' })
      if (!did.includes('Press Space')) return j({ action: 'press', key: 'Space' })
      return j({ action: 'click', role: 'button', name: 'Create app' })
    }
    if (snap.includes('Sign in to Acme')) {
      if (noAccount) return j({ action: 'stuck', reason: 'needs an account' })
      if (!did.includes('Continue with GitHub')) return j({ action: 'click', role: 'link', name: 'Continue with GitHub' })
      if (!did.includes('More ways in')) return j({ action: 'click', role: 'link', name: 'More ways in' })
      if (!did.includes('{{email}}')) return j({ action: 'fill', role: 'textbox', name: 'Email', value: '{{email}}' })
      if (!did.includes('{{password}}')) return j({ action: 'fill', role: 'textbox', name: 'Password', value: '{{password}}' })
      return j({ action: 'click', role: 'button', name: 'Sign in' })
    }
    if (snap.includes('Pricing') && snap.includes('Upgrade')) {
      if (!did.includes('Upgrade')) return j({ action: 'click', role: 'link', name: 'Upgrade' })
      if (!did.includes('See plans')) return j({ action: 'click', role: 'link', name: 'See plans' })
      return j({ action: 'click', role: 'link', name: 'Home' })
    }
    if (snap.includes('Acme explains your bugs')) {
      const feeling = feelingOnLanding(session) ? { feeling: 'unclear_copy', why: 'What is a diagnosis?' } : {}
      if (!did.includes('Copy the install line')) return j({ action: 'click', role: 'button', name: 'Copy the install line', ...feeling })
      // With no account, try the one write that needs none: it must not reach the app.
      if (noAccount && !did.includes('Your name')) return j({ action: 'fill', role: 'textbox', name: 'Your name', value: 'Sam' })
      if (noAccount && !did.includes('Join the waitlist')) return j({ action: 'click', role: 'button', name: 'Join the waitlist' })
      // A plain HTML form: the read-only guard cancels its submit, so no request is ever made.
      if (noAccount && !did.includes('Your city')) return j({ action: 'fill', role: 'textbox', name: 'Your city', value: 'Osaka' })
      if (noAccount && !did.includes('Keep me posted')) return j({ action: 'click', role: 'button', name: 'Keep me posted' })
      if (!noAccount && !did.includes('Pricing')) return j({ action: 'click', role: 'link', name: 'Pricing' })
      return j({ action: 'click', role: 'link', name: 'Get started' })
    }
    return j({ action: 'back' })
  }
}

let app: Fixture
let other: { server: Server; url: string; writes: number }
const dirs: string[] = []
const out = () => {
  const d = mkdtempSync(join(tmpdir(), 'fresh-eyes-browser-'))
  dirs.push(d)
  return d
}

beforeAll(async () => {
  let writes = 0
  const o = await listen((req, res) => {
    if (req.method !== 'GET' && req.method !== 'OPTIONS') writes++
    res.writeHead(204, { 'access-control-allow-origin': '*' })
    res.end()
  })
  other = { ...o, get writes() { return writes } } as typeof other
  app = await startFixture(o.url)
})
afterAll(async () => {
  await app?.close()
  await new Promise<void>((r) => other?.server.close(() => r()))
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

describe('fresh-eyes on a local app', () => {
  it('signs in with the synthetic identity, writes only to the app, and reaches the goal', async () => {
    const dir = out()
    const prompts: string[] = []
    const result = await runFreshEyes({
      url: `${app.url}/`,
      goal: 'see why my app broke',
      success: { url: '/reports/*', text: 'Why it broke' },
      sessions: 2,
      steps: 20,
      identity: async () => IDENTITY,
      ask: scriptedAsk(() => true, prompts),
      outDir: dir,
    })
    expect(result.reached).toBe(2)
    // The model never sees the real values, though the filled fields show them in the snapshot.
    expect(prompts.some((p) => p.includes('{{email}}'))).toBe(true)
    expect(prompts.some((p) => p.includes(IDENTITY.email) || p.includes(IDENTITY.password))).toBe(false)
    expect(result.ttfvSeconds).toBeGreaterThan(0)
    // The app got the real values; the record keeps only placeholders.
    expect(app.writes.some((w) => w.path === '/api/session' && w.body.includes(encodeURIComponent(IDENTITY.password)))).toBe(true)
    expect(app.writes.some((w) => w.path === '/api/apps')).toBe(true)
    const saved = readFileSync(join(dir, 'result.json'), 'utf8')
    expect(saved).not.toContain(IDENTITY.password)
    expect(saved).not.toContain(IDENTITY.email)
    expect(saved).toContain('{{password}}')
    // Another origin, a third-party sign-in and a payment page never got a request through.
    expect(other.writes).toBe(0)
    const steps = result.sessions.flatMap((s) => s.steps)
    expect(steps.some((s) => s.action.includes('Continue with GitHub') && (s.outcome === 'refused' || s.outcome === 'blocked'))).toBe(true)
    expect(steps.some((s) => s.action.includes('Upgrade') && s.outcome === 'refused')).toBe(true)
    // Neutral labels that lead to a payment page or a third-party sign-in are stopped by the network guard.
    expect(steps.filter((s) => s.action.includes('See plans')).every((s) => s.outcome === 'blocked')).toBe(true)
    expect(steps.filter((s) => s.action.includes('More ways in')).every((s) => s.outcome === 'blocked' && s.requirements?.includes('third_party_account'))).toBe(true)
    expect(steps.some((s) => s.action.includes('See plans'))).toBe(true)
    expect(steps.some((s) => s.action.includes('More ways in'))).toBe(true)
    // Enter in the confirm field would submit "Delete project": refused, and nothing reached /api/projects.
    expect(steps.some((s) => s.action === 'Press Enter' && s.outcome === 'refused')).toBe(true)
    expect(steps.some((s) => s.action === 'Click the button "Confirm"' && s.outcome === 'refused')).toBe(true)
    expect(steps.some((s) => s.action === 'Click the button "Yes, go ahead"' && s.outcome === 'refused')).toBe(true)
    expect(steps.some((s) => s.action === 'Press Space' && s.outcome === 'refused')).toBe(true)
    expect(app.writes.some((w) => w.path.startsWith('/api/projects'))).toBe(false)
    // "project" resolved to "Delete project" and was refused; the delete never reached the app.
    expect(steps.some((s) => s.action === 'Click the button "project"' && s.outcome === 'refused')).toBe(true)
    expect(app.writes.some((w) => w.method === 'DELETE')).toBe(false)
    expect(result.sessions.every((s) => s.steps.every((st) => st.modelMs >= 0 && st.appMs >= 0))).toBe(true)
    // The copy button works in a browser that grants the clipboard, as a person's does.
    expect(result.findings.some((f) => /clipboard/i.test(f.summary))).toBe(false)
    // Both sessions found the landing copy unclear: filed once, as an opinion.
    const opinions = result.findings.filter((f) => f.basis === 'opinion')
    expect(opinions).toHaveLength(1)
    expect(opinions[0]!.sessions).toEqual([1, 2])
  }, 240_000)

  it('not a dry run but no account: still writes nothing', async () => {
    const before = app.writes.length
    const result = await runFreshEyes({
      url: `${app.url}/`,
      goal: 'see why my app broke',
      success: { url: '/reports/*', text: 'Why it broke' },
      sessions: 1,
      steps: 10,
      ask: scriptedAsk(() => false),
      outDir: out(),
    })
    expect(result.hasAccount).toBe(false)
    // The visitor did try a write (the waitlist): the guard stopped it, the app saw nothing.
    expect(result.sessions[0]!.steps.some((s) => s.action.includes('Join the waitlist') && s.outcome === 'blocked' && /no account/.test(s.note ?? ''))).toBe(true)
    expect(result.sessions[0]!.steps.some((s) => s.action.includes('Keep me posted') && s.outcome === 'blocked' && /no account/.test(s.note ?? ''))).toBe(true)
    expect(result.blocked).toBeGreaterThan(0)
    expect(app.writes.length).toBe(before)
    expect(result.stalledAt?.reason).toBe('signup_wall')
  })

  it('with no account writes nothing and stops at the sign-in wall, a confirmed finding', async () => {
    const before = app.writes.length
    const result = await runFreshEyes({
      url: `${app.url}/`,
      goal: 'see why my app broke',
      success: { url: '/reports/*', text: 'Why it broke' },
      sessions: 2,
      steps: 10,
      dryRun: true,
      identity: async () => IDENTITY,
      ask: scriptedAsk((s) => s === 1),
      outDir: out(),
    })
    expect(app.writes.length).toBe(before)
    expect(result.hasAccount).toBe(false)
    expect(result.reached).toBe(0)
    expect(result.stalledAt).toEqual({ screen: '/login', reason: 'signup_wall', sessions: 2 })
    const wall = result.findings.find((f) => f.rule === 'fresh-eyes-signup-wall')
    expect(wall?.basis).toBe('measured')
    expect(wall?.sessions).toEqual([1, 2])
    // One session's opinion is not filed.
    expect(result.findings.filter((f) => f.basis === 'opinion')).toEqual([])
  })
})
