#!/usr/bin/env node
/**
 * Records one animated GIF per admin docs page.
 *
 * Output: docs/screenshots/{slug}-demo.gif
 * Requires TEST_USER_EMAIL + TEST_USER_PASSWORD + Supabase URL/anon in .env.local
 *
 * Usage:
 *   node scripts/marketing/record-admin-page-gifs.mjs
 *   node scripts/marketing/record-admin-page-gifs.mjs --only dashboard,reports,fixes
 *   node scripts/marketing/record-admin-page-gifs.mjs --force
 *   node scripts/marketing/record-admin-page-gifs.mjs --url http://localhost:6464
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { loadEnv, parseArgs, REPO_ROOT, step, ok, warn, err } from './lib.mjs'

const MANIFEST = join(REPO_ROOT, 'apps/docs/data/admin-screenshots.ts')
const OUT_DIR = join(REPO_ROOT, 'docs/screenshots')

const SKILL_DIR = resolve(
  process.env.USERPROFILE || process.env.HOME || '',
  '.cursor/skills/enhance-readme',
)
if (!existsSync(join(SKILL_DIR, 'node_modules'))) {
  err(
    `Playwright not found under ${SKILL_DIR}/node_modules — install the enhance-readme Cursor skill first.\n` +
      `  npx skills add enhance-readme`,
  )
  process.exit(1)
}
const skillRequire = createRequire(join(SKILL_DIR, 'package.json'))
const { chromium } = skillRequire('playwright')
const ffmpegInstaller = skillRequire('@ffmpeg-installer/ffmpeg')
const FFMPEG = ffmpegInstaller.path

const WIDTH = 1280
const HEIGHT = 960
const FPS = 12
const DWELL_MS = 5200
const LOAD_MS = 900
const HARD_LIMIT_BYTES = 8 * 1024 * 1024

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
const only = typeof args.only === 'string'
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
    err('Need VITE_SUPABASE_ANON_KEY (or NEXT_PUBLIC_*) + TEST_USER_EMAIL + TEST_USER_PASSWORD in .env.local')
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

function runCommand(bin, cmdArgs) {
  return new Promise((resolveCmd, rejectCmd) => {
    const child = spawn(bin, cmdArgs, { stdio: ['ignore', 'inherit', 'inherit'] })
    child.on('error', rejectCmd)
    child.on('exit', (code) => {
      if (code === 0) resolveCmd()
      else rejectCmd(new Error(`${bin} exited with code ${code}`))
    })
  })
}

async function parseManifest() {
  const text = await readFile(MANIFEST, 'utf8')
  const pages = []
  const blockRe = /^\s+(['"]?)([\w-]+)\1:\s*\{([\s\S]*?)\n\s+\},/gm
  let match
  while ((match = blockRe.exec(text)) !== null) {
    const slug = match[2]
    const body = match[3]
    const routeMatch = body.match(/route:\s*'([^']+)'/)
    if (!routeMatch) continue
    pages.push({ slug, route: routeMatch[1] })
  }
  return pages
}

async function isLoginPage(page) {
  if (page.url().includes('/login')) return true
  const hasPassword = await page
    .locator('input[type="password"]')
    .isVisible({ timeout: 400 })
    .catch(() => false)
  const hasSignIn = await page
    .getByRole('button', { name: /sign in|log in/i })
    .isVisible({ timeout: 300 })
    .catch(() => false)
  return hasPassword && hasSignIn
}

async function quietOverlays(page) {
  await page
    .evaluate(() => {
      try {
        localStorage.setItem('mushi:tour-v1-completed', 'true')
        localStorage.setItem('mushi:firstRunTour:done', '1')
        localStorage.setItem('mushi:mode', 'advanced')
      } catch {}
    })
    .catch(() => {})
  const closeBtn = page.getByRole('button', { name: /^close$/i }).first()
  if (await closeBtn.isVisible({ timeout: 250 }).catch(() => false)) {
    await closeBtn.click({ timeout: 1000 }).catch(() => {})
  }
}

async function interact(page, slug) {
  if (slug === 'reports' || slug === 'inbox' || slug === 'realtime') {
    await page.locator('table tbody tr, [role="row"]').first().click({ timeout: 2500 }).catch(() => {})
    await page.waitForTimeout(900)
    return
  }
  if (slug === 'fixes' || slug === 'repo' || slug === 'releases') {
    await page.locator('article, [data-testid="fix-card"], .rounded-lg.border').first().hover({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(700)
  }
  if (slug === 'graph' || slug === 'explore') {
    await page.locator('canvas, svg.react-flow__renderer').first().hover({ timeout: 2500 }).catch(() => {})
    await page.waitForTimeout(900)
  }
  if (slug === 'settings' || slug === 'integrations') {
    await page.getByRole('tab').first().click({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(700)
  }
  if (slug === 'audit') {
    await page.locator('table tbody tr, [role="row"]').first().click({ timeout: 2500 }).catch(() => {})
    await page.waitForTimeout(900)
  }
  await page.evaluate(async () => {
    window.scrollTo({ top: 0, behavior: 'auto' })
    await new Promise((r) => setTimeout(r, 200))
    window.scrollTo({ top: Math.min(420, document.body.scrollHeight * 0.28), behavior: 'smooth' })
  })
  await page.waitForTimeout(1100)
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  })
  await page.waitForTimeout(700)
}

async function convertWebmToGif(webmPath, gifPath, prefixSec = 0.35) {
  const filter =
    `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,` +
    `split[s0][s1];[s0]palettegen=stats_mode=diff[p];` +
    `[s1][p]paletteuse=dither=bayer:bayer_scale=5`
  await runCommand(FFMPEG, [
    '-y',
    '-ss',
    prefixSec.toFixed(2),
    '-i',
    webmPath,
    '-t',
    (DWELL_MS / 1000 + 0.8).toFixed(2),
    '-vf',
    filter,
    '-loop',
    '0',
    '-loglevel',
    'error',
    gifPath,
  ])
}

async function recordPage({ slug, route }, sessionBundle) {
  const gifPath = join(OUT_DIR, `${slug}-demo.gif`)
  if (!force && existsSync(gifPath)) {
    warn(`skip ${slug} — ${slug}-demo.gif exists (use --force)`)
    return { slug, skipped: true }
  }

  const tmpDir = join(REPO_ROOT, `.cache/admin-gif-${slug}-${Date.now()}`)
  await mkdir(tmpDir, { recursive: true })

  const browser = await chromium.launch({ headless: !args.headed })
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    recordVideo: { dir: tmpDir, size: { width: WIDTH, height: HEIGHT } },
  })
  await ctx.addInitScript(({ storageKey, session }) => {
    window.localStorage.setItem(storageKey, JSON.stringify(session))
  }, sessionBundle)
  const page = await ctx.newPage()

  step(`${slug} → ${route}`)
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(LOAD_MS)
  await quietOverlays(page)
  if (await isLoginPage(page)) {
    warn(`  ${slug} still on login — skipping`)
    await page.close()
    await ctx.close()
    await browser.close()
    await rm(tmpDir, { recursive: true, force: true })
    return { slug, skipped: true, reason: 'login' }
  }
  await interact(page, slug)
  await page.waitForTimeout(DWELL_MS)

  await page.close()
  await ctx.close()
  await browser.close()

  const webms = (await readdir(tmpDir)).filter((f) => f.endsWith('.webm'))
  if (!webms.length) throw new Error(`no webm for ${slug}`)
  await convertWebmToGif(join(tmpDir, webms[webms.length - 1]), gifPath)
  const size = statSync(gifPath).size
  ok(`${slug}-demo.gif (${(size / 1024 / 1024).toFixed(2)} MB)`)
  if (size > HARD_LIMIT_BYTES) warn(`  ${slug}-demo.gif exceeds ${HARD_LIMIT_BYTES / 1024 / 1024} MB`)
  await rm(tmpDir, { recursive: true, force: true })
  return { slug, skipped: false, bytes: size }
}

async function patchManifest(pages) {
  let text = await readFile(MANIFEST, 'utf8')
  for (const { slug } of pages) {
    const gif = `${slug}-demo.gif`
    // Escape all regex special chars, then allow either a literal hyphen or none
    // (the manifest key is always a plain slug so escaping is belt-and-suspenders).
    const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const blockRe = new RegExp(`(\\s+['"]?${escapedSlug}['"]?:\\s*\\{)([\\s\\S]*?)(\\n\\s+\\},)`, 'm')
    const match = text.match(blockRe)
    if (!match) continue
    let body = match[2]
    body = /gif:\s*'[^']+'/.test(body)
      ? body.replace(/gif:\s*'[^']+'/, `gif: '${gif}'`)
      : body.replace(/(\n\s+image:\s*'[^']+',)/, `$1\n    gif: '${gif}',`)
    text = text.replace(blockRe, `$1${body}$3`)
  }
  await writeFile(MANIFEST, text, 'utf8')
  ok('Updated apps/docs/data/admin-screenshots.ts gif fields')
}

;(async () => {
  if (!existsSync(FFMPEG)) {
    err(`ffmpeg missing at ${FFMPEG}`)
    process.exit(1)
  }
  await mkdir(OUT_DIR, { recursive: true })

  let pages = await parseManifest()
  if (only.length) pages = pages.filter((p) => only.includes(p.slug))
  if (!pages.length) {
    err('No pages matched')
    process.exit(1)
  }

  step(`Recording ${pages.length} admin page GIFs @ ${BASE_URL} (${WIDTH}×${HEIGHT})`)
  const sessionBundle = await fetchSupabaseSession()

  const results = []
  for (const entry of pages) {
    try {
      results.push(await recordPage(entry, sessionBundle))
    } catch (e) {
      err(`${entry.slug}: ${e.message || e}`)
      results.push({ slug: entry.slug, error: true })
    }
  }

  const recorded = results.filter((r) => !r.skipped && !r.error)
  if (recorded.length) await patchManifest(recorded)

  step('Done.')
  console.log(
    JSON.stringify(
      {
        total: pages.length,
        recorded: recorded.length,
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
