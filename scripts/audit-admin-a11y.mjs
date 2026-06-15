#!/usr/bin/env node
/**
 * Crawl admin console routes — axe-core contrast + console errors.
 * Usage: node scripts/audit-admin-a11y.mjs [--base http://localhost:6464]
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://localhost:6464'

const ROUTES = [
  '/dashboard', '/onboarding', '/setup-copilot', '/reports', '/fixes', '/fixes?tab=attempts',
  '/content', '/projects', '/settings', '/queue', '/graph', '/inventory', '/judge', '/query',
  '/research', '/repo', '/sso', '/audit', '/fullstack-audit', '/code-health', '/prompt-lab',
  '/intelligence', '/compliance', '/storage', '/marketplace', '/integrations/config', '/mcp',
  '/feedback', '/feature-board', '/health', '/qa-coverage', '/anti-gaming', '/rewards',
  '/lessons', '/releases', '/iterate', '/skills', '/drift', '/experiments', '/anomalies',
  '/explore', '/billing',
]

const OUT_DIR = join(import.meta.dirname, '../.playwright-mcp')
mkdirSync(OUT_DIR, { recursive: true })

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  const findings = []

  for (const route of ROUTES) {
    const url = `${BASE}${route}`
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await page.waitForTimeout(1200)

      const overlay = await page.locator('vite-error-overlay, [class*="vite-error"]').count()
      if (overlay > 0) {
        findings.push({ route, severity: 'critical', issue: 'Vite error overlay visible' })
        continue
      }

      const axe = await page.evaluate(async () => {
        if (!window.axe) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script')
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js'
            s.onload = resolve
            s.onerror = reject
            document.head.appendChild(s)
          })
        }
        const results = await window.axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2aa', 'wcag21aa', 'wcag22aa'] },
          rules: { 'color-contrast': { enabled: true } },
        })
        return {
          violations: results.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            description: v.description,
            nodes: v.nodes.length,
            sample: v.nodes[0]?.html?.slice(0, 120) ?? '',
          })),
        }
      })

      for (const v of axe.violations) {
        findings.push({
          route,
          severity: v.impact ?? 'moderate',
          issue: `${v.id}: ${v.description} (${v.nodes} nodes)`,
          sample: v.sample,
        })
      }

      const slug = route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'
      await page.screenshot({ path: join(OUT_DIR, `a11y-${slug}.png`), fullPage: false })
    } catch (err) {
      findings.push({ route, severity: 'critical', issue: String(err instanceof Error ? err.message : err) })
    }
  }

  await browser.close()

  const report = {
    base: BASE,
    routes: ROUTES.length,
    findings,
    consoleErrors: [...new Set(consoleErrors)].slice(0, 20),
  }
  writeFileSync(join(OUT_DIR, 'a11y-audit-report.json'), JSON.stringify(report, null, 2))

  const contrast = findings.filter((f) => f.issue?.includes('color-contrast'))
  console.log(`Audited ${ROUTES.length} routes — ${findings.length} findings (${contrast.length} contrast)`)
  for (const f of findings.slice(0, 25)) {
    console.log(`  [${f.severity}] ${f.route}: ${f.issue}`)
  }
  if (findings.some((f) => f.severity === 'critical')) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
