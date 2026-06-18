#!/usr/bin/env node
/**
 * Scoped PDCA smoke for UI unification + polish surfaces.
 * Saves screenshots under .playwright-mcp/
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, '.playwright-mcp')
const BASE = process.env.ADMIN_BASE ?? 'http://localhost:6464'

const ROUTES = [
  { path: '/dashboard', shot: 'pdca-dashboard-6464.png' },
  { path: '/reports', shot: 'pdca-reports-6464.png' },
  { path: '/intelligence', shot: 'pdca-intelligence-6464.png' },
]

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const consoleErrors = []
  const failedRequests = []

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[${msg.type()}] ${msg.text()}`)
  })
  page.on('response', (res) => {
    const url = res.url()
    if (url.includes('/v1/admin/') && res.status() >= 400) {
      failedRequests.push(`${res.status()} ${url}`)
    }
  })

  const results = []
  for (const { path: route, shot } of ROUTES) {
    const url = `${BASE}${route}`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(1200)
    const overlay = await page.locator('vite-error-overlay, [class*="vite-error"]').count()
    const title = await page.title()
    const hasAppShell = await page.locator('nav, [role="navigation"], header').count()
    await page.screenshot({ path: path.join(OUT, shot), fullPage: false })
    results.push({
      route,
      overlay: overlay > 0,
      title,
      hasAppShell: hasAppShell > 0,
      shot,
    })
  }

  await browser.close()

  const fail = results.some((r) => r.overlay) || consoleErrors.length > 0
  console.log(JSON.stringify({ base: BASE, results, consoleErrors: consoleErrors.slice(0, 8), failedRequests: failedRequests.slice(0, 8) }, null, 2))
  if (fail) process.exit(1)
  console.log('OK pdca-ui-polish smoke')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
