#!/usr/bin/env node
/**
 * Capture admin console chrome baseline screenshots for UI/UX regression review.
 * Saves under apps/admin/.playwright-mcp/ (gitignored scratch).
 *
 * Usage (dev server must be running on ADMIN_URL):
 *   ADMIN_URL=http://localhost:6464 node scripts/admin-chrome-screenshot.mjs
 */

import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'apps/admin/.playwright-mcp')
const BASE = process.env.ADMIN_URL ?? 'http://localhost:6464'

const ROUTES = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'connect', path: '/connect' },
  { name: 'reports', path: '/reports' },
  { name: 'projects', path: '/projects' },
  { name: 'qa-coverage', path: '/qa-coverage' },
  { name: 'settings', path: '/settings' },
]

const VIEWPORTS = [
  { label: '1440-light', width: 1440, height: 900, colorScheme: 'light' },
  { label: '1440-dark', width: 1440, height: 900, colorScheme: 'dark' },
  { label: '1024-light', width: 1024, height: 700, colorScheme: 'light' },
  { label: '1024-dark', width: 1024, height: 700, colorScheme: 'dark' },
  { label: '800-light', width: 800, height: 700, colorScheme: 'light' },
  { label: '800-dark', width: 800, height: 700, colorScheme: 'dark' },
]

async function main() {
  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    console.error('Playwright not installed — skip or run: pnpm exec playwright install chromium')
    process.exit(0)
  }

  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: true })

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ colorScheme: vp.colorScheme })
    const page = await context.newPage()
    await page.setViewportSize({ width: vp.width, height: vp.height })
    for (const route of ROUTES) {
      const url = `${BASE}${route.path}`
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 })
        const file = path.join(OUT, `${route.name}-${vp.label}.png`)
        await page.screenshot({ path: file, fullPage: true })
        console.log('wrote', path.relative(ROOT, file))
      } catch (err) {
        console.warn('skip', url, err instanceof Error ? err.message : err)
      }
    }
    await context.close()
  }

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
