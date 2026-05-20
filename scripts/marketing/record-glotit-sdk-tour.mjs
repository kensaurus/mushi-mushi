// scripts/marketing/record-glotit-sdk-tour.mjs
//
// Records glotit-report-flow.gif — Mushi SDK edge-tab launcher on a glot.it-style
// checkout fixture (examples/react-demo). Shows Report bug → widget open → submit.
//
// Prerequisite: pnpm --filter mushi-mushi-react-demo dev  (default http://localhost:5173)
//
// Usage:
//   node scripts/marketing/record-glotit-sdk-tour.mjs
//   node scripts/marketing/record-glotit-sdk-tour.mjs --url=http://localhost:5173
//   node scripts/marketing/record-glotit-sdk-tour.mjs --headed

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
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

const VIEWPORT = { width: 1280, height: 960 }
const URL = args.url || 'http://localhost:5173'
const OUT_DIR = resolve(REPO_ROOT, 'docs/screenshots')
const RAW_DIR = resolve(REPO_ROOT, '.cache', 'glotit-gif-record')
const GIF_DST = resolve(OUT_DIR, 'glotit-report-flow.gif')

mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(RAW_DIR, { recursive: true })

async function pause(page, ms) {
  await page.waitForTimeout(ms)
}

/** Edge-tab trigger sits flush on the right; click center of the tab. */
async function clickSdkTrigger(page) {
  const { width, height } = VIEWPORT
  const x = width - 16
  const y = Math.round(height * 0.62)
  await page.mouse.click(x, y)
}

step(`Recording SDK capture flow at ${URL} (${VIEWPORT.width}×${VIEWPORT.height})`)
const browser = await chromium.launch({ headless: !args.headed })
const context = await browser.newContext({
  viewport: VIEWPORT,
  recordVideo: { dir: RAW_DIR, size: VIEWPORT },
  reducedMotion: 'no-preference',
})
const page = await context.newPage()

step('1/5  Land on checkout fixture — dwell on edge-tab launcher...')
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForSelector('#mushi-mushi-widget', { timeout: 25000 }).catch(() => {
  warn('  #mushi-mushi-widget not found — is react-demo running with MushiProvider?')
})
await pause(page, 4200)

step('2/5  Click Report bug edge tab...')
await clickSdkTrigger(page)
await pause(page, 2200)

step('3/5  Pick bug category...')
await clickSdkTrigger(page).catch(() => {})
await pause(page, 800)
await page.mouse.click(VIEWPORT.width / 2, Math.round(VIEWPORT.height * 0.38))
await pause(page, 1800)

step('4/5  Fill description...')
await page.keyboard.type(
  'Pay button slips under bottom bar after spring coupon — checkout /glot-it',
  { delay: 28 },
)
await pause(page, 2200)

step('5/5  Submit (Ctrl+Enter)...')
await page.keyboard.press('Control+Enter')
await pause(page, 3200)

await context.close()
await browser.close()

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

step('Converting to palette-optimised GIF (960px tall)...')
const palette = resolve(RAW_DIR, 'glotit-palette.png')
const scaleFilter = 'fps=12,scale=960:-1:flags=lanczos'

const r1 = spawnSync(
  ffmpegBin,
  ['-y', '-i', webmDst, '-vf', `${scaleFilter},palettegen=stats_mode=diff`, palette],
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
    `${scaleFilter}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`,
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

try {
  rmSync(palette, { force: true })
} catch {
  /* ignore */
}
