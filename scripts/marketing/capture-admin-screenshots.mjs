#!/usr/bin/env node
/**
 * Captures static dark-mode PNGs of authenticated admin pages for README/docs.
 *
 * Output: docs/screenshots/{slug}-dark.png  (or custom filename per entry)
 * Requires TEST_USER_EMAIL + TEST_USER_PASSWORD + Supabase anon key in .env.local
 *
 * Usage:
 *   node scripts/marketing/capture-admin-screenshots.mjs
 *   node scripts/marketing/capture-admin-screenshots.mjs --url http://localhost:6464 --force
 *   node scripts/marketing/capture-admin-screenshots.mjs --only dashboard,reports,report-detail
 */

import { mkdir } from 'node:fs/promises'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { loadEnv, parseArgs, REPO_ROOT, step, ok, warn, err } from './lib.mjs'

const OUT_DIR = join(REPO_ROOT, 'docs/screenshots')
const WIDTH = 1600
const HEIGHT = 1000
const LOAD_MS = 2200

const CAPTURES = [
  { slug: 'report-detail', file: 'report-detail-dark.png', route: '/reports', setup: 'report-detail' },
  { slug: 'dashboard', file: 'dashboard-dark.png', route: '/dashboard' },
  { slug: 'reports', file: 'reports-dark.png', route: '/reports' },
  { slug: 'fixes', file: 'fixes-dark.png', route: '/fixes' },
  { slug: 'connect', file: 'connect-dark.png', route: '/connect' },
  { slug: 'inventory', file: 'inventory-dark.png', route: '/inventory' },
  { slug: 'graph-surface', file: 'graph-surface-dark.png', route: '/graph', setup: 'graph-surface' },
  { slug: 'qa-coverage', file: 'qa-coverage-dark.png', route: '/qa-coverage' },
  { slug: 'explore', file: 'explore-dark.png', route: '/explore', setup: 'explore-graph' },
  { slug: 'skills', file: 'skills-dark.png', route: '/skills' },
  { slug: 'mcp', file: 'mcp-dark.png', route: '/mcp' },
  { slug: 'inbox', file: 'inbox-dark.png', route: '/inbox' },
  { slug: 'rewards', file: 'rewards-dark.png', route: '/rewards' },
]

const SKILL_DIR = join(
  process.env.USERPROFILE || process.env.HOME || '',
  '.cursor/skills/enhance-readme',
)
if (!existsSync(join(SKILL_DIR, 'node_modules'))) {
  err(`Playwright not found under ${SKILL_DIR}/node_modules — run: cd ${SKILL_DIR} && npm install`)
  process.exit(1)
}
const skillRequire = createRequire(join(SKILL_DIR, 'package.json'))
const { chromium } = skillRequire('playwright')

loadEnv()
for (const file of ['apps/admin/.env']) {
  const path = join(REPO_ROOT, file)
  if (!existsSync(path)) continue
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] == null || process.env[key] === '') process.env[key] = value
  }
}

const args = parseArgs()
const BASE_URL = (args.url || process.env.ADMIN_URL || 'http://localhost:6464').replace(/\/$/, '')
const force = Boolean(args.force)
const only =
  typeof args.only === 'string'
    ? args.only.split(',').map((s) => s.trim()).filter(Boolean)
    : []

function supabaseAuthStorageKey(url) {
  try {
    const ref = new URL(url).hostname.split('.')[0]
    return `sb-${ref}-auth-token`
  } catch {
    return 'sb-mushi-auth-token'
  }
}

async function fetchSupabaseSession() {
  const supabaseUrl =
    process.env.VITE_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    'https://dxptnwrhwsqckaftyymj.supabase.co'
  const anonKey =
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY
  const email = process.env.MUSHI_ADMIN_EMAIL ?? process.env.TEST_USER_EMAIL
  const password = process.env.MUSHI_ADMIN_PASSWORD ?? process.env.TEST_USER_PASSWORD
  if (!anonKey || !email || !password) {
    err('Need VITE_SUPABASE_ANON_KEY + TEST_USER_EMAIL + TEST_USER_PASSWORD in .env.local')
    process.exit(1)
  }
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const body = await res.text()
    err(`Supabase auth failed (${res.status}): ${body.slice(0, 180)}`)
    process.exit(1)
  }
  const json = await res.json()
  ok('Supabase session acquired')
  return {
    storageKey: supabaseAuthStorageKey(supabaseUrl),
    session: {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_in: json.expires_in,
      expires_at: json.expires_at,
      token_type: json.token_type,
      user: json.user,
    },
  }
}

async function isLoginPage(page) {
  if (page.url().includes('/login')) return true
  const hasPassword = await page.locator('input[type="password"]').isVisible({ timeout: 400 }).catch(() => false)
  const hasSignIn = await page.getByRole('button', { name: /sign in|log in/i }).isVisible({ timeout: 300 }).catch(() => false)
  return hasPassword && hasSignIn
}

async function quietOverlays(page) {
  await page
    .evaluate(() => {
      try {
        localStorage.setItem('mushi:tour-v1-completed', 'true')
        localStorage.setItem('mushi:firstRunTour:done', '1')
        localStorage.setItem('mushi:mode-intro-seen', '1')
        localStorage.setItem('mushi:mode', 'advanced')
      } catch {}
    })
    .catch(() => {})
  const closeBtn = page.getByRole('button', { name: /^close$/i }).first()
  if (await closeBtn.isVisible({ timeout: 250 }).catch(() => false)) {
    await closeBtn.click({ timeout: 1000 }).catch(() => {})
  }
}

async function runSetup(page, setup) {
  if (setup === 'report-detail') {
    await page.locator('table tbody tr, [role="row"]').first().click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(1500)
    return
  }
  if (setup === 'graph-surface') {
    const surfaceTab = page.getByRole('tab', { name: /surface/i }).or(page.getByRole('button', { name: /surface/i }))
    if (await surfaceTab.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await surfaceTab.first().click({ timeout: 2000 }).catch(() => {})
      await page.waitForTimeout(1200)
    }
    await page.locator('canvas, svg.react-flow__renderer').first().hover({ timeout: 2500 }).catch(() => {})
    await page.waitForTimeout(800)
    return
  }
  if (setup === 'explore-graph') {
    const graphTab = page.getByRole('tab', { name: /^graph$/i }).or(page.getByRole('button', { name: /^graph$/i }))
    if (await graphTab.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await graphTab.first().click({ timeout: 2000 }).catch(() => {})
      await page.waitForTimeout(1200)
    }
    await page.locator('canvas, svg.react-flow__renderer').first().hover({ timeout: 2500 }).catch(() => {})
    await page.waitForTimeout(800)
    return
  }
}

async function settlePage(page, slug) {
  if (slug === 'fixes' || slug === 'repo') {
    await page.locator('article, [data-testid="fix-card"]').first().hover({ timeout: 2000 }).catch(() => {})
  }
  if (slug === 'graph-surface' || slug === 'explore') {
    await page.locator('canvas, svg.react-flow__renderer').first().hover({ timeout: 2000 }).catch(() => {})
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'auto' }))
  await page.waitForTimeout(400)
}

async function captureOne(entry, sessionBundle, browser) {
  const outPath = join(OUT_DIR, entry.file)
  if (!force && existsSync(outPath)) {
    warn(`skip ${entry.slug} — ${entry.file} exists (use --force)`)
    return { slug: entry.slug, skipped: true }
  }

  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  })
  await ctx.addInitScript(({ storageKey, session }) => {
    window.localStorage.setItem(storageKey, JSON.stringify(session))
    try {
      localStorage.setItem('mushi:tour-v1-completed', 'true')
      localStorage.setItem('mushi:firstRunTour:done', '1')
      localStorage.setItem('mushi:mode-intro-seen', '1')
      localStorage.setItem('mushi:mode', 'advanced')
    } catch {}
  }, sessionBundle)
  const page = await ctx.newPage()

  step(`${entry.slug} → ${entry.route}`)
  await page.goto(`${BASE_URL}${entry.route}`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})
  await page.waitForTimeout(LOAD_MS)
  await quietOverlays(page)

  if (await isLoginPage(page)) {
    warn(`  ${entry.slug} still on login — skipping`)
    await ctx.close()
    return { slug: entry.slug, skipped: true, reason: 'login' }
  }

  if (entry.setup) await runSetup(page, entry.setup)
  await settlePage(page, entry.slug)
  await page.waitForTimeout(800)

  await page.screenshot({ path: outPath, fullPage: false })
  const size = statSync(outPath).size
  ok(`${entry.file} (${(size / 1024).toFixed(0)} KB)`)
  if (size > 10 * 1024 * 1024) warn(`  ${entry.file} exceeds 10 MB GitHub limit`)

  await ctx.close()
  return { slug: entry.slug, skipped: false, bytes: size }
}

;(async () => {
  await mkdir(OUT_DIR, { recursive: true })

  let captures = CAPTURES
  if (only.length) captures = captures.filter((c) => only.includes(c.slug))

  step(`Capturing ${captures.length} PNGs @ ${BASE_URL} (${WIDTH}×${HEIGHT})`)
  const sessionBundle = await fetchSupabaseSession()
  const browser = await chromium.launch({ headless: !args.headed })

  const results = []
  for (const entry of captures) {
    try {
      results.push(await captureOne(entry, sessionBundle, browser))
    } catch (e) {
      err(`${entry.slug}: ${e.message || e}`)
      results.push({ slug: entry.slug, error: true })
    }
  }

  await browser.close()
  step('Done.')
  console.log(
    JSON.stringify(
      {
        total: captures.length,
        captured: results.filter((r) => !r.skipped && !r.error).length,
        skipped: results.filter((r) => r.skipped).length,
        failed: results.filter((r) => r.error).length,
      },
      null,
      2,
    ),
  )
})().catch((e) => {
  err(e.stack || e.message || String(e))
  process.exit(1)
})
