#!/usr/bin/env node
// Multi-page guided-tour GIF recorder for the Mushi Mushi admin console.
//
// Wraps the same Playwright + ffmpeg recipe as the enhance-readme skill's
// generic single-page recorder, but walks through eight key admin routes
// inside a single recording so the GIF tells the full PDCA story instead
// of just scrolling one page.
//
// Output: docs/screenshots/tour.gif (autoplays inline on github.com).
//
// Usage:
//   node scripts/record-readme-tour.mjs
//
// Environment (loaded from .env.local automatically):
//   TEST_USER_EMAIL    — admin login email   (required)
//   TEST_USER_PASSWORD — admin login pwd     (required)
//   ADMIN_URL          — base URL            (defaults to http://localhost:6464)

import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')

// The recorder relies on `playwright` + `@ffmpeg-installer/ffmpeg`. Neither is
// a workspace dep (we'd never ship them in production) so we resolve them out
// of the enhance-readme skill's bundled node_modules. If a future contributor
// runs this from a fresh clone without the skill installed, the require below
// throws with a clear message rather than a cryptic ESM resolution error.
const SKILL_DIR = resolve(
  process.env.USERPROFILE || process.env.HOME || '',
  '.cursor/skills/enhance-readme',
)
if (!existsSync(join(SKILL_DIR, 'node_modules'))) {
  console.error(
    `[tour][err] expected playwright + ffmpeg under ${SKILL_DIR}/node_modules — install the enhance-readme Cursor skill first.`,
  )
  process.exit(1)
}
// `createRequire` resolves modules as if from the file at the given path —
// pointing at the skill's own `package.json` makes Node look up the chain
// from `<SKILL_DIR>/node_modules/`, exactly where playwright + ffmpeg live.
const skillRequire = createRequire(join(SKILL_DIR, 'package.json'))
const { chromium } = skillRequire('playwright')
const ffmpegInstaller = skillRequire('@ffmpeg-installer/ffmpeg')
const FFMPEG = ffmpegInstaller.path

// ── Tour configuration ────────────────────────────────────────────────────
const BASE_URL = (process.env.ADMIN_URL || 'http://localhost:6464').replace(/\/$/, '')
const OUT = resolve(ROOT, 'docs/screenshots/tour.gif')
const WIDTH = 1280
const HEIGHT = 800
const FPS = 12
const HARD_LIMIT_BYTES = 10 * 1024 * 1024

// Eight stops, ~1.1s dwell each. Order traces the PDCA loop the README explains:
// dashboard cockpit → Plan (reports) → Do (fixes / repo) → Check (judge / health)
// → knowledge graph → Act (integrations).
const STOPS = [
  { path: '/', dwellMs: 1400 },
  { path: '/reports', dwellMs: 1100 },
  { path: '/fixes', dwellMs: 1100 },
  { path: '/repo', dwellMs: 1100 },
  { path: '/judge', dwellMs: 1100 },
  { path: '/health', dwellMs: 1100 },
  { path: '/graph', dwellMs: 1100 },
  { path: '/integrations', dwellMs: 1100 },
]
const PER_PAGE_LOAD_MS = 700 // grace for first paint after navigation
const TOTAL_TOUR_MS = STOPS.reduce((acc, s) => acc + s.dwellMs + PER_PAGE_LOAD_MS, 0)

function log(...m) { console.log('[tour]', ...m) }
function err(...m) { console.error('[tour][err]', ...m) }

function runCommand(bin, args) {
  return new Promise((resolveCmd, rejectCmd) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'inherit', 'inherit'] })
    child.on('error', rejectCmd)
    child.on('exit', (code) => {
      if (code === 0) resolveCmd()
      else rejectCmd(new Error(`${bin} exited with code ${code}`))
    })
  })
}

// Manually parse .env.local — adding a `dotenv` dep just to read two keys is
// overkill, and shell-sourcing breaks on Windows. The file is small.
async function loadDotEnv() {
  const file = resolve(ROOT, '.env.local')
  if (!existsSync(file)) return
  const lines = (await readFile(file, 'utf8')).split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

async function maybeLogin(page) {
  const email = process.env.TEST_USER_EMAIL
  const password = process.env.TEST_USER_PASSWORD
  if (!email || !password) {
    err('TEST_USER_EMAIL / TEST_USER_PASSWORD must be set in .env.local')
    process.exit(1)
  }
  // Login form only renders on the unauth route — if we landed straight on
  // the dashboard (session preserved), bail out fast.
  const passInput = page.locator('input[type="password"]').first()
  if (!(await passInput.isVisible({ timeout: 1500 }).catch(() => false))) return
  log('login form detected — filling credentials')
  const emailInput = page
    .locator('input[type="email"], input[name*="email" i]')
    .first()
  await emailInput.fill(email).catch(() => {})
  await passInput.fill(password).catch(() => {})
  const submit = page.getByRole('button', { name: /sign\s*in|log\s*in|login|continue/i }).first()
  if (await submit.isVisible({ timeout: 800 }).catch(() => false)) {
    await submit.click({ timeout: 2000 }).catch(() => {})
  } else {
    await passInput.press('Enter').catch(() => {})
  }
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {})
  await page.waitForTimeout(1500)
}

// Suppress overlays that would steal pixels from the GIF: the FirstRunTour
// spotlight (cleared via localStorage; the dialog only renders when the key
// is unset) and the Ask Mushi sidebar (state-driven, defaults closed but
// re-opens via Ctrl/Cmd+J — we just close it if visible).
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

async function performTour(page) {
  for (const stop of STOPS) {
    const url = `${BASE_URL}${stop.path}`
    log(`→ ${stop.path}`)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(PER_PAGE_LOAD_MS)
    await quietOverlays(page)
    await page.waitForTimeout(stop.dwellMs)
  }
}

async function recordWebm(tmpDir) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    recordVideo: { dir: tmpDir, size: { width: WIDTH, height: HEIGHT } },
  })
  const page = await ctx.newPage()
  const startMs = Date.now()

  log(`navigating to ${BASE_URL}/`)
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(1500)
  await maybeLogin(page)
  await quietOverlays(page)

  // Mark the prefix that ffmpeg will skip: page load + login + overlay
  // dismissal. Without trimming the GIF would lead with several seconds of
  // blank/login frames.
  const prefixSec = (Date.now() - startMs) / 1000
  log(`prefix ${prefixSec.toFixed(2)}s — running ${STOPS.length}-stop multi-page tour`)
  await performTour(page)

  await page.close()
  await ctx.close()
  await browser.close()

  const entries = (await readdir(tmpDir)).filter((f) => f.endsWith('.webm'))
  if (entries.length === 0) throw new Error('no .webm produced')
  return { rawWebm: join(tmpDir, entries[entries.length - 1]), prefixSec }
}

async function convertToGif(rawWebm, prefixSec) {
  await mkdir(dirname(OUT), { recursive: true })
  // Two-pass palette generation gives roughly 5x better quality at the same
  // size vs the naive single-pass default. `dither=bayer:bayer_scale=5` is
  // ffmpeg's recommended setting for smooth gradients in dark UIs.
  const filter =
    `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,` +
    `split[s0][s1];[s0]palettegen=stats_mode=diff[p];` +
    `[s1][p]paletteuse=dither=bayer:bayer_scale=5`
  const durationSec = TOTAL_TOUR_MS / 1000
  log(`converting webm → gif (${WIDTH}px @ ${FPS} fps, ${durationSec.toFixed(1)}s)`)
  await runCommand(FFMPEG, [
    '-y',
    '-ss', prefixSec.toFixed(2),
    '-i', rawWebm,
    '-t', durationSec.toFixed(2),
    '-vf', filter,
    '-loop', '0',
    '-loglevel', 'error',
    OUT,
  ])
}

;(async () => {
  await loadDotEnv()
  if (!existsSync(FFMPEG)) {
    err(`ffmpeg binary missing at ${FFMPEG}`)
    process.exit(1)
  }
  const tmpDir = resolve(ROOT, `.tour-tmp-${Date.now()}`)
  await mkdir(tmpDir, { recursive: true })
  try {
    const { rawWebm, prefixSec } = await recordWebm(tmpDir)
    await convertToGif(rawWebm, prefixSec)
    const { size } = statSync(OUT)
    const mb = size / 1024 / 1024
    log(`wrote ${OUT} (${mb.toFixed(2)} MB)`)
    if (size > HARD_LIMIT_BYTES) {
      err(`gif is ${mb.toFixed(2)} MB — exceeds GitHub's 10 MB inline cap. Reduce WIDTH or FPS.`)
      process.exit(2)
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
})().catch((e) => {
  err(e.stack || e.message || String(e))
  process.exit(1)
})
