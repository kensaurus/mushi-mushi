// scripts/marketing/record-glotit-sdk-tour.mjs
//
// Records glotit-report-flow.gif — full Mushi SDK reporter pipeline on the
// glot.it-style checkout fixture (examples/react-demo):
//   edge tab visible → open widget → pick Bug → pick intent → describe → submit → success
//
// Prerequisite: pnpm --filter mushi-mushi-react-demo dev  (http://localhost:5173)
//
// Usage:
//   node scripts/marketing/record-glotit-sdk-tour.mjs
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

const DESCRIPTION =
  'Pay button slips under the bottom bar after the spring coupon — checkout /glot-it'

mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(RAW_DIR, { recursive: true })

async function pause(page, ms) {
  await page.waitForTimeout(ms)
}

async function waitForRecorder(page) {
  await page
    .waitForFunction(
      () => globalThis.__mushiRecorder?.ready?.() && !!document.getElementById('mushi-mushi-widget'),
      { timeout: 45000 },
    )
    .catch(() => {
      warn('  __mushiRecorder not ready — rebuild @mushi-mushi/web with debug:true and restart react-demo')
    })
}

async function clickCenter(page, center) {
  if (!center) return false
  await page.mouse.click(center.x, center.y)
  return true
}

async function getCenter(page, fnName, ...fnArgs) {
  return page.evaluate(
    ({ name, args }) => {
      const rec = globalThis.__mushiRecorder
      if (!rec?.[name]) return null
      return rec[name](...args)
    },
    { name: fnName, args: fnArgs },
  )
}

async function callRecorder(page, fnName, ...fnArgs) {
  await page.evaluate(
    ({ name, args }) => {
      const rec = globalThis.__mushiRecorder
      rec?.[name]?.(...args)
    },
    { name: fnName, args: fnArgs },
  )
}

async function waitForStep(page, stepName) {
  await page.waitForFunction(
    (expected) => globalThis.__mushiRecorder?.getStep?.() === expected,
    stepName,
    { timeout: 8000 },
  )
}

step(`Recording full SDK reporter flow at ${URL} (${VIEWPORT.width}×${VIEWPORT.height})`)
const browser = await chromium.launch({ headless: !args.headed })
const context = await browser.newContext({
  viewport: VIEWPORT,
  recordVideo: { dir: RAW_DIR, size: VIEWPORT },
  reducedMotion: 'no-preference',
})
const page = await context.newPage()

step('1/7  Land on checkout — show Report bug edge tab…')
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 })
await waitForRecorder(page)
await pause(page, 3800)

step('2/7  Click Report bug edge tab…')
const trigger = await getCenter(page, 'getTriggerCenter')
if (await clickCenter(page, trigger)) {
  await waitForStep(page, 'category')
} else {
  warn('  Could not locate edge tab — falling back to recorder API')
  await callRecorder(page, 'clickTrigger')
  await waitForStep(page, 'category')
}
await pause(page, 2400)

step('3/7  Choose Bug category…')
const bugBtn = await getCenter(page, 'getCategoryCenter', 'bug')
if (await clickCenter(page, bugBtn)) {
  await waitForStep(page, 'intent')
} else {
  await callRecorder(page, 'selectCategory', 'bug')
  await waitForStep(page, 'intent')
}
await pause(page, 2000)

step('4/7  Choose intent…')
const intentBtn = await getCenter(page, 'getIntentCenter', 'Unresponsive')
if (await clickCenter(page, intentBtn)) {
  await waitForStep(page, 'details')
} else {
  await callRecorder(page, 'selectIntent', 'Unresponsive')
  await waitForStep(page, 'details')
}
await pause(page, 1800)

step('5/7  Type report description…')
await callRecorder(page, 'focusDescription')
await pause(page, 400)
await page.keyboard.type(DESCRIPTION, { delay: 32 })
await pause(page, 2200)

step('6/7  Submit report…')
const submitBtn = await getCenter(page, 'getSubmitCenter')
if (await clickCenter(page, submitBtn)) {
  /* clicked */
} else {
  await page.keyboard.press('Control+Enter')
}
await pause(page, 800)
await page.waitForFunction(() => globalThis.__mushiRecorder?.getStep?.() === 'success', null, {
  timeout: 10000,
}).catch(() => warn('  Success step not detected — API may have blocked, but GIF continues'))

step('7/7  Hold on success stamp…')
await pause(page, 3600)

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

step('Converting to palette-optimised GIF…')
const palette = resolve(RAW_DIR, 'glotit-palette.png')
const scaleFilter = 'fps=10,scale=960:-1:flags=lanczos'

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
