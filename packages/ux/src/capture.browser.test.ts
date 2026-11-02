// SPDX-License-Identifier: MIT
/**
 * Runs only with MUSHI_UX_BROWSER_TESTS=1 (launches Chromium).
 * A cached profile must open capture pages in that profile — a second
 * browser seeded from storageState is signed out — and still give each
 * capture its own localStorage (glot.it /words, 2026-10-07).
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PROFILE_LS_PREFIX, captureSurface, openSession, type BrowserSession } from './capture.js'
import { VIEWPORTS } from './types.js'

const filler = '<p>Enough words on this screen for the content wait to settle quickly.</p>'

function page(body: string): string {
  return `<!doctype html><html lang="en"><title>t</title><main>${body}${filler}</main></html>`
}

describe('a cached profile', () => {
  let server: Server
  let origin = ''
  let dir = ''
  const writes: string[] = []
  let cookieHeader = ''

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.headers.cookie) cookieHeader = req.headers.cookie
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') writes.push(`${req.method} ${req.url}`)
      const body =
        req.url === '/writer'
          ? page('<h1>Writer</h1><script>localStorage.setItem("visited","yes")</script>')
          : page(
              '<h1>Reader</h1><p id="p"></p><script>document.getElementById("p").textContent = localStorage.getItem("visited") ? "Welcome back, here is a long changed paragraph that moves the layout a lot." : "First visit"; fetch("/api/track", { method: "POST", body: "{}" }).catch(() => {})</script>',
            )
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    dir = await mkdtemp(join(tmpdir(), 'mushi-profile-'))
    const prep = await chromium.launchPersistentContext(dir, { headless: true })
    try {
      await prep.addCookies([{ name: 'from-disk', value: 'kept', url: `${origin}/`, httpOnly: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 }])
    } finally {
      await prep.close()
    }
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('opens captures in the profile, isolates localStorage, and puts the profile back', async () => {
    const session: BrowserSession = await openSession({ profileDir: dir, headless: true })
    try {
      await session.context.addCookies([{ name: 'live', value: 'yes', url: `${origin}/`, httpOnly: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 }])
      const ctx = await session.freshContext()
      let pages = 0
      expect(ctx.on('page', () => { pages++ })).toBe(ctx)
      expect(ctx.setDefaultTimeout(30_000)).toBeUndefined()
      expect(ctx.setDefaultNavigationTimeout(30_000)).toBeUndefined()
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
      await ctx.route('**/*', (route) => route.abort())
      const blocked = await ctx.newPage()
      expect(blocked.context()).toBe(session.context)
      await expect(blocked.goto(`${origin}/reader`, { timeout: 5_000 })).rejects.toThrow()
      expect(pages).toBe(1)
      await ctx.close()
      const alive = await session.context.newPage()
      const res = await alive.goto(`${origin}/reader`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
      expect(res?.ok()).toBe(true)
      expect(pages).toBe(1)
      expect(cookieHeader).toContain('from-disk=kept')
      expect(cookieHeader).toContain('live=yes')
      await alive.close()

      const vp = VIEWPORTS[1]
      const first = await captureSurface(session, origin, { path: '/reader', steps: [] }, vp)
      await captureSurface(session, origin, { path: '/writer', steps: [] }, vp)
      const again = await captureSurface(session, origin, { path: '/reader', steps: [] }, vp)
      expect(again.png.equals(first.png)).toBe(true)
      const [parallel] = await Promise.all([
        captureSurface(session, origin, { path: '/reader', steps: [] }, vp),
        captureSurface(session, origin, { path: '/writer', steps: [] }, vp),
      ])
      expect(parallel.png.equals(first.png)).toBe(true)

      await session.warmUp(origin, ['/writer'])
      const warmed = await session.freshContext()
      const warmedPage = await warmed.newPage()
      await warmedPage.goto(`${origin}/reader`, { waitUntil: 'domcontentloaded' })
      expect(await warmedPage.locator('#p').textContent()).toContain('Welcome back')
      await warmedPage.evaluate(() => {
        localStorage.setItem('visited', 'no')
        localStorage.setItem('extra', '1')
      })
      await warmed.close()
      const restored = await session.freshContext()
      const restoredPage = await restored.newPage()
      await restoredPage.goto(`${origin}/reader`, { waitUntil: 'domcontentloaded' })
      expect(await restoredPage.locator('#p').textContent()).toContain('Welcome back')
      expect(await restoredPage.evaluate(() => localStorage.getItem('extra'))).toBeNull()
      await restored.close()
      expect(writes).toEqual([])
    } finally {
      await session.close()
    }

    const reopened = await chromium.launchPersistentContext(dir, { headless: true })
    try {
      const cookies = await reopened.cookies(`${origin}/`)
      expect(cookies.find((cookie) => cookie.name === 'from-disk')?.value).toBe('kept')
      expect(cookies.find((cookie) => cookie.name === 'live')?.value).toBe('yes')
      const page = await reopened.newPage()
      await page.goto(`${origin}/reader`, { waitUntil: 'domcontentloaded' })
      expect(await page.locator('#p').textContent()).toContain('Welcome back')
      const keys = await page.evaluate(() => Object.keys(localStorage))
      expect(keys.some((key) => key.startsWith(PROFILE_LS_PREFIX))).toBe(false)
      expect(await page.evaluate(() => localStorage.getItem('extra'))).toBeNull()
    } finally {
      await reopened.close()
    }
  }, 120_000)
})
