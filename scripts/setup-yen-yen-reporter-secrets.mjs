/**
 * FILE: scripts/setup-yen-yen-reporter-secrets.mjs
 * PURPOSE: Push yen-yen reporter SDK env (EXPO_PUBLIC_MUSHI_*) to GitHub
 *          repo vars/secrets so release-mobile store builds bake Mushi keys.
 *
 * Reads apps/mobile/.env.local from the yen-yen checkout by default.
 * Does NOT mint keys — pass --mint only when you intentionally want Playwright
 * to generate a fresh key via the admin console (orphans prior keys).
 *
 * Security: uses gh stdin/body-file redirection (see GitHub CLI docs).
 * Screenshots: .playwright-mcp/setup-reporter-*.png
 */
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464'
const YEN_YEN_PROJECT_HINT = process.env.MUSHI_YEN_YEN_PROJECT_ID ?? '6e7e0c3a-a777-4f1e-a699-6515993cf3bd'
const MUSHI_API_URL =
  process.env.MUSHI_API_URL_OVERRIDE ?? 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api'
const OUT = resolve(process.env.PLAYWRIGHT_OUT_DIR ?? resolve(__dirname, '../.playwright-mcp'))
const REPO = process.env.MUSHI_TARGET_REPO ?? 'kensaurus/yen-yen'
const YEN_YEN_ROOT = resolve(process.env.YEN_YEN_ROOT ?? resolve(__dirname, '../../yen-yen'))
const ENV_LOCAL = resolve(
  process.env.YEN_YEN_ENV_LOCAL ?? resolve(YEN_YEN_ROOT, 'apps/mobile/.env.local'),
)

const allowMint = process.argv.includes('--mint')

mkdirSync(OUT, { recursive: true })

function loadEnvFile(file) {
  const out = {}
  try {
    const text = readFileSync(file, 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (!m) continue
      let val = m[2].trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      out[m[1]] = val
    }
  } catch {
    /* optional */
  }
  return out
}

function loadDotenv(file) {
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
  } catch {
    /* optional */
  }
}

loadDotenv(resolve(__dirname, '../.env.local'))

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
}

async function login(page) {
  const email = process.env.TEST_USER_EMAIL
  const password = process.env.TEST_USER_PASSWORD
  if (!email || !password) {
    throw new Error('TEST_USER_EMAIL / TEST_USER_PASSWORD required for --mint Playwright path')
  }
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(1200)
  await page.locator('input[type="email"]').first().fill(email)
  await page.locator('input[type="password"]').first().fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 25000 })
}

async function mintReporterKeyViaConsole(page) {
  await login(page)
  await shot(page, 'setup-reporter-01-login')

  await page.goto(`${BASE}/projects?tab=list`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2500)

  const projectId = await page.evaluate((hint) => {
    const buttons = [...document.querySelectorAll('[data-testid^="generate-key-"]')]
    for (const btn of buttons) {
      const id = btn.getAttribute('data-testid')?.replace('generate-key-', '') ?? ''
      const card = btn.closest('article, li, [class*="rounded"]') ?? btn.parentElement?.parentElement?.parentElement
      const text = card?.textContent?.toLowerCase() ?? ''
      if (text.includes('yen-yen') || text.includes('yen yen') || id === hint) return id
    }
    return buttons[0]?.getAttribute('data-testid')?.replace('generate-key-', '') ?? null
  }, YEN_YEN_PROJECT_HINT)

  if (!projectId) throw new Error('No yen-yen project with generate-key button found')

  await page.locator(`[data-testid="generate-key-${projectId}"]`).click()
  await page.waitForTimeout(2000)

  const expoTab = page.locator('[data-testid="revealed-key-mode-expo"]')
  if (await expoTab.count()) {
    await expoTab.click()
    await page.waitForTimeout(400)
  }

  const payload = page.locator('[data-testid="revealed-key-payload-expo"]')
  if (!(await payload.count())) {
    await page.locator('[data-testid="revealed-key-mode-raw"]').click()
    await page.waitForTimeout(400)
    const raw = (await page.locator('[data-testid="revealed-key-payload-raw"]').innerText()).trim()
    return { projectId: YEN_YEN_PROJECT_HINT, apiKey: raw, endpoint: MUSHI_API_URL }
  }

  const text = await payload.innerText()
  const env = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^(EXPO_PUBLIC_MUSHI_[A-Z_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  await shot(page, 'setup-reporter-02-key-revealed')
  return {
    projectId: env.EXPO_PUBLIC_MUSHI_PROJECT_ID ?? YEN_YEN_PROJECT_HINT,
    apiKey: env.EXPO_PUBLIC_MUSHI_API_KEY,
    endpoint: env.EXPO_PUBLIC_MUSHI_API_ENDPOINT ?? MUSHI_API_URL,
  }
}

function ghSetVariable(name, filePath) {
  execSync(`gh variable set ${name} --body-file "${filePath}" --repo ${REPO}`, { stdio: 'inherit' })
}

function ghSetSecret(name, filePath) {
  // stdin redirect — avoids secret in process argv (GitHub CLI recommendation)
  execSync(`gh secret set ${name} < "${filePath}" --repo ${REPO}`, { stdio: 'inherit' })
}

async function main() {
  let projectId = ''
  let apiKey = ''
  let endpoint = MUSHI_API_URL

  if (existsSync(ENV_LOCAL)) {
    const env = loadEnvFile(ENV_LOCAL)
    projectId = env.EXPO_PUBLIC_MUSHI_PROJECT_ID ?? ''
    apiKey = env.EXPO_PUBLIC_MUSHI_API_KEY ?? ''
    endpoint = env.EXPO_PUBLIC_MUSHI_API_ENDPOINT ?? MUSHI_API_URL
    console.log(`Loaded reporter env from ${ENV_LOCAL}`)
  }

  if (!projectId || !apiKey) {
    if (!allowMint) {
      console.error(
        'FAIL: EXPO_PUBLIC_MUSHI_PROJECT_ID and EXPO_PUBLIC_MUSHI_API_KEY missing.\n' +
          `  Expected: ${ENV_LOCAL}\n` +
          '  Or re-run with --mint to generate a new key via Playwright (orphans prior keys).',
      )
      process.exit(1)
    }
    console.warn('WARN: --mint will generate a NEW API key in the console')
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    try {
      const revealed = await mintReporterKeyViaConsole(page)
      projectId = revealed.projectId
      apiKey = revealed.apiKey
      endpoint = revealed.endpoint
    } finally {
      await browser.close()
    }
  }

  const pidFile = resolve(OUT, 'reporter-project-id.tmp')
  const keyFile = resolve(OUT, 'reporter-api-key.tmp')
  const endpointFile = resolve(OUT, 'reporter-endpoint.tmp')
  writeFileSync(pidFile, projectId, { mode: 0o600 })
  writeFileSync(keyFile, apiKey, { mode: 0o600 })
  writeFileSync(endpointFile, endpoint, { mode: 0o600 })

  ghSetVariable('EXPO_PUBLIC_MUSHI_PROJECT_ID', pidFile)
  ghSetSecret('EXPO_PUBLIC_MUSHI_API_KEY', keyFile)
  ghSetVariable('EXPO_PUBLIC_MUSHI_API_ENDPOINT', endpointFile)

  const verifyRes = await fetch(`${endpoint.replace(/\/$/, '')}/v1/sdk/config`, {
    headers: {
      'X-Mushi-Api-Key': apiKey,
      'X-Mushi-Project': projectId,
      'X-Mushi-Internal': 'reporter-setup-verify',
    },
  })

  console.log(
    JSON.stringify(
      {
        ok: verifyRes.ok,
        status: verifyRes.status,
        github: {
          vars: ['EXPO_PUBLIC_MUSHI_PROJECT_ID', 'EXPO_PUBLIC_MUSHI_API_ENDPOINT'],
          secrets: ['EXPO_PUBLIC_MUSHI_API_KEY'],
        },
        repo: REPO,
        envLocal: existsSync(ENV_LOCAL) ? ENV_LOCAL : null,
        note: 'Trigger release-mobile (both platforms) — OTA cannot inject EXPO_PUBLIC_*.',
      },
      null,
      2,
    ),
  )

  if (!verifyRes.ok) {
    console.warn(`WARN: SDK config verify returned ${verifyRes.status} — keys were still written to GitHub`)
  }
}

main().catch((err) => {
  console.error('FAIL:', err.message)
  process.exit(1)
})
