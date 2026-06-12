/**
 * Mint a yen-yen SDK ingest key via the Mushi admin console (Playwright),
 * set GitHub repo secrets, and verify POST /v1/ingest/metrics.
 *
 * Screenshots: .playwright-mcp/setup-ingest-*.png
 */
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

const BASE = process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464'
const YEN_YEN_PROJECT_HINT = process.env.MUSHI_YEN_YEN_PROJECT_ID ?? '6e7e0c3a-a777-4f1e-a699-6515993cf3bd'
const MUSHI_API_URL = 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api'
const OUT = resolve('C:/Users/kensa/Documents/GitHub/mushi-mushi/.playwright-mcp')
const REPO = 'kensaurus/yen-yen'

mkdirSync(OUT, { recursive: true })

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

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(1200)
  await page.locator('input[type="email"]').first().fill(email)
  await page.locator('input[type="password"]').first().fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 25000 })
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()

try {
  await login(page)
  await shot(page, 'setup-ingest-01-login')

  await page.goto(`${BASE}/projects?tab=list`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await page.waitForTimeout(2500)
  await shot(page, 'setup-ingest-02-projects')

  const projectId = await page.evaluate((hint) => {
    const buttons = [...document.querySelectorAll('[data-testid^="generate-key-"]')]
    for (const btn of buttons) {
      const id = btn.getAttribute('data-testid')?.replace('generate-key-', '') ?? ''
      const card = btn.closest('article, li, [class*="rounded"]') ?? btn.parentElement?.parentElement?.parentElement
      const text = card?.textContent?.toLowerCase() ?? ''
      if (text.includes('yen-yen') || text.includes('yen yen') || id === hint) return id
    }
    const fallback = buttons[0]?.getAttribute('data-testid')?.replace('generate-key-', '')
    return fallback ?? null
  }, YEN_YEN_PROJECT_HINT)

  if (!projectId) {
    throw new Error('No project with generate-key button found on /projects')
  }

  const genBtn = page.locator(`[data-testid="generate-key-${projectId}"]`)
  if (!(await genBtn.count())) {
    throw new Error(`Generate-key button not found for project ${projectId}`)
  }
  await genBtn.click()
  await page.waitForTimeout(2000)

  const rawTab = page.locator('[data-testid="revealed-key-mode-raw"]')
  if (await rawTab.count()) {
    await rawTab.click()
    await page.waitForTimeout(400)
  }

  const payload = page.locator('[data-testid="revealed-key-payload-raw"]')
  await payload.waitFor({ timeout: 10000 })
  const ingestKey = (await payload.innerText()).trim()
  if (!ingestKey || ingestKey.length < 20) {
    throw new Error('Revealed key payload empty or too short')
  }
  await shot(page, 'setup-ingest-03-key-revealed')

  // Persist for local verification only — never commit.
  writeFileSync(resolve(OUT, 'ingest-key.tmp'), ingestKey, { mode: 0o600 })

  execSync(`gh secret set MUSHI_API_URL --body "${MUSHI_API_URL}" --repo ${REPO}`, {
    stdio: 'inherit',
  })
  execSync(`gh secret set MUSHI_INGEST_KEY --body "${ingestKey}" --repo ${REPO}`, {
    stdio: 'inherit',
  })

  const verifyPayload = JSON.stringify({
    metrics: [{ metric_name: 'bundle.web.gzip_kb', dimension: 'combined', value: 42.5 }],
    findings: [],
  })

  const verifyRes = await fetch(`${MUSHI_API_URL}/v1/ingest/metrics`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mushi-Api-Key': ingestKey,
    },
    body: verifyPayload,
  })
  const verifyBody = await verifyRes.text()

  console.log(
    JSON.stringify(
      {
        ok: verifyRes.ok,
        status: verifyRes.status,
        secretsSet: ['MUSHI_API_URL', 'MUSHI_INGEST_KEY'],
        repo: REPO,
        verifyHead: verifyBody.slice(0, 200),
      },
      null,
      2,
    ),
  )

  if (!verifyRes.ok) {
    throw new Error(`Ingest verify failed: ${verifyRes.status} ${verifyBody}`)
  }

  process.exit(0)
} catch (err) {
  console.error('FAIL:', err.message)
  await shot(page, 'setup-ingest-error').catch(() => {})
  process.exit(1)
} finally {
  await browser.close()
}
