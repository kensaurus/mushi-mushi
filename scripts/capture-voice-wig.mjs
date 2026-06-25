#!/usr/bin/env node
/**
 * Capture 3-viewport WIG screenshots for voice burndown verification.
 * Saves to .playwright-mcp/ only (never repo root).
 *
 *   ADMIN_URL=http://localhost:6464 DOCS_URL=http://localhost:3000 node scripts/capture-voice-wig.mjs
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const OUT = join(ROOT, '.playwright-mcp')
const ADMIN_BASE = process.env.ADMIN_URL ?? 'http://localhost:6464'
const DOCS_BASE = process.env.DOCS_URL ?? 'http://localhost:3000'

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1024', width: 1024, height: 768 },
  { name: '800', width: 800, height: 900 },
]

const TARGETS = [
  { base: 'admin', path: '/dashboard', slug: 'admin-dashboard' },
  { base: 'admin', path: '/reports', slug: 'admin-reports' },
  { base: 'admin', path: '/onboarding', slug: 'admin-onboarding' },
  { base: 'admin', path: '/fixes', slug: 'admin-fixes' },
  { base: 'docs', path: '/pricing', slug: 'docs-pricing' },
  { base: 'docs', path: '/connect', slug: 'docs-connect' },
]

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ ignoreHTTPSErrors: true })
const page = await context.newPage()

let ok = 0
let skipped = 0

for (const target of TARGETS) {
  const base = target.base === 'admin' ? ADMIN_BASE : DOCS_BASE
  const url = `${base.replace(/\/$/, '')}${target.path}`

  for (const vp of VIEWPORTS) {
    const file = join(OUT, `${target.slug}-${vp.name}.png`)
    try {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
      if (!resp || resp.status() >= 400) {
        console.warn(`SKIP ${url} @ ${vp.name} — HTTP ${resp?.status() ?? 'no response'}`)
        skipped++
        continue
      }
      await page.waitForTimeout(1200)
      await page.screenshot({ path: file, fullPage: false })
      console.log(`Wrote ${file}`)
      ok++
    } catch (err) {
      console.warn(`SKIP ${url} @ ${vp.name} — ${err instanceof Error ? err.message : err}`)
      skipped++
    }
  }
}

await browser.close()
console.log(`Done: ${ok} captured, ${skipped} skipped → ${OUT}`)
process.exit(skipped > 0 && ok === 0 ? 1 : 0)
