#!/usr/bin/env node
/**
 * Capture golden theme matrix screenshots for UI/UX regression.
 * Usage: node scripts/capture-theme-matrix.mjs [baseUrl]
 * Requires: admin dev server running (default http://localhost:6464)
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:6464'
const OUT = join(process.cwd(), '.playwright-mcp')
const ROUTES = ['/dashboard', '/reports', '/settings', '/onboarding', '/connect']
const VIEWPORTS = [
  { name: '800', width: 800, height: 900 },
  { name: '1024', width: 1024, height: 900 },
  { name: '1440', width: 1440, height: 900 },
]
const THEMES = ['dark', 'light']

async function main() {
  let playwright
  try {
    playwright = await import('playwright')
  } catch {
    console.error('[skip] playwright not installed — run pnpm exec playwright install chromium')
    process.exit(0)
  }

  await mkdir(OUT, { recursive: true })
  const browser = await playwright.chromium.launch({ headless: true })
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage()

  const manifest = []

  for (const theme of THEMES) {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      for (const route of ROUTES) {
        const slug = route.replace(/^\//, '') || 'home'
        const file = `${slug}-${theme}-${vp.name}.png`
        const path = join(OUT, file)
        try {
          await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 20000 })
          await page.evaluate((t) => {
            document.documentElement.setAttribute('data-theme', t)
            document.documentElement.style.colorScheme = t
            try {
              window.localStorage.setItem('mushi:theme:v1', t)
            } catch {
              // ignore
            }
          }, theme)
          await page.waitForTimeout(400)
          await page.screenshot({ path, fullPage: false })
          manifest.push({ route, theme, viewport: vp.name, file })
          console.log(`[ok] ${file}`)
        } catch (err) {
          console.warn(`[warn] ${route} ${theme} ${vp.name}: ${err.message}`)
        }
      }
    }
  }

  await browser.close()
  await writeFile(join(OUT, 'theme-matrix-manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`[done] ${manifest.length} captures → ${OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
