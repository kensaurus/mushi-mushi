#!/usr/bin/env node
/**
 * Wave 5 UX baseline — authenticated posture + duplicate-hint audit.
 * Requires: MUSHI_ADMIN_URL, VITE_SUPABASE_*, TEST_USER_* (see admin-chrome-budget.spec.ts)
 *
 * Usage: node scripts/audit-admin-ux-wave5.mjs
 * Output: docs/admin/UX-WAVE5-BASELINE.json + screenshots under apps/admin/.playwright-mcp/admin-ux-wave5/
 */

import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const OPERATOR_ROUTES = [
  '/dashboard', '/reports', '/inbox', '/fixes', '/repo', '/health', '/connect',
  '/qa-coverage', '/rewards', '/settings', '/projects', '/billing', '/cost',
  '/judge', '/drift', '/code-health', '/query', '/audit', '/lessons', '/compliance',
  '/sso', '/queue', '/prompt-lab', '/skills', '/marketplace', '/anomalies',
  '/experiments', '/feedback', '/storage', '/research', '/iterate', '/intelligence',
  '/notifications', '/releases', '/fullstack-audit', '/content', '/feature-board',
  '/anti-gaming', '/users', '/organization/members', '/integrations', '/graph',
  '/explore', '/inventory', '/onboarding', '/setup-copilot', '/mcp',
]

const ADMIN_URL = (process.env.MUSHI_ADMIN_URL ?? 'http://127.0.0.1:6464').replace(/\/$/, '')
const PROJECT_ID = process.env.MUSHI_WAVE5_PROJECT_ID ?? '67a6453c-375d-41d7-833a-b33471159442'

function loadEnv(rel) {
  const out = {}
  try {
    for (const line of readFileSync(resolve(ROOT, rel), 'utf8').split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq <= 0) continue
      out[t.slice(0, eq)] = t.slice(eq + 1).replace(/^["']|["']$/g, '')
    }
  } catch { /* optional */ }
  return out
}

const rootEnv = loadEnv('.env.local')
const adminEnv = loadEnv('apps/admin/.env')
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? adminEnv.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? adminEnv.VITE_SUPABASE_ANON_KEY ?? ''
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL ?? rootEnv.TEST_USER_EMAIL ?? ''
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD ?? rootEnv.TEST_USER_PASSWORD ?? ''

const ref = SUPABASE_URL.match(/https:\/\/([^.]+)\./)?.[1] ?? 'dxptnwrhwsqckaftyymj'
const storageKey = `sb-${ref}-auth-token`
const OUT_DIR = resolve(ROOT, 'apps/admin/.playwright-mcp/admin-ux-wave5')

async function seedSession(page, mode) {
  const res = await page.request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    data: { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD },
  })
  if (!res.ok()) throw new Error(`Auth failed: ${res.status()}`)
  const session = await res.json()
  await page.addInitScript(
    ({ key, sessionPayload, projectId, adminMode }) => {
      const expiresAt = sessionPayload.expires_at ?? Math.floor(Date.now() / 1000) + (sessionPayload.expires_in ?? 3600)
      localStorage.setItem(key, JSON.stringify({ ...sessionPayload, expires_at: expiresAt }))
      localStorage.setItem('mushi:active_project_id', projectId)
      localStorage.setItem('mushi:mode', adminMode)
    },
    { key: storageKey, sessionPayload: session, projectId: PROJECT_ID, adminMode: mode },
  )
}

async function auditRoute(page, route, mode, viewport) {
  const slug = route.replace(/\//g, '_').replace(/^_/, '') || 'root'
  const url = `${ADMIN_URL}${route}?project=${PROJECT_ID}`
  await page.setViewportSize(viewport)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.getByRole('button', { name: 'Dismiss' }).click({ timeout: 2000 }).catch(() => {})
  await page.waitForTimeout(400)

  const metrics = await page.evaluate(() => {
    const posture = document.querySelector('[data-page-posture]')
    const rows = posture ? posture.querySelectorAll(':scope > *').length : 0
    const fold = document.getElementById('main-content')
    const texts = []
    if (fold) {
      const walker = document.createTreeWalker(fold, NodeFilter.SHOW_TEXT)
      let n
      while ((n = walker.nextNode())) {
        const t = n.textContent?.trim()
        if (t && t.length > 24) texts.push(t.slice(0, 120))
      }
    }
    const dupes = texts.filter((t, i) => texts.indexOf(t) !== i)
    return {
      rows,
      hasPosture: Boolean(posture),
      duplicateHints: [...new Set(dupes)].slice(0, 5),
    }
  })

  mkdirSync(OUT_DIR, { recursive: true })
  const file = `${slug}-${mode}-${viewport.width}.png`
  await page.screenshot({ path: resolve(OUT_DIR, file), fullPage: false })

  return { route, mode, viewport: viewport.width, url, ...metrics, screenshot: file }
}

async function main() {
  if (!SUPABASE_URL || !TEST_USER_EMAIL) {
    console.error('Missing auth env — see admin-chrome-budget.spec.ts')
    process.exit(1)
  }

  const browser = await chromium.launch()
  const results = []

  for (const mode of ['beginner', 'advanced']) {
    const context = await browser.newContext()
    const page = await context.newPage()
    await seedSession(page, mode)

    for (const route of OPERATOR_ROUTES) {
      for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 700 }, { width: 800, height: 700 }]) {
        try {
          results.push(await auditRoute(page, route, mode, viewport))
        } catch (err) {
          results.push({ route, mode, viewport: viewport.width, error: String(err) })
        }
      }
    }
    await context.close()
  }

  await browser.close()
  const outJson = resolve(ROOT, 'docs/admin/UX-WAVE5-BASELINE.json')
  mkdirSync(dirname(outJson), { recursive: true })
  writeFileSync(outJson, JSON.stringify(results, null, 2))
  console.log(`Wrote ${results.length} entries → docs/admin/UX-WAVE5-BASELINE.json`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
