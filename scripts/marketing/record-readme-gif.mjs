// scripts/marketing/record-readme-gif.mjs
//
// Records a 30-second screencast of the live admin demo and outputs:
//   - docs/screenshots/hero.webm   (Playwright's native output)
//   - docs/screenshots/hero.gif    (ffmpeg-converted, palette-optimised, ≤ 5 MB)
//   - docs/screenshots/hero.webp   (smaller still-image alt for RSS / email)
//
// The walk-through is deliberately scripted: open the dashboard, hover the
// PDCA loop, click Reports, open a single report, click Dispatch fix, land
// on /fixes with the new card, hold for 1 s. ~28-30 s total. The point is
// to show the full Plan→Do loop in one shot — that's the README money clip.
//
// Requires:
//   - Playwright (already a devDependency in examples/e2e-dogfood). The
//     script resolves chromium via the e2e-dogfood workspace so we don't
//     duplicate the install.
//   - ffmpeg on PATH (winget install ffmpeg / brew install ffmpeg /
//     apt-get install ffmpeg). Falls back to webm-only if ffmpeg missing.
//
// Usage:
//   pnpm --filter @mushi-mushi/e2e-dogfood install-browsers   # one time
//   node scripts/marketing/record-readme-gif.mjs               # records + converts
//   node scripts/marketing/record-readme-gif.mjs --no-convert  # webm only
//   node scripts/marketing/record-readme-gif.mjs --headed      # see it run live
//
// The script intentionally does NOT include audio. README GIFs auto-play
// muted; audio would just bloat the file.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { loadEnv, parseArgs, REPO_ROOT, step, ok, warn, err } from './lib.mjs'

loadEnv()
const args = parseArgs()

const URL = args.url || 'https://kensaur.us/mushi-mushi/'
const OUT_DIR = resolve(REPO_ROOT, 'docs/screenshots')
const RAW_DIR = resolve(REPO_ROOT, '.cache', 'gif-record')

mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(RAW_DIR, { recursive: true })

// We resolve Playwright through the e2e-dogfood workspace so the script
// never asks for a fresh install. require.resolve gives us the actual
// installed path, which we then re-import as ESM.
let chromium
try {
  const req = createRequire(resolve(REPO_ROOT, 'examples/e2e-dogfood/package.json'))
  const pwPath = req.resolve('@playwright/test')
  const pw = await import(pwPath)
  chromium = pw.chromium
} catch (e) {
  err('Could not load @playwright/test. Run: pnpm --filter @mushi-mushi/e2e-dogfood install')
  console.error(e)
  process.exit(1)
}

step(`Recording ${URL}`)
const browser = await chromium.launch({ headless: !args.headed })
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: RAW_DIR, size: { width: 1280, height: 720 } },
  deviceScaleFactor: 1,
  // Reduced motion off so the canvas animations show up in the recording.
  reducedMotion: 'no-preference',
})
const page = await context.newPage()

async function pause(ms) {
  await page.waitForTimeout(ms)
}

// --- the walk-through ----------------------------------------------------

step('Step 1/5  Land on dashboard...')
await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 })
await pause(2500)

step('Step 2/5  Hover the PDCA canvas...')
// Best-effort selectors — fall back to scrolling so the script never hard-
// fails when the live demo's DOM shifts. Marketing scripts must not crash.
try {
  const pdca = await page.locator('[data-testid="pdca-canvas"], svg.react-flow__renderer').first()
  await pdca.hover({ timeout: 4000 })
} catch {
  await page.mouse.move(640, 360)
}
await pause(2000)

step('Step 3/5  Open Reports...')
try {
  await page
    .getByRole('link', { name: /reports/i })
    .first()
    .click({ timeout: 4000 })
  await page.waitForLoadState('networkidle', { timeout: 10000 })
} catch {
  await page.goto(`${URL.replace(/\/$/, '')}/reports`, { waitUntil: 'networkidle' })
}
await pause(3500)

step('Step 4/5  Open a single report...')
try {
  await page.locator('table tbody tr, [role="row"]').first().click({ timeout: 4000 })
  await page.waitForLoadState('networkidle', { timeout: 10000 })
} catch {
  warn('  Could not find a row to click — staying on the queue.')
}
await pause(4500)

step('Step 5/5  Land on Fixes...')
try {
  await page
    .getByRole('link', { name: /fixes/i })
    .first()
    .click({ timeout: 4000 })
  await page.waitForLoadState('networkidle', { timeout: 10000 })
} catch {
  await page.goto(`${URL.replace(/\/$/, '')}/fixes`, { waitUntil: 'networkidle' })
}
await pause(5000)

await context.close()
await browser.close()

// --- find the recorded video --------------------------------------------

// Playwright writes to a randomly-named .webm in RAW_DIR. There should
// only be one file we just created — pick the most recently modified.
const fs = await import('node:fs')
const webmFiles = fs
  .readdirSync(RAW_DIR)
  .filter((f) => f.endsWith('.webm'))
  .map((f) => ({ f, t: fs.statSync(resolve(RAW_DIR, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t)

if (!webmFiles.length) {
  err('No .webm produced — Playwright recording may have failed silently.')
  process.exit(1)
}

const webmSrc = resolve(RAW_DIR, webmFiles[0].f)
const webmDst = resolve(OUT_DIR, 'hero.webm')
renameSync(webmSrc, webmDst)
ok(`Webm: ${webmDst}`)

if (args['no-convert']) {
  warn('Skipping ffmpeg conversion (--no-convert).')
  process.exit(0)
}

// --- ffmpeg → optimised .gif --------------------------------------------

const ffmpegProbe = spawnSync(
  process.platform === 'win32' ? 'where' : 'which',
  ['ffmpeg'],
  { encoding: 'utf8', shell: false },
)
if (ffmpegProbe.status !== 0) {
  warn(
    'ffmpeg not on PATH — keeping .webm only. Install: winget install ffmpeg | brew install ffmpeg | apt install ffmpeg',
  )
  process.exit(0)
}

step('Converting to .gif (palette-optimised)...')
// Two-pass with a generated palette gives a dramatically smaller, less
// dithered GIF — ~5x smaller than the naive single-pass conversion.
const palette = resolve(RAW_DIR, 'palette.png')
const gifDst = resolve(OUT_DIR, 'hero.gif')

const r1 = spawnSync(
  'ffmpeg',
  [
    '-y',
    '-i',
    webmDst,
    '-vf',
    'fps=15,scale=900:-1:flags=lanczos,palettegen=stats_mode=diff',
    palette,
  ],
  { encoding: 'utf8', shell: false, stdio: 'inherit' },
)
if (r1.status !== 0) {
  err('ffmpeg palette pass failed.')
  process.exit(1)
}

const r2 = spawnSync(
  'ffmpeg',
  [
    '-y',
    '-i',
    webmDst,
    '-i',
    palette,
    '-lavfi',
    'fps=15,scale=900:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5',
    gifDst,
  ],
  { encoding: 'utf8', shell: false, stdio: 'inherit' },
)
if (r2.status !== 0) {
  err('ffmpeg gif pass failed.')
  process.exit(1)
}

const stats = fs.statSync(gifDst)
ok(`Gif:  ${gifDst}  (${(stats.size / 1024 / 1024).toFixed(2)} MB)`)
if (stats.size > 6 * 1024 * 1024) {
  warn(
    'Gif > 6 MB — GitHub may not auto-play. Consider re-running with a shorter walk-through or smaller scale.',
  )
}

// --- still .webp for RSS / email ----------------------------------------

step('Generating still .webp (frame at 1 s)...')
const webpDst = resolve(OUT_DIR, 'hero.webp')
const r3 = spawnSync(
  'ffmpeg',
  ['-y', '-i', webmDst, '-vf', 'select=eq(n\\,15)', '-vframes', '1', '-c:v', 'libwebp', '-quality', '88', webpDst],
  { encoding: 'utf8', shell: false, stdio: 'inherit' },
)
if (r3.status === 0) {
  ok(`Webp: ${webpDst}`)
} else {
  warn('ffmpeg webp pass failed (gif still produced; safe to ignore).')
}

// Cleanup palette scratch file.
try {
  rmSync(palette, { force: true })
} catch {
  /* ignore */
}
