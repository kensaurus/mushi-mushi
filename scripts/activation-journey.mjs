#!/usr/bin/env node
/**
 * FILE: scripts/activation-journey.mjs
 * PURPOSE: Playwright smoke for activation cockpit v2 critical paths.
 */

import { chromium } from 'playwright'

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://localhost:6464'

const JOURNEYS = [
  { name: 'setup cockpit', path: '/onboarding' },
  { name: 'mcp help', path: '/mcp' },
  { name: 'feedback hub', path: '/feedback' },
  { name: 'qa coverage', path: '/qa-coverage' },
]

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  let failed = 0

  for (const journey of JOURNEYS) {
    const url = `${BASE}${journey.path}`
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    const status = response?.status() ?? 0
    if (status >= 400) {
      console.error(`FAIL ${journey.name}: HTTP ${status}`)
      failed += 1
      continue
    }
    const body = await page.locator('body').innerText()
    if (/something went wrong|vite-error-overlay/i.test(body)) {
      console.error(`FAIL ${journey.name}: error surface visible`)
      failed += 1
      continue
    }
    console.log(`OK ${journey.name}`)
  }

  await browser.close()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
