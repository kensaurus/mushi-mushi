#!/usr/bin/env node
/**
 * scripts/audit-buttons.mjs
 *
 * Crawls the admin SPA with Playwright, visits every beginner + advanced page,
 * and clicks every safe button/link/role=button on each. Records:
 *   - 4xx / 5xx network responses (with URL + response body when available)
 *   - Console errors raised by the click
 *   - No-op clicks (no DOM change AND no network call within 800ms)
 *
 * Output: docs/audit-2026-04-20/dead-buttons.json
 *         docs/audit-2026-04-20/dead-buttons.md (human-readable summary)
 *
 * Usage:
 *   MUSHI_ADMIN_URL=http://localhost:6464 \
 *   MUSHI_ADMIN_EMAIL=you@example.com \
 *   MUSHI_ADMIN_PASSWORD=secret \
 *   node scripts/audit-buttons.mjs
 *
 * Env overrides:
 *   MUSHI_ADMIN_URL      default http://localhost:6464
 *   MUSHI_ADMIN_PATHS    comma-separated path list (default = full beginner+advanced manifest)
 *   MUSHI_ADMIN_TIMEOUT  per-click wait in ms (default 1500)
 *   MUSHI_HEADFUL=1      run with a visible browser (default headless)
 *
 * Requirements: pnpm add -D playwright (no MCP needed; uses Chromium directly).
 */

import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'

const ADMIN_URL = (process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464').replace(/\/$/, '')
const EMAIL = process.env.MUSHI_ADMIN_EMAIL
const PASSWORD = process.env.MUSHI_ADMIN_PASSWORD
const HEADFUL = process.env.MUSHI_HEADFUL === '1'
const PER_CLICK_TIMEOUT = Number(process.env.MUSHI_ADMIN_TIMEOUT ?? 1500)

const DEFAULT_PATHS = [
  '/',
  '/onboarding',
  '/reports',
  '/fixes',
  '/judge',
  '/health',
  '/integrations',
  '/settings',
  '/projects',
  // advanced surfaces
  '/graph',
  '/research',
  '/query',
  '/prompt-lab',
  '/anti-gaming',
  '/dlq',
  '/audit',
  '/sso',
  '/marketplace',
  '/billing',
  '/notifications',
  '/intelligence',
  '/compliance',
]
const PATHS = (process.env.MUSHI_ADMIN_PATHS?.split(',').map((s) => s.trim()).filter(Boolean)) ?? DEFAULT_PATHS

// Buttons whose names match these patterns are *skipped* — clicking them would
// log the user out, delete data, or open external URLs. We still record them
// for completeness in the report.
const SKIP_PATTERNS = [
  /sign\s*out/i,
  /log\s*out/i,
  /delete/i,
  /remove/i,
  /destroy/i,
  /revoke/i,
  /reset.*account/i,
  /^open in/i,
  /^view in/i,
  /upgrade/i,
  /buy/i,
  /checkout/i,
  /promote/i,
  /merge/i,
  /dispatch fix/i, // fires real LLM spend
  /run judge/i,
  /watch a bug travel/i, // creates real synthetic reports
]

const findings = {
  meta: {
    runAt: new Date().toISOString(),
    adminUrl: ADMIN_URL,
    perClickTimeoutMs: PER_CLICK_TIMEOUT,
  },
  pages: [],
}

async function login(page) {
  if (!EMAIL || !PASSWORD) {
    console.warn('⚠️  MUSHI_ADMIN_EMAIL/PASSWORD not set — assuming an existing session cookie.')
    return
  }
  await page.goto(`${ADMIN_URL}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.click('button[type="submit"]'),
  ])
}

async function auditPage(browser, urlPath) {
  const context = await browser.newContext()
  const page = await context.newPage()

  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push({ text: msg.text(), location: msg.location() })
  })

  const networkErrors = []
  page.on('response', async (res) => {
    if (res.status() >= 400) {
      let body = ''
      try {
        body = (await res.text()).slice(0, 400)
      } catch {
        body = '<unreadable>'
      }
      networkErrors.push({ url: res.url(), status: res.status(), body })
    }
  })

  const fullUrl = `${ADMIN_URL}${urlPath}`
  try {
    await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 15000 })
  } catch (err) {
    findings.pages.push({
      path: urlPath,
      navigationError: String(err),
      buttons: [],
    })
    await context.close()
    return
  }

  // Snapshot every clickable so we don't miss ones that re-mount mid-iteration.
  const handles = await page.$$('button, a[role="button"], [data-action]')
  const pageReport = {
    path: urlPath,
    url: fullUrl,
    totalButtons: handles.length,
    buttons: [],
    consoleErrors,
    networkErrors,
  }

  for (let i = 0; i < handles.length; i++) {
    const handle = handles[i]
    let label = ''
    try {
      label = (await handle.innerText()).trim().replace(/\s+/g, ' ').slice(0, 60)
    } catch {
      label = '<no text>'
    }
    if (!label) {
      const aria = await handle.getAttribute('aria-label').catch(() => null)
      label = aria ?? `<button #${i}>`
    }

    const skipped = SKIP_PATTERNS.some((re) => re.test(label))
    if (skipped) {
      pageReport.buttons.push({ index: i, label, skipped: true, reason: 'unsafe-pattern' })
      continue
    }

    const beforeUrl = page.url()
    const beforeHtml = await page.content().then((h) => h.length).catch(() => 0)
    let networkCalls = 0
    const onReq = () => { networkCalls++ }
    page.on('request', onReq)

    let clickError = null
    try {
      await handle.click({ timeout: 1500, trial: false })
      await page.waitForTimeout(PER_CLICK_TIMEOUT)
    } catch (err) {
      clickError = String(err).split('\n')[0]
    }

    page.off('request', onReq)
    const afterUrl = page.url()
    const afterHtml = await page.content().then((h) => h.length).catch(() => 0)
    const isDead = !clickError && afterUrl === beforeUrl && Math.abs(afterHtml - beforeHtml) < 8 && networkCalls === 0

    pageReport.buttons.push({
      index: i,
      label,
      networkCalls,
      navigated: afterUrl !== beforeUrl,
      domChanged: Math.abs(afterHtml - beforeHtml) >= 8,
      clickError,
      isDead,
    })

    // Reset to the page so the next iteration sees the same handles.
    if (afterUrl !== beforeUrl) {
      try {
        await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 15000 })
      } catch {
        break
      }
    }
  }

  findings.pages.push(pageReport)
  await context.close()
}

function summarise() {
  const totalButtons = findings.pages.reduce((s, p) => s + (p.buttons?.length ?? 0), 0)
  const dead = []
  const errored = []
  const networkBad = []
  const consoleBad = []
  for (const p of findings.pages) {
    for (const b of p.buttons ?? []) {
      if (b.isDead) dead.push({ path: p.path, label: b.label })
      if (b.clickError) errored.push({ path: p.path, label: b.label, err: b.clickError })
    }
    if (p.networkErrors?.length) networkBad.push({ path: p.path, count: p.networkErrors.length, samples: p.networkErrors.slice(0, 3) })
    if (p.consoleErrors?.length) consoleBad.push({ path: p.path, count: p.consoleErrors.length, samples: p.consoleErrors.slice(0, 3) })
  }
  return { totalButtons, dead, errored, networkBad, consoleBad }
}

function renderMarkdown(s) {
  const lines = []
  lines.push(`# Admin button sweep — ${findings.meta.runAt}`)
  lines.push('')
  lines.push(`Crawled \`${PATHS.length}\` pages, clicked **${s.totalButtons}** buttons.`)
  lines.push('')
  lines.push(`## Dead buttons (${s.dead.length})`)
  if (s.dead.length === 0) lines.push('_None — every safe click produced a navigation, DOM update, or network call._')
  for (const d of s.dead) lines.push(`- \`${d.path}\` → **${d.label}**`)
  lines.push('')
  lines.push(`## Click errors (${s.errored.length})`)
  for (const e of s.errored) lines.push(`- \`${e.path}\` → **${e.label}** — ${e.err}`)
  if (s.errored.length === 0) lines.push('_None._')
  lines.push('')
  lines.push(`## Network 4xx / 5xx (${s.networkBad.length} pages)`)
  for (const n of s.networkBad) {
    lines.push(`- \`${n.path}\` (${n.count} bad responses)`)
    for (const sample of n.samples) lines.push(`  - \`${sample.status}\` ${sample.url}`)
  }
  if (s.networkBad.length === 0) lines.push('_None._')
  lines.push('')
  lines.push(`## Console errors (${s.consoleBad.length} pages)`)
  for (const c of s.consoleBad) {
    lines.push(`- \`${c.path}\` (${c.count} errors)`)
    for (const sample of c.samples) lines.push(`  - ${sample.text.slice(0, 200)}`)
  }
  if (s.consoleBad.length === 0) lines.push('_None._')
  lines.push('')
  lines.push('Skipped patterns (clicked-but-not-fired): sign out, delete, dispatch fix, run judge, watch a bug, promote, merge, upgrade, buy.')
  return lines.join('\n')
}

async function main() {
  console.log(`▶ Crawling ${PATHS.length} pages on ${ADMIN_URL}…`)
  const browser = await chromium.launch({ headless: !HEADFUL })

  const session = await browser.newContext()
  const sessionPage = await session.newPage()
  await login(sessionPage)
  const storage = await session.storageState()
  await session.close()

  const tenant = await browser.newContext({ storageState: storage })
  for (const p of PATHS) {
    process.stdout.write(`  · ${p} … `)
    const tmp = await browser.newContext({ storageState: storage })
    await auditPage({ newContext: () => tmp }, p)
    await tmp.close()
    console.log('done')
  }
  await tenant.close()
  await browser.close()

  const summary = summarise()
  const outDir = path.join('docs', 'audit-2026-04-20')
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(path.join(outDir, 'dead-buttons.json'), JSON.stringify({ summary, ...findings }, null, 2))
  await fs.writeFile(path.join(outDir, 'dead-buttons.md'), renderMarkdown(summary))
  console.log(`\n✓ Wrote docs/audit-2026-04-20/dead-buttons.{json,md}`)
  console.log(`  Dead: ${summary.dead.length} · Errors: ${summary.errored.length} · Bad network: ${summary.networkBad.length} · Console errors: ${summary.consoleBad.length}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
