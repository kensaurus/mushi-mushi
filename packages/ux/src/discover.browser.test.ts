// SPDX-License-Identifier: MIT
/**
 * Runs only with MUSHI_UX_BROWSER_TESTS=1 (launches Chromium).
 * Proves discovery finds pages, a tab and a dialog, folds same-shape pages,
 * skips destructive controls and sign-out, and that no write reaches the app.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { captureSurface, openSession, type BrowserSession } from './capture.js'
import { discover } from './discover.js'
import { VIEWPORTS } from './types.js'

/**
 * Tiny multi-page app for the browser tests: links, a tablist, a dialog
 * trigger, a destructive button, a form, and a POST fired on every page load.
 * `writes` counts every non-GET request that reached the server; the guard
 * must keep it at zero.
 */


function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;margin:24px} [role=dialog]{border:1px solid #333;padding:16px}</style></head>
<body><nav><a href="/">Home</a> <a href="/about">About</a> <a href="/items/1">Item 1</a> <a href="/items/2">Item 2</a> <a href="/logout">Log out</a></nav>
<main>${body}</main>
<script>fetch('/api/track', { method: 'POST', body: '{}' }).catch(() => {})
navigator.serviceWorker?.register('/sw.js').then(() => navigator.serviceWorker.ready).then(() => fetch('/api/sw-proxied', { method: 'POST' })).catch(() => {})</script>
</body></html>`
}

const HOME = page('Home', `<h1>Home</h1>
<div role="tablist">
  <button role="tab" aria-selected="true" aria-controls="p1" id="t1">Overview</button>
  <button role="tab" aria-selected="false" aria-controls="p2" id="t2">Details</button>
</div>
<section role="tabpanel" id="p1">Overview panel</section>
<section role="tabpanel" id="p2" hidden><h2>Details</h2><ul><li>One</li><li>Two</li></ul></section>
<button aria-haspopup="dialog" id="open">Invite people</button>
<div role="dialog" aria-label="Invite" id="dlg" hidden><h2>Invite</h2><input aria-label="Email"><button>Close</button></div>
<button id="del" onclick="fetch('/api/delete', { method: 'POST' })">Delete account</button>
<form action="/api/save" method="post"><input name="n" aria-label="Name"><button type="submit">Save</button></form>
<script>
  const tabs = document.querySelectorAll('[role=tab]')
  tabs.forEach((t) => t.addEventListener('click', () => {
    tabs.forEach((x) => { x.setAttribute('aria-selected', String(x === t)); document.getElementById(x.getAttribute('aria-controls')).hidden = x !== t })
  }))
  document.getElementById('open').addEventListener('click', () => { document.getElementById('dlg').hidden = false })
</script>`)

const ABOUT = page('About', '<h1>About</h1><p>Plain text page.</p>')
const item = (id: string) => page(`Item ${id}`, `<h1>Item ${id}</h1><table><tr><td>a</td></tr><tr><td>b</td></tr></table>`)

interface FixtureApp {
  url: string
  writes: Array<{ method: string; url: string }>
  close(): Promise<void>
}

async function startFixtureApp(): Promise<FixtureApp> {
  const writes: Array<{ method: string; url: string }> = []
  const server: Server = createServer((req, res) => {
    const method = req.method ?? 'GET'
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) writes.push({ method, url: req.url ?? '' })
    const path = (req.url ?? '/').split('?')[0]
    if (path === '/sw.js') {
      // A worker that answers every fetch itself, so its requests would never reach context.route.
      res.writeHead(200, { 'content-type': 'text/javascript' })
      return res.end("self.addEventListener('install', () => fetch('/api/sw-install', { method: 'POST' }));self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));self.addEventListener('fetch', (e) => e.respondWith(fetch(e.request)))")
    }
    const html =
      path === '/' ? HOME : path === '/about' ? ABOUT : /^\/items\/\d+$/.test(path) ? item(path.split('/')[2]) : null
    if (path === '/logout') writes.push({ method: 'GET-LOGOUT', url: path })
    res.writeHead(html ? 200 : 404, { 'content-type': 'text/html' })
    res.end(html ?? 'not found')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    writes,
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}

let app: FixtureApp
let session: BrowserSession

beforeAll(async () => {
  app = await startFixtureApp()
  session = await openSession({ headless: true })
})
afterAll(async () => {
  await session?.close()
  await app?.close()
})

describe('discover + capture on the fixture app', () => {
  it('maps pages, tabs and dialogs without writing anything', async () => {
    const surfaces = await discover(session, { baseUrl: app.url })
    const byKind = (k: string) => surfaces.filter((s) => s.kind === k).map((s) => s.label)

    expect(byKind('page')).toEqual(expect.arrayContaining(['Home', 'About']))
    // /items/1 and /items/2 share one structure: kept once.
    expect(surfaces.filter((s) => /^Item /.test(s.label))).toHaveLength(1)
    expect(byKind('tab')).toEqual(['Home › Details'])
    expect(byKind('dialog')).toEqual(['Home › Invite people'])
    expect(surfaces.some((s) => /Delete|Log out|Save/.test(s.label))).toBe(false)

    const dialog = surfaces.find((s) => s.kind === 'dialog')
    if (!dialog) throw new Error('dialog surface missing')
    const shot = await captureSurface(session, app.url, dialog, VIEWPORTS[1])
    expect(shot.png.subarray(1, 4).toString()).toBe('PNG')
    expect(Array.isArray(shot.probes.axe)).toBe(true)

    // Every page load fired POST /api/track and tried to register a Service
    // Worker that POSTs; nothing reached the server. (Chromium on Playwright
    // 1.61 routes worker requests too, so this holds with workers allowed;
    // blocking them in capture.ts is the documented belt-and-braces.)
    expect(app.writes).toEqual([])
    expect(session.guard.blocked.length).toBeGreaterThan(0)
    expect(session.guard.blocked.every((b) => b.method === 'POST')).toBe(true)
  })
})

describe('a dev server reload during navigation', () => {
  // "/" reloads itself 400 ms after loading, like a Next.js full reload after a
  // slow first compile; "/chat" redirects to a "/chat/" that takes 1.5 s. The
  // reload replaces the navigation and Playwright's goto resolves to null.
  // glot.it lost /chat on the first pass this way (2026-10-06).
  it('keeps the page instead of dropping it silently', async () => {
    const server = createServer((req, res) => {
      const text = '<p>Enough words on this screen for the content wait to settle quickly.</p>'
      // One reload per browser session, as a dev server's full reload happens once.
      const reloadOnce = "<script>if (!sessionStorage.r) { sessionStorage.r = 1; setTimeout(() => location.reload(), 400) }</script>"
      if (req.url === '/') res.end(`<!doctype html><html lang="en"><title>Home</title><main><h1>Home</h1>${text}</main>${reloadOnce}</html>`)
      else if (req.url === '/chat') res.writeHead(308, { location: '/chat/' }).end()
      else if (req.url === '/chat/') setTimeout(() => res.end(`<!doctype html><html lang="en"><title>Chat</title><main><h1>Chat</h1><ul><li>a</li></ul>${text}</main></html>`), 1500)
      else res.writeHead(404).end()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const own = await openSession()
    try {
      const log: string[] = []
      const surfaces = await discover(own, { baseUrl: url, startPaths: ['/', '/chat'], onlyStartPaths: true, onProgress: (m) => log.push(m) })
      expect(surfaces.map((s) => s.path)).toEqual(['/', '/chat/'])
      expect(log.filter((m) => /^(retrying|skipped)/.test(m))).toEqual([])
    } finally {
      await own.close()
      await new Promise((r) => server.close(r))
    }
  }, 60_000)
})
