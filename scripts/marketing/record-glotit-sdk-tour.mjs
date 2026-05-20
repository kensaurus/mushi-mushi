// scripts/marketing/record-glotit-sdk-tour.mjs
//
// Records a short GIF of the Mushi SDK widget on glot.it (dogfood project):
// land on the live app → open the feedback widget → type a note → submit.
//
// Output: docs/screenshots/glotit-report-flow.gif
//
// Requires Playwright (via examples/e2e-dogfood) + ffmpeg on PATH.
//
// Usage:
//   node scripts/marketing/record-glotit-sdk-tour.mjs
//   node scripts/marketing/record-glotit-sdk-tour.mjs --url=https://kensaur.us/glot-it
//   node scripts/marketing/record-glotit-sdk-tour.mjs --headed

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { loadEnv, parseArgs, REPO_ROOT, step, ok, warn, err } from './lib.mjs'

loadEnv()
const args = parseArgs()

const SKILL_DIR = resolve(
  process.env.USERPROFILE || process.env.HOME || '',
  '.cursor/skills/enhance-readme',
)
if (!existsSync(join(SKILL_DIR, 'node_modules'))) {
  err(`expected playwright under ${SKILL_DIR}/node_modules — install the enhance-readme Cursor skill first.`)
  process.exit(1)
}
const skillRequire = createRequire(join(SKILL_DIR, 'package.json'))
const { chromium } = skillRequire('playwright')
const ffmpegInstaller = skillRequire('@ffmpeg-installer/ffmpeg')
const FFMPEG = ffmpegInstaller.path

const URL = args.url || 'https://kensaur.us/glot-it'
const OUT_DIR = resolve(REPO_ROOT, 'docs/screenshots')
const RAW_DIR = resolve(REPO_ROOT, '.cache', 'glotit-gif-record')
const GIF_DST = resolve(OUT_DIR, 'glotit-report-flow.gif')

mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(RAW_DIR, { recursive: true })

async function pause(page, ms) {
  await page.waitForTimeout(ms)
}

step(`Recording glot.it SDK flow at ${URL}`)
const browser = await chromium.launch({ headless: !args.headed })
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: RAW_DIR, size: { width: 1280, height: 800 } },
  reducedMotion: 'no-preference',
})
const page = await context.newPage()

// --- walk-through ----------------------------------------------------------

step('1/4  Land on glot.it home...')
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForSelector('#mushi-mushi-widget', { timeout: 20000 }).catch(() => {
  warn('  #mushi-mushi-widget not found — Mushi may be disabled on this deploy')
})
await pause(page, 2500)

step('2/4  Open Mushi feedback widget...')
const openedViaSdk = await page.evaluate(() => {
  const mushi = globalThis.__mushi__
  if (mushi?.openWith) {
    mushi.openWith('bug')
    return true
  }
  if (mushi?.open) {
    mushi.open()
    return true
  }
  return false
})
if (!openedViaSdk) {
  warn('  window.__mushi__ unavailable — clicking widget host')
  try {
    await page.locator('#mushi-mushi-widget').click({ timeout: 3000, position: { x: 28, y: 28 } })
  } catch {
    await page.mouse.click(1240, 760)
  }
}
await pause(page, 2000)

step('3/4  Fill report description...')
await page.keyboard.type(
  'Dogfood demo — lesson card feels slow on mobile (Mushi docs GIF)',
  { delay: 35 },
)
await pause(page, 2500)

step('4/4  Submit (Ctrl+Enter shortcut)...')
await page.keyboard.press('Control+Enter')
await pause(page, 3500)

await context.close()
await browser.close()

// --- find recorded webm ---------------------------------------------------

const webmFiles = readdirSync(RAW_DIR)
  .filter((f) => f.endsWith('.webm'))
  .map((f) => ({ f, t: statSync(resolve(RAW_DIR, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t)

if (!webmFiles.length) {
  err('No .webm produced.')
  process.exit(1)
}

const webmSrc = resolve(RAW_DIR, webmFiles[0].f)
const webmDst = resolve(RAW_DIR, 'glotit-report-flow.webm')
renameSync(webmSrc, webmDst)
ok(`Webm: ${webmDst}`)

if (args['no-convert']) {
  warn('Skipping ffmpeg (--no-convert).')
  process.exit(0)
}

const ffmpegProbe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], {
  encoding: 'utf8',
})
const ffmpegBin = ffmpegProbe.status === 0 ? 'ffmpeg' : FFMPEG
if (ffmpegProbe.status !== 0 && !existsSync(FFMPEG)) {
  warn('ffmpeg not on PATH — keeping .webm only in .cache/')
  process.exit(0)
}

step('Converting to palette-optimised GIF...')
const palette = resolve(RAW_DIR, 'glotit-palette.png')
const r1 = spawnSync(
  ffmpegBin,
  ['-y', '-i', webmDst, '-vf', 'fps=12,scale=800:-1:flags=lanczos,palettegen=stats_mode=diff', palette],
  { stdio: 'inherit' },
)
if (r1.status !== 0) {
  err('ffmpeg palette pass failed.')
  process.exit(1)
}

const r2 = spawnSync(
  ffmpegBin,
  [
    '-y',
    '-i',
    webmDst,
    '-i',
    palette,
    '-lavfi',
    'fps=12,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5',
    GIF_DST,
  ],
  { stdio: 'inherit' },
)
if (r2.status !== 0) {
  err('ffmpeg gif pass failed.')
  process.exit(1)
}

const sizeMb = statSync(GIF_DST).size / 1024 / 1024
ok(`Gif: ${GIF_DST} (${sizeMb.toFixed(2)} MB)`)
if (sizeMb > 10) {
  warn('GIF > 10 MB — consider re-running with shorter dwell times.')
}

try {
  rmSync(palette, { force: true })
} catch {
  /* ignore */
}
