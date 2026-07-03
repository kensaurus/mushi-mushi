#!/usr/bin/env node
/**
 * FILE: scripts/admin-console-health.mjs
 * PURPOSE: Fail fast when the local admin console has Vite overlays,
 *          console errors, or broken /v1/admin/* responses.
 *
 * Usage:
 *   node scripts/admin-console-health.mjs [--base http://localhost:6464]
 */

import { chromium } from 'playwright'

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://localhost:6464'

const ROUTES = ['/login', '/signup', '/dashboard', '/onboarding', '/mcp', '/qa-coverage', '/skills', '/feedback', '/reports', '/fixes', '/connect', '/billing', '/inventory', '/tester']

const PUBLIC_ROUTES = new Set(['/login', '/signup'])

function isBenignConsoleError(text, route) {
  if (/ERR_INSUFFICIENT_RESOURCES/.test(text)) return true
  if (PUBLIC_ROUTES.has(route) && /Failed to load resource.*\b(400|401|422)\b/.test(text)) return true
  return false
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const consoleErrors = []
  const failedRequests = []

  for (const route of ROUTES) {
    const page = await browser.newPage()

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      const text = msg.text()
      if (isBenignConsoleError(text, route)) return
      consoleErrors.push(`${route}: ${text}`)
    })
    page.on('response', (res) => {
      const url = res.url()
      if (url.includes('/v1/admin/') && res.status() >= 400) {
        failedRequests.push(`${route}: ${res.status()} ${url}`)
      }
    })

    const url = `${BASE}${route}`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(400)
    const overlay = await page.locator('vite-error-overlay, [class*="vite-error"]').count()
    if (overlay > 0) {
      console.error(`FAIL overlay on ${route}`)
      process.exitCode = 1
    }
    await page.close()
  }

  await browser.close()

  if (consoleErrors.length) {
    console.error('Console errors:')
    for (const err of consoleErrors.slice(0, 10)) console.error(`  - ${err}`)
    process.exitCode = 1
  }
  if (failedRequests.length) {
    console.error('Failed admin API requests:')
    for (const req of failedRequests.slice(0, 10)) console.error(`  - ${req}`)
    process.exitCode = 1
  }

  if (!process.exitCode) {
    console.log(`OK admin console health @ ${BASE} (${ROUTES.length} routes)`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
