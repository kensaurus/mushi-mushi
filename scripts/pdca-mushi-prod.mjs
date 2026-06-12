/**
 * Production PDCA test for merged Slack URL fix on kensaur.us
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = 'https://kensaur.us/mushi-mushi/admin'
const PROJECT = '542b34e0-019e-41fe-b900-7b637717bb86'
const STORY = '506596e5-374c-4e3b-8461-19451fa4103f'
const OUT = 'C:/Users/kensa/.playwright-mcp'

mkdirSync(OUT, { recursive: true })

const email = process.env.TEST_USER_EMAIL
const password = process.env.TEST_USER_PASSWORD
if (!email || !password) process.exit(1)

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  await page.locator('input[type="email"]').first().fill(email)
  await page.locator('input[type="password"]').first().fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 25000 })
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

try {
  await login(page)
  const legacy = `${BASE}/projects/${PROJECT}/qa-coverage/${STORY}`
  await page.goto(legacy, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const url = page.url()
  const body = await page.locator('body').innerText()
  const ok = url.includes('/qa-coverage') && url.includes(`story=${STORY}`) && !body.includes("can't find")
  await page.screenshot({ path: `${OUT}/mushi-prod-legacy-redirect.png` })
  console.log(JSON.stringify({ ok, url, has404: body.includes("can't find") }, null, 2))
  process.exit(ok ? 0 : 1)
} finally {
  await browser.close()
}
