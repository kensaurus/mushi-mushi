#!/usr/bin/env node
/**
 * FILE: admin-posture-audit.mjs
 * PURPOSE: Inspect PagePosture chrome row counts + console errors on admin hub routes.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'apps/admin/.playwright-mcp')
const BASE = process.env.ADMIN_URL ?? 'http://127.0.0.1:6464'
const PROJECT = process.env.ADMIN_PROJECT_ID ?? '6e7e0c3a-a777-4f1e-a699-6515993cf3bd'

const ROUTES = [
  '/rewards',
  '/fixes',
  '/reports',
  '/inbox?tab=overview',
  '/health',
  '/mcp',
  '/repo',
  '/settings',
  '/connect',
  '/qa-coverage',
]

async function main() {
  const { chromium } = await import('playwright')
  await mkdir(OUT, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()

  const errors = []
  const results = []

  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(String(err)))

  for (const route of ROUTES) {
    errors.length = 0
    const url = `${BASE}${route}${route.includes('?') ? '&' : '?'}project=${PROJECT}`
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 })
      await page.waitForTimeout(2500)
      const audit = await page.evaluate(() => {
        const posture = document.querySelector('[data-page-posture]')
        const rows = posture ? posture.children.length : 0
        const texts = [...document.querySelectorAll('main p.text-2xs, main p.text-2xs.text-fg-muted')]
          .map((el) => el.textContent?.trim())
          .filter(Boolean)
        const dupPairs = texts.filter((t, i) => texts.indexOf(t) !== i)
        return {
          rows,
          hasPosture: Boolean(posture),
          duplicateHints: [...new Set(dupPairs)],
          title: document.title,
        }
      })
      const file = path.join(OUT, `audit-${route.split('?')[0].replace(/\//g, '') || 'root'}.png`)
      await page.screenshot({ path: file })
      results.push({ route, url, ...audit, consoleErrors: [...errors] })
      console.log(JSON.stringify({ route, ...audit, consoleErrors: errors.length }))
    } catch (err) {
      results.push({ route, url, error: err instanceof Error ? err.message : String(err) })
      console.warn('FAIL', route, err instanceof Error ? err.message : err)
    }
  }

  await writeFile(path.join(OUT, 'posture-audit.json'), JSON.stringify(results, null, 2))
  await browser.close()

  const failed = results.filter((r) => r.error || (r.consoleErrors?.length ?? 0) > 0 || r.rows > 3)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
