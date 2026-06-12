/**
 * PDCA browser test for Code Health page — end-to-end user flow.
 * Screenshots saved under .playwright-mcp/
 */
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464'
const YEN_YEN_PROJECT = process.env.MUSHI_YEN_YEN_PROJECT_ID ?? '542b34e0-019e-41fe-b900-7b637717bb86'
const OUT = resolve('C:/Users/kensa/Documents/GitHub/mushi-mushi/.playwright-mcp')

mkdirSync(OUT, { recursive: true })

// Load .env.local without printing secrets
function loadEnv(file) {
  try {
    const text = readFileSync(file, 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (!m) continue
      const key = m[1]
      let val = m[2].trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = val
    }
  } catch { /* optional */ }
}
loadEnv(resolve('C:/Users/kensa/Documents/GitHub/mushi-mushi/.env.local'))

const email = process.env.TEST_USER_EMAIL
const password = process.env.TEST_USER_PASSWORD
if (!email || !password) {
  console.error('FAIL: TEST_USER_EMAIL / TEST_USER_PASSWORD not in env')
  process.exit(1)
}

const results = []
const networkLog = []

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(1500)
  await page.locator('input[type="email"]').first().fill(email)
  await page.locator('input[type="password"]').first().fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 25000 })
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()

page.on('response', (res) => {
  const url = res.url()
  if (url.includes('/v1/admin/code-health')) {
    networkLog.push({ url, status: res.status(), method: res.request().method() })
  }
})

try {
  // ── Flow 1: Login ──────────────────────────────────────────────────────
  await login(page)
  results.push({ flow: 'login', ok: true, url: page.url() })
  await shot(page, 'code-health-01-after-login')

  // ── Flow 2: Direct navigate to Code Health with yen-yen project ──────
  await page.goto(`${BASE}/code-health?project=${YEN_YEN_PROJECT}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await page.waitForTimeout(3000)

  const body = await page.locator('body').innerText()
  const hasTitle = body.includes('Code Health')
  const hasScorecard = body.includes('Issues found') || body.includes('Warnings') || body.includes('All clear')
  // Scroll to god-file section (below the fold on 900px viewport)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(800)
  const fullBody = await page.locator('body').innerText()
  const hasGodFiles =
    fullBody.includes('God-file findings') &&
    (fullBody.includes('insights.tsx') || fullBody.includes('QA-TEST') || fullBody.includes('.tsx'))
  const hasGodFilesAboveFold =
    body.includes('God-file findings') &&
    (body.includes('insights.tsx') || body.includes('QA-TEST') || body.includes('Error'))
  const hasBundleTrends = body.includes('Bundle-size trends') || body.includes('KB')
  const hasAuditCrossLink = body.includes('Full-Stack Audit')
  const apiHit = networkLog.some((n) => n.status === 200)

  results.push({
    flow: 'code-health-page-load',
    ok: hasTitle && hasScorecard,
    details: {
      hasTitle,
      hasScorecard,
      hasGodFiles,
      hasGodFilesAboveFold,
      hasBundleTrends,
      hasAuditCrossLink,
      apiHit,
      networkLog,
    },
    url: page.url(),
  })
  await shot(page, 'code-health-02-page-loaded')

  // ── Flow 3: Refresh button ───────────────────────────────────────────
  const refreshBtn = page.getByRole('button', { name: /refresh/i })
  if (await refreshBtn.count()) {
    const beforeCount = networkLog.length
    await refreshBtn.click()
    await page.waitForTimeout(2500)
    const afterCount = networkLog.length
    results.push({
      flow: 'refresh-button',
      ok: afterCount > beforeCount,
      details: { requestsBefore: beforeCount, requestsAfter: afterCount },
    })
    await shot(page, 'code-health-03-after-refresh')
  } else {
    results.push({ flow: 'refresh-button', ok: false, details: 'Refresh button not found' })
  }

  // ── Flow 4: Sidebar nav discovery (quickstart + beginner labels) ─────
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  const navLink = page.getByRole('link', { name: /code health/i })
  let navOk = false
  if ((await navLink.count()) > 0) {
    await navLink.first().click()
    await page.waitForTimeout(2500)
    const navBody = await page.locator('body').innerText()
    navOk = page.url().includes('/code-health') && navBody.includes('Code Health')
    await shot(page, 'code-health-04-sidebar-nav')
  }

  // ── Flow 4b: Command palette discovery ─────────────────────────────────
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(800)
  const paletteInput = page.locator('[cmdk-input], input[placeholder*="Search"], input[aria-label*="Search"]').first()
  if (await paletteInput.count()) {
    await paletteInput.fill('code health')
    await page.waitForTimeout(600)
    const paletteItem = page.locator('[cmdk-item], [role="option"]').filter({ hasText: /code health/i }).first()
    if (await paletteItem.count()) {
      await paletteItem.click()
      await page.waitForTimeout(2500)
      navOk = navOk || (page.url().includes('/code-health'))
      await shot(page, 'code-health-05-command-palette')
    }
  }
  results.push({ flow: 'sidebar-or-palette-nav', ok: navOk, url: page.url() })

  // ── Flow 5: Console errors ───────────────────────────────────────────
  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  results.push({
    flow: 'console-clean',
    ok: consoleErrors.length === 0,
    details: { errors: consoleErrors.slice(0, 5) },
  })

  console.log(JSON.stringify({ results, networkLog }, null, 2))
  const failed = results.filter((r) => !r.ok)
  process.exit(failed.length ? 1 : 0)
} catch (err) {
  console.error('FAIL:', err.message)
  await shot(page, 'code-health-error').catch(() => {})
  process.exit(1)
} finally {
  await browser.close()
}
