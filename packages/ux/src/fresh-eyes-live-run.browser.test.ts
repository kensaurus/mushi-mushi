// SPDX-License-Identifier: MIT
/**
 * Runs only with MUSHI_UX_BROWSER_TESTS=1 (launches Chromium).
 *
 * The runner artifacts of Mushi's first live fresh-eyes run (2026-10-28), in a
 * real browser:
 *
 * - a docs page whose sidebar comes first in the DOM: the model sees the
 *   article, and never an sr-only "Skip to Content";
 * - a "Sign in" that opens a popup: the visitor follows it and reaches the
 *   goal there, instead of stalling on the page that says "Opening…";
 * - a hidden twin of a link is never the one clicked;
 * - a page with a pulsing 6 px dot is ready at once; a full-width skeleton
 *   and a splash spinner hold the wait to its cap, and the cap is counted.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { contentWaitsCapped, waitForContent } from './capture.js'
import { perform } from './explore.js'
import { runFreshEyes, type FreshAsk } from './fresh-eyes.js'

const SIDEBAR = Array.from({ length: 300 }, (_, i) => `<li><a href="/docs/p${i}">Docs page number ${i}</a></li>`).join('')
const page = (title: string, bodyHtml: string, script = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}</style></head><body>${bodyHtml}${script ? `<script>${script}</script>` : ''}</body></html>`

let server: Server
let base = ''
const dirs: string[] = []
const out = () => {
  const d = mkdtempSync(join(tmpdir(), 'fresh-eyes-live-'))
  dirs.push(d)
  return d
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!
    const send = (html: string) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
    }
    if (path === '/docs/demo') {
      return send(
        page(
          'Sample diagnosis',
          `<a class="sr-only" href="#main">Skip to Content</a><nav aria-label="Docs"><ul>${SIDEBAR}</ul></nav><main id="main"><h1>Sample diagnosis</h1><p>Why it broke: the Save handler never awaited the request, so the page moved on before it finished. The fix awaits it and shows an error when it fails.</p><button id="signin">Sign in</button></main>`,
          `document.getElementById('signin').onclick = () => { document.getElementById('signin').textContent = 'Opening…'; window.open('/auth', 'mushi-auth', 'width=480,height=640') }`,
        ),
      )
    }
    if (path === '/auth') return send(page('Sign in', '<main><h1>Welcome back</h1><p>You are signed in to the console. Your reports are one click away.</p></main>'))
    if (path === '/twins') return send(page('Twins', '<main><a class="sr-only" href="/hidden">Start</a><p>Pick where to start reading the guide.</p><a href="/shown">Start</a></main>'))
    if (path === '/shown' || path === '/hidden') return send(page(path, `<main><h1>${path}</h1><p>This is the page the visitor landed on after the click.</p></main>`))
    if (path === '/dot') {
      return send(
        page(
          'Dot',
          '<style>@keyframes pulse{50%{opacity:.5}} .dot{display:inline-block;width:6px;height:6px;border-radius:9999px;background:red;animation:pulse 2s infinite}</style><main><h1>Reports</h1><p>Every report your users sent, newest first, with its diagnosis.</p><span class="dot"></span><span class="animate-pulse dot"></span></main>',
        ),
      )
    }
    if (path === '/skeleton') return send(page('Skeleton', '<main><p>Loading your reports, one moment please, almost there now.</p><div class="skeleton" style="width:100%;height:24px;background:#eee"></div></main>'))
    if (path === '/splash') return send(page('Splash', '<main><p>Starting the app for you, one moment please, almost there.</p><div class="animate-spin" style="width:64px;height:64px;border:4px solid #ccc"></div></main>'))
    res.writeHead(404)
    res.end('not found')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()))
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

describe('the docs page and its sign-in popup', () => {
  it('shows the model the article, not a cut sidebar or a hidden skip link, and follows the popup to the goal', async () => {
    const prompts: string[] = []
    const ask: FreshAsk = async (prompt) => {
      prompts.push(prompt)
      const snap = prompt.split('<snapshot>')[1]?.split('</snapshot>')[0] ?? ''
      if (snap.includes('Welcome back')) return { text: JSON.stringify({ action: 'done' }) }
      return { text: JSON.stringify({ action: 'click', role: 'button', name: 'Sign in' }) }
    }
    const result = await runFreshEyes({ url: `${base}/docs/demo`, goal: 'sign in', success: { text: 'Welcome back' }, sessions: 1, steps: 4, ask, outDir: out() })
    const first = prompts[0]!.split('<snapshot>')[1]!.split('</snapshot>')[0]!
    expect(first).toContain('Sample diagnosis')
    expect(first).toContain('the Save handler never awaited')
    expect(first).not.toContain('Skip to Content')
    expect(first.indexOf('Sample diagnosis')).toBeLessThan(first.indexOf('Docs page number 0'))
    expect(result.reached).toBe(1)
    const click = result.sessions[0]!.steps.find((s) => s.action.includes('Sign in'))!
    expect(click.note).toContain('opened a new window at /auth')
  })
})

describe('in a browser', () => {
  let browser: Browser
  beforeAll(async () => {
    browser = await chromium.launch()
  })
  afterAll(async () => {
    await browser?.close()
  })

  it('clicks the link a visitor can see, never its hidden twin', async () => {
    const p = await browser.newPage()
    await p.goto(`${base}/twins`)
    expect(await perform(p, { action: 'click', role: 'link', name: 'Start' })).toBeNull()
    expect(new URL(p.url()).pathname).toBe('/shown')
    await p.close()
  })

  it('a pulsing 6 px dot does not hold the page; a skeleton and a splash spinner do, up to the cap, which is counted', async () => {
    const p = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await p.goto(`${base}/dot`)
    const t0 = Date.now()
    expect(await waitForContent(p, 5000)).toBe(true)
    expect(Date.now() - t0).toBeLessThan(2500)
    expect(contentWaitsCapped(p)).toBe(0)
    await p.goto(`${base}/skeleton`)
    expect(await waitForContent(p, 1500)).toBe(false)
    expect(contentWaitsCapped(p)).toBe(1)
    await p.goto(`${base}/splash`)
    expect(await waitForContent(p, 1500)).toBe(false)
    expect(contentWaitsCapped(p)).toBe(2)
    await p.close()
  })
})
