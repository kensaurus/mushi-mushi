#!/usr/bin/env node
/**
 * Records the docs walkthrough videos: real pages, driven step by step, with
 * a pointer, click ripples, a ring and captions drawn on top
 * (docs-walkthroughs/overlay.js). The steps are in docs-walkthroughs/journeys.mjs.
 *
 *   pnpm gen:walkthroughs              # every journey
 *   pnpm gen:walkthroughs bug-to-fix   # one journey
 *
 * Output, per journey, in apps/docs/public/walkthroughs/:
 *   <id>.mp4   H.264, 1600 px wide, no audio, fast start
 *   <id>.jpg   poster frame
 * and its chapters (the step list, with times) in
 * apps/docs/data/walkthroughs.generated.json, which the <Walkthrough>
 * component reads. The step text is the page's real instructions; the video
 * shows them.
 *
 * Safety, because the console journeys run against production:
 * - The browser is a stored, signed-in profile (WALKTHROUGH_PROFILE, default
 *   ~/.playwright-cli-profiles/mushi-admin). It never signs in by itself; a
 *   signed-out profile stops the run.
 * - Every request that is not GET/HEAD/OPTIONS is aborted, except the
 *   Supabase token refresh. A step that would change data cannot.
 * - The reporter journey runs on a made-up shop (demo-app.html) served by the
 *   recorder; its SDK requests are answered here and never leave the machine.
 * - Names of private apps and the account email are swapped out of the page
 *   text (PRIVACY), and a run fails if any other app's name (DENYLIST) is
 *   visible after a filmed step.
 *
 * Frames come from the Chrome DevTools screencast at device scale 2, not
 * Playwright's video recorder, so text stays sharp after encoding.
 */

import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DENYLIST, JOURNEYS, PRIVACY } from './docs-walkthroughs/journeys.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HERE = join(ROOT, 'scripts/docs-walkthroughs')
const require = createRequire(join(ROOT, 'package.json'))
let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  // A worktree has no node_modules of its own; borrow the main checkout's.
  const main = process.env.WALKTHROUGH_PLAYWRIGHT_FROM
  if (!main) throw new Error('playwright not found; run from a checkout with node_modules or set WALKTHROUGH_PLAYWRIGHT_FROM=<repo with node_modules>')
  ;({ chromium } = createRequire(join(main, 'package.json'))('playwright'))
}

const PROFILE = process.env.WALKTHROUGH_PROFILE || join(homedir(), '.playwright-cli-profiles', 'mushi-admin')
const FFMPEG = process.env.FFMPEG || 'ffmpeg'
const OUT_DIR = join(ROOT, 'apps/docs/public/walkthroughs')
const DATA_FILE = join(ROOT, 'apps/docs/data/walkthroughs.generated.json')
const VIEW = { width: 1280, height: 800 }
const SCALE = 2
const OUT_WIDTH = 1600
const DEMO_HTML = readFileSync(join(HERE, 'demo-app.html'), 'utf8')
const OVERLAY = readFileSync(join(HERE, 'overlay.js'), 'utf8')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[walkthrough]', ...a)

function fail(msg) {
  throw new Error(msg)
}

/** Answers the demo shop's page and SDK calls; blocks every other write. */
async function guard(ctx) {
  await ctx.route('**/*', async (route) => {
    const req = route.request()
    const url = req.url()
    if (url.startsWith('https://plant-shop.example/')) {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: DEMO_HTML })
    }
    if (url.startsWith('https://api.plant-shop.example/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' },
        body: JSON.stringify({ ok: true, data: { id: 'demo-report', reportId: 'demo-report', status: 'new' } }),
      })
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method()) || /\/auth\/v1\/token/.test(url)) return route.continue()
    return route.abort('blockedbyclient')
  })
}

/** Starts the DevTools screencast; frames keep their capture time. */
async function startScreencast(page) {
  const cdp = await page.context().newCDPSession(page)
  const frames = []
  cdp.on('Page.screencastFrame', async (f) => {
    frames.push({ ts: f.metadata.timestamp, data: f.data })
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    maxWidth: VIEW.width * SCALE,
    maxHeight: VIEW.height * SCALE,
    everyNthFrame: 1,
  })
  return {
    frames,
    stop: async () => {
      await cdp.send('Page.stopScreencast').catch(() => {})
      await cdp.detach().catch(() => {})
    },
  }
}

class Driver {
  constructor(page, journey) {
    this.page = page
    this.journey = journey
    this.chapters = []
    this.total = journey.steps.filter((s) => s.do === 'chapter').length
    this.t0 = null
    this.cursor = { x: VIEW.width * 0.62, y: VIEW.height * 0.55 }
    this.zoomed = null
  }

  now() {
    return Date.now() / 1000
  }

  async overlay(fn, ...args) {
    await this.page.waitForFunction(() => !!window.__wt, null, { timeout: 15_000 })
    return this.page.evaluate(([name, rest]) => window.__wt[name](...rest), [fn, args])
  }

  /** Fails the run if a denylisted name is on screen once filming has started. */
  async checkPrivacy(step) {
    if (this.t0 == null) return
    const lines = (await this.overlay('visibleText')).split('\n')
    for (const w of DENYLIST) {
      const line = lines.find((l) => l.toLowerCase().includes(w.toLowerCase()))
      if (line) fail(`${this.journey.id}: "${w}" is on screen after step "${step.do}${step.title ? `: ${step.title}` : ''}" in: ${line.slice(0, 160)}`)
    }
  }

  async locate(target) {
    const loc = typeof target === 'function' ? target(this.page) : this.page.locator(target)
    // Pages keep hidden copies of controls (menus, help panels); film the visible one.
    const one = loc.filter({ visible: true }).first()
    try {
      await one.waitFor({ state: 'visible', timeout: 20_000 })
    } catch {
      fail(`${this.journey.id}: target not visible: ${typeof target === 'function' ? target.toString() : target}`)
    }
    return one
  }

  async box(target) {
    const el = await this.locate(target)
    const b = await el.boundingBox()
    if (!b || b.width === 0) fail(`${this.journey.id}: target has no box: ${target}`)
    return b
  }

  async glide(b, ms = 750) {
    const x = b.x + Math.min(b.width * 0.5, 60)
    const y = b.y + b.height * 0.5
    await this.overlay('moveTo', x, y, ms)
    this.cursor = { x, y }
    await sleep(ms + 60)
  }

  async run(step) {
    const p = this.page
    switch (step.do) {
      case 'goto': {
        await p.goto(step.url, { waitUntil: 'domcontentloaded' })
        if (step.ready) await this.locate(step.ready)
        await sleep(step.settle ?? 1200)
        await this.overlay('jump', this.cursor.x, this.cursor.y)
        this.zoomed = null
        return
      }
      case 'start': {
        // Everything before this is loading; the video starts here.
        this.t0 = this.now()
        await this.overlay('jump', this.cursor.x, this.cursor.y)
        return
      }
      case 'card': {
        await this.overlay('card', { kicker: step.kicker, title: step.title, subtitle: step.subtitle })
        await sleep(step.ms ?? 2600)
        await this.overlay('card', null)
        await sleep(450)
        return
      }
      case 'chapter': {
        const n = this.chapters.length + 1
        this.chapters.push({ t: Math.max(0, this.now() - this.t0), title: step.title, detail: step.detail ?? '' })
        await this.overlay('caption', { step: n, total: this.total, title: step.title, detail: step.detail ?? '', at: step.at ?? this.journey.captionAt ?? 'bottom' })
        await sleep(step.ms ?? 900)
        return
      }
      case 'point': {
        const b = await this.box(step.target)
        if (step.ring !== false) await this.overlay('ring', b)
        await this.glide(b, step.ms ?? 750)
        await sleep(step.hold ?? 1400)
        return
      }
      case 'ring': {
        await this.overlay('ring', step.target ? await this.box(step.target) : null)
        await sleep(step.hold ?? 300)
        return
      }
      case 'click': {
        const el = await this.locate(step.target)
        const b = await el.boundingBox()
        if (step.ring) await this.overlay('ring', b)
        await this.glide(b, step.ms ?? 700)
        await this.overlay('click')
        await el.click({ timeout: 5_000 })
        if (step.ring) await this.overlay('ring', null)
        await sleep(step.hold ?? 1100)
        return
      }
      case 'type': {
        const el = await this.locate(step.target)
        await this.glide(await el.boundingBox(), step.ms ?? 650)
        await this.overlay('click')
        await el.click({ timeout: 5_000 })
        await el.pressSequentially(step.text, { delay: step.delay ?? 45 })
        await sleep(step.hold ?? 900)
        return
      }
      case 'scroll': {
        const el = await this.locate(step.target)
        await this.overlay('ring', null)
        await el.evaluate((node, block) => node.scrollIntoView({ behavior: 'smooth', block }), step.block ?? 'start')
        await sleep(step.hold ?? 1300)
        return
      }
      case 'zoom': {
        const b = await this.box(step.target)
        await this.overlay('ring', null)
        await this.overlay('zoom', step.scale ?? 1.5, b.x + b.width / 2, b.y + b.height / 2, 800)
        this.zoomed = step.scale ?? 1.5
        await sleep(step.hold ?? 1000)
        return
      }
      case 'unzoom': {
        await this.overlay('ring', null)
        await this.overlay('zoom', 1, 0, 0, 700)
        this.zoomed = null
        await sleep(step.hold ?? 800)
        return
      }
      case 'wait': {
        if (step.target) await this.locate(step.target)
        await sleep(step.ms ?? 800)
        return
      }
      case 'end': {
        await this.overlay('ring', null)
        await sleep(step.ms ?? 1600)
        await this.overlay('caption', null)
        await sleep(500)
        return
      }
      default:
        fail(`unknown step ${step.do}`)
    }
  }
}

function encode(journey, frames, t0, tEnd, workDir) {
  const usable = frames.filter((f) => f.ts <= tEnd)
  // The frame on screen at t0 opens the video.
  let first = 0
  for (let i = 0; i < usable.length; i++) if (usable[i].ts <= t0) first = i
  const clip = usable.slice(first)
  if (clip.length < 5) fail(`${journey.id}: only ${clip.length} frames captured`)
  const lines = ['ffconcat version 1.0']
  clip.forEach((f, i) => {
    const file = join(workDir, `f${String(i).padStart(5, '0')}.jpg`)
    writeFileSync(file, Buffer.from(f.data, 'base64'))
    const start = i === 0 ? t0 : f.ts
    const next = i + 1 < clip.length ? clip[i + 1].ts : tEnd
    lines.push(`file '${file.replace(/\\/g, '/')}'`, `duration ${Math.max(0.001, next - start).toFixed(4)}`)
  })
  // The concat demuxer needs the last file repeated to honour its duration.
  lines.push(`file '${join(workDir, `f${String(clip.length - 1).padStart(5, '0')}.jpg`).replace(/\\/g, '/')}'`)
  const list = join(workDir, 'list.ffconcat')
  writeFileSync(list, lines.join('\n'))
  const mp4 = join(OUT_DIR, `${journey.id}.mp4`)
  const r = spawnSync(
    FFMPEG,
    ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
      '-vf', `fps=30,scale=${OUT_WIDTH}:-2:flags=lanczos,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-tune', 'stillimage',
      '-movflags', '+faststart', '-an', mp4],
    { stdio: 'inherit' },
  )
  if (r.status !== 0) fail(`${journey.id}: ffmpeg failed`)
  const posterAt = Math.max(0, (journey.posterAt ?? 0) - 0)
  const poster = join(OUT_DIR, `${journey.id}.jpg`)
  const p = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', posterAt.toFixed(2), '-i', mp4, '-frames:v', '1', '-q:v', '4', poster], { stdio: 'inherit' })
  if (p.status !== 0) fail(`${journey.id}: poster failed`)
  return { mp4, poster }
}

async function record(journey) {
  log(`${journey.id}: starting`)
  if (!existsSync(PROFILE)) fail(`profile missing: ${PROFILE}`)
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: VIEW,
    deviceScaleFactor: SCALE,
    colorScheme: journey.colorScheme ?? 'dark',
    args: ['--hide-scrollbars'],
  })
  const workDir = join(tmpdir(), `mushi-walkthrough-${journey.id}-${Date.now()}`)
  mkdirSync(workDir, { recursive: true })
  try {
    await guard(ctx)
    await ctx.addInitScript({ content: `window.__WT_PRIVACY__ = ${JSON.stringify(PRIVACY)};\n${OVERLAY}` })
    const page = ctx.pages()[0] ?? (await ctx.newPage())
    if (journey.requiresSignIn) {
      await page.goto(journey.signInCheckUrl, { waitUntil: 'domcontentloaded' })
      await sleep(3000)
      const signedIn = await page.evaluate(() => Object.keys(localStorage).some((k) => /auth-token/.test(k)))
      if (!signedIn) fail(`profile ${PROFILE} is signed out; sign it in by hand first (the recorder never types a password)`)
    }
    const cast = await startScreencast(page)
    const d = new Driver(page, journey)
    for (const step of journey.steps) {
      try {
        await d.run(step)
        await d.checkPrivacy(step)
      } catch (e) {
        const shot = join(tmpdir(), `walkthrough-${journey.id}-failed.png`)
        await page.screenshot({ path: shot }).catch(() => {})
        throw new Error(`${e.message}\n  screen at failure: ${shot}`)
      }
    }
    const tEnd = d.now()
    await sleep(300)
    await cast.stop()
    if (d.t0 == null) fail(`${journey.id}: no start step`)
    const { mp4, poster } = encode(journey, cast.frames, d.t0, tEnd, workDir)
    // The docs CDN caches these for a year under fixed names; the hash in the
    // URL makes a re-recorded clip reach readers.
    const rev = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 10)
    const duration = +(tEnd - d.t0).toFixed(2)
    log(`${journey.id}: ${cast.frames.length} frames, ${duration}s -> ${mp4}`)
    return {
      id: journey.id,
      title: journey.title,
      summary: journey.summary,
      video: `/walkthroughs/${journey.id}.mp4?v=${rev(mp4)}`,
      poster: `/walkthroughs/${journey.id}.jpg?v=${rev(poster)}`,
      width: OUT_WIDTH,
      height: Math.round((OUT_WIDTH * VIEW.height) / VIEW.width),
      duration,
      chapters: d.chapters.map((c) => ({ ...c, t: +c.t.toFixed(2) })),
    }
  } finally {
    await ctx.close().catch(() => {})
    rmSync(workDir, { recursive: true, force: true })
  }
}

const wanted = process.argv.slice(2)
const list = wanted.length ? JOURNEYS.filter((j) => wanted.includes(j.id)) : JOURNEYS
if (wanted.length && list.length !== wanted.length) fail(`unknown journey in: ${wanted.join(', ')}`)
mkdirSync(OUT_DIR, { recursive: true })
const data = existsSync(DATA_FILE) ? JSON.parse(readFileSync(DATA_FILE, 'utf8')) : {}
for (const j of list) {
  data[j.id] = await record(j)
  writeFileSync(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`)
}
log('done')
