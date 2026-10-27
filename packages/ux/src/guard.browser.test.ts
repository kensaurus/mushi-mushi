// SPDX-License-Identifier: MIT
/**
 * Runs only with MUSHI_UX_BROWSER_TESTS=1 (launches Chromium).
 * The write guard in a real browser: by default a form submit and a fetch
 * POST never reach the app; with writes: 'same-origin' (ADR 0053) they reach
 * the app's own origin and nothing else, and a public sign-up call is still
 * refused there.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { openSession } from './capture.js'

let app: Server
let other: Server
let appUrl = ''
let otherUrl = ''
const appWrites: string[] = []
const otherWrites: string[] = []

const listen = async (s: Server) => {
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`
}

beforeAll(async () => {
  other = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'OPTIONS') otherWrites.push(`${req.method} ${req.url}`)
    res.writeHead(204, { 'access-control-allow-origin': '*' })
    res.end()
  })
  otherUrl = await listen(other)
  app = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') appWrites.push(`${req.method} ${req.url}`)
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<!doctype html><title>t</title><form method="post" action="/api/save"><button id="go">Save</button></form>
<script>
fetch('/api/track', { method: 'POST', body: '{}' }).catch(() => {})
fetch('/auth/v1/signup', { method: 'POST', body: '{}' }).catch(() => {})
fetch('${otherUrl}/collect', { method: 'POST', body: 'x' }).catch(() => {})
</script>`)
  })
  appUrl = await listen(app)
})
afterAll(async () => {
  await new Promise<void>((r) => app?.close(() => r()))
  await new Promise<void>((r) => other?.close(() => r()))
})

async function visitAndSubmit(policy?: Parameters<typeof openSession>[0]): Promise<void> {
  const session = await openSession({ headless: true, ...policy })
  try {
    const ctx = await session.freshContext()
    const page = await ctx.newPage()
    await page.goto(`${appUrl}/`)
    await page.waitForTimeout(300)
    await page.click('#go').catch(() => {})
    await page.waitForTimeout(800)
    await ctx.close()
  } finally {
    await session.close()
  }
}

describe('write guard in a browser', () => {
  it('by default, no write reaches anyone and the form is not submitted', async () => {
    appWrites.length = 0
    otherWrites.length = 0
    await visitAndSubmit()
    expect(appWrites).toEqual([])
    expect(otherWrites).toEqual([])
  })

  it('same-origin lets the app take its own writes, never another origin or the public sign-up', async () => {
    appWrites.length = 0
    otherWrites.length = 0
    await visitAndSubmit({ policy: { writes: 'same-origin', appOrigins: [appUrl] } })
    expect(appWrites).toContain('POST /api/track')
    expect(appWrites).toContain('POST /api/save')
    expect(appWrites).not.toContain('POST /auth/v1/signup')
    expect(otherWrites).toEqual([])
  })
})
