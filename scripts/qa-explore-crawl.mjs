#!/usr/bin/env node
/**
 * Headless Playwright crawl of /explore primary + secondary tabs.
 * Dev-only — not wired into CI. Saves screenshots under .playwright-mcp/
 *
 * Usage: node scripts/qa-explore-crawl.mjs [baseUrl]
 */

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:6464'
const OUT = '.playwright-mcp'

const TABS = [
  'overview',
  'ask',
  'tour',
  'domains',
  'knowledge',
  'graph',
  'layers',
  'search',
  'index',
]

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

  const failures = []

  for (const tab of TABS) {
    const url = `${BASE}/explore?tab=${tab}`
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(1500)
      const body = await page.locator('body').innerText()
      if (/something went wrong|error boundary|failed to load/i.test(body)) {
        failures.push({ tab, reason: 'error boundary text' })
      }
      await page.screenshot({ path: path.join(OUT, `explore-${tab}.png`), fullPage: false })
      console.log(`ok  ${tab}`)
    } catch (err) {
      failures.push({ tab, reason: err instanceof Error ? err.message : String(err) })
      console.error(`fail ${tab}`)
    }
  }

  await browser.close()

  if (failures.length) {
    console.error('\nFailures:', failures)
    process.exit(1)
  }
  console.log('\nAll explore tabs passed.')
}

main()
