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

const ROUTES = ['/dashboard', '/onboarding', '/mcp', '/qa-coverage', '/skills', '/feedback', '/reports', '/fixes', '/connect', '/billing', '/inventory', '/tester']

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const consoleErrors = []
  const failedRequests = []

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('response', (res) => {
    const url = res.url()
    if (url.includes('/v1/admin/') && res.status() >= 400) {
      failedRequests.push(`${res.status()} ${url}`)
    }
  })

  for (const route of ROUTES) {
    const url = `${BASE}${route}`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(800)
    const overlay = await page.locator('vite-error-overlay, [class*="vite-error"]').count()
    if (overlay > 0) {
      console.error(`FAIL overlay on ${route}`)
      process.exitCode = 1
    }
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
