/**
 * PDCA browser test for Mushi admin — reads credentials from env (set by shell).
 * Screenshots saved under .playwright-mcp/
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:6464'
const PROJECT = '542b34e0-019e-41fe-b900-7b637717bb86'
const STORY = '506596e5-374c-4e3b-8461-19451fa4103f'
const OUT = 'C:/Users/kensa/.playwright-mcp'

mkdirSync(OUT, { recursive: true })

const email = process.env.TEST_USER_EMAIL
const password = process.env.TEST_USER_PASSWORD
if (!email || !password) {
  console.error('FAIL: TEST_USER_EMAIL / TEST_USER_PASSWORD not in env')
  process.exit(1)
}

const results = []

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await page.locator('input[type="email"]').first().fill(email)
  await page.locator('input[type="password"]').first().fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20000 })
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()

try {
  await login(page)
  results.push({ flow: 'login', ok: true, url: page.url() })
  await shot(page, 'mushi-01-after-login')

  // Legacy Slack URL → should redirect to qa-coverage with query params
  const legacy = `${BASE}/projects/${PROJECT}/qa-coverage/${STORY}`
  await page.goto(legacy, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  const legacyUrl = page.url()
  const legacyOk = legacyUrl.includes('/qa-coverage') && legacyUrl.includes(`story=${STORY}`)
  results.push({ flow: 'legacy-slack-redirect', ok: legacyOk, url: legacyUrl })
  await shot(page, 'mushi-02-legacy-redirect')

  // Canonical deep link
  const canonical = `${BASE}/qa-coverage?project=${PROJECT}&story=${STORY}`
  await page.goto(canonical, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  const body = await page.locator('body').innerText()
  const canonicalOk = !body.includes("can't find") && !body.includes('404') && page.url().includes('/qa-coverage')
  results.push({ flow: 'canonical-deep-link', ok: canonicalOk, url: page.url() })
  await shot(page, 'mushi-03-qa-coverage-deep-link')

  // Integrations / settings smoke
  await page.goto(`${BASE}/integrations/config?project=${PROJECT}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  const integBody = await page.locator('body').innerText()
  const integOk = !integBody.includes("can't find") && page.url().includes('/integrations')
  results.push({ flow: 'integrations-page', ok: integOk, url: page.url() })
  await shot(page, 'mushi-04-integrations')

  console.log(JSON.stringify({ results }, null, 2))
  const failed = results.filter((r) => !r.ok)
  process.exit(failed.length ? 1 : 0)
} catch (err) {
  console.error('FAIL:', err.message)
  await shot(page, 'mushi-error').catch(() => {})
  process.exit(1)
} finally {
  await browser.close()
}
