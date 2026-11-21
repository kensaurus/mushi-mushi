// SPDX-License-Identifier: MIT
/**
 * `mushi-ux scorecard`: score every page of a live app against a written
 * rubric (ADR 0067), group what is wrong into root causes, and file the top
 * ones as Mushi reports.
 *
 * - Pages: `--path` / `--paths-file` (a route list), else the routes in the
 *   app's source (`--routes-from`), else a crawl under the URL. A page keeps
 *   its view (`/team?view=sso` is its own page).
 * - Capture: the audit's read-only session (a cached, signed-in profile, the
 *   write guard), one viewport (desktop-first; the app's setting or
 *   `--viewport`). Each page gives an early screenshot (about 1 s), a settled
 *   one, its tab title, text, controls, settle time and axe counts.
 *   `--from-captures` scores captures another browser driver made in the same
 *   layout, so no second browser opens on a profile already in use.
 * - Score: `--score-via server` sends each page to the `ux-scorecard`
 *   platform route (the app's own key first); `claude-code`, `cursor` and
 *   `anthropic-api` score on this machine. Both run the same rubric module
 *   (scorecard-rubric.ts, byte-identical to the server's).
 * - Output: scorecard.md and scorecard.json in the run folder; `--sync` puts
 *   it on the console (Check → UX runs → Scorecard); `--file` files one report
 *   per root cause, at most five a run.
 */

import Anthropic from '@anthropic-ai/sdk'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { AUDIT_DEFAULT_ALLOW, auditHome } from './audit.js'
import { gotoPatiently, openSession, surfaceUrl, type BrowserSession } from './capture.js'
import { askApi, askClaudeCode, askCursor } from './checker.js'
import { discover } from './discover.js'
import type { AllowRule } from './guard.js'
import { isFrameworkNoise, runProbes } from './probes.js'
import { routesFromSource, trimTrailingSlashes } from './routes.js'
import {
  groupCauses,
  groupingPrompt,
  mergeGrouping,
  pageSystemPrompt,
  pageUserPrompt,
  parsePageAnswer,
  scorecardMarkdown,
  scorecardPageKey,
  scorecardRows,
  type ScoredPage,
  type UxCause,
  type UxPageFacts,
  type UxPageScore,
} from './scorecard-rubric.js'
import type { SyncConfig } from './sync.js'

export type ScoreVia = 'server' | 'claude-code' | 'cursor' | 'anthropic-api'

export const DEFAULT_SCORECARD_VIEWPORT = { width: 1440, height: 900 } as const
/** Model for the local transports (claude-code, anthropic-api): the standard tier. */
export const DEFAULT_SCORECARD_MODEL = 'claude-sonnet-5-5'
/** When the first screenshot is taken: loading and placeholder states show here. */
const EARLY_MS = 1000
/** The page counts as settled once its text and busy markers hold this long. */
const QUIET_MS = 1200
/** A page that has not settled by now is scored as it is, with "did not settle". */
const MAX_SETTLE_MS = 15_000

// ── What a page says ────────────────────────────────────────────────────────

/** In-page: the facts a reader of the page gets, and whether it still looks busy. Kept as source so any driver can evaluate it. */
export const FACTS_SCRIPT = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
  const clean = (t) => (t || '').replace(/\\s+/g, ' ').trim()
  const main = document.querySelector('main, [role="main"]') || document.body
  const outside = []
  for (const el of document.querySelectorAll('[role="alert"], [role="status"], [aria-live], header, [class*="toast" i], [class*="banner" i]')) {
    if (main.contains(el) || !visible(el)) continue
    const t = clean(el.innerText)
    if (t && t.length < 400 && !outside.includes(t)) outside.push(t)
  }
  const crumb = document.querySelector('nav[aria-label*="readcrumb" i], [class*="breadcrumb" i]')
  const headings = [...main.querySelectorAll('h1, h2, h3')].filter(visible).map((h) => clean(h.innerText)).filter(Boolean)
  const controls = []
  for (const el of main.querySelectorAll('button, a[href], [role="button"], [role="tab"], select')) {
    if (!visible(el)) continue
    const t = clean(el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '')
    if (t && t.length <= 80 && !controls.includes(t)) controls.push(t)
    if (controls.length >= 100) break
  }
  const text = clean(main.innerText)
  const busy = !!document.querySelector('[aria-busy="true"]') || [...document.querySelectorAll('[class*="skeleton" i], .animate-pulse')].some(visible) || /\\b(loading|checking|reading|fetching|composing)\\b[^.\\n]{0,40}(…|\\.\\.\\.)/i.test(text)
  return {
    title: document.title,
    breadcrumb: crumb ? clean(crumb.innerText) : '',
    headings: headings.slice(0, 40),
    text: (outside.length ? 'Outside the page content: ' + outside.join(' | ') + '\\n' : '') + text,
    controls,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    busy,
    sig: text.length + ':' + text.slice(0, 400),
  }
})()`

interface RawFacts {
  title: string
  breadcrumb: string
  headings: string[]
  text: string
  controls: string[]
  overflowX: boolean
  busy: boolean
  sig: string
}

async function readFacts(page: Page): Promise<RawFacts> {
  return (await page.evaluate(FACTS_SCRIPT)) as RawFacts
}

/**
 * Wait until the page's text and busy markers stop changing. Returns the
 * milliseconds from navigation to the last change, or null when the page was
 * still changing at the cap.
 */
async function waitUntilSettled(page: Page, t0: number, maxMs = MAX_SETTLE_MS): Promise<number | null> {
  let last = ''
  let lastChange = Date.now()
  while (Date.now() - t0 < maxMs) {
    const f = await readFacts(page).catch(() => null)
    const sig = f ? `${f.busy ? 'busy|' : ''}${f.sig}` : ''
    if (sig !== last) {
      last = sig
      lastChange = Date.now()
    }
    if (f && !f.busy && Date.now() - lastChange >= QUIET_MS) return Math.max(0, lastChange - t0)
    await page.waitForTimeout(250)
  }
  return null
}

export interface PageCapture {
  facts: UxPageFacts
  early: Buffer
  settled: Buffer
}

/** Load one page and capture what a person sees early and once it settles. Works on any Playwright page. */
export async function capturePage(page: Page, input: { baseUrl: string; path: string; label?: string; viewport: { width: number; height: number }; ignore?: readonly string[]; axe?: boolean }): Promise<PageCapture> {
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isFrameworkNoise(msg.text())) consoleErrors.push(msg.text().slice(0, 300))
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err.message).slice(0, 300)))
  await page.setViewportSize(input.viewport)
  const t0 = Date.now()
  await gotoPatiently(page, surfaceUrl(input.baseUrl, input.path))
  await page.waitForTimeout(Math.max(0, EARLY_MS - (Date.now() - t0)))
  const early = await page.screenshot({ animations: 'disabled', caret: 'hide' })
  const earlyFacts = await readFacts(page).catch(() => null)
  const settleMs = await waitUntilSettled(page, t0)
  const settled = await page.screenshot({ animations: 'disabled', caret: 'hide' })
  const f = await readFacts(page)
  const probes = input.axe === false ? null : await runProbes(page, consoleErrors, input.ignore ?? []).catch(() => null)
  const serious = probes?.axe.filter((v) => v.impact === 'serious') ?? []
  const critical = probes?.axe.filter((v) => v.impact === 'critical') ?? []
  const key = scorecardPageKey(input.path)
  return {
    early,
    settled,
    facts: {
      key,
      path: input.path,
      label: input.label || f.headings[0] || key,
      title: f.title,
      ...(f.breadcrumb ? { breadcrumb: f.breadcrumb } : {}),
      headings: f.headings,
      text: f.text.slice(0, 8000),
      controls: f.controls,
      ...(earlyFacts && earlyFacts.text !== f.text ? { earlyText: earlyFacts.text.slice(0, 3000) } : {}),
      settleMs,
      axe: probes ? { serious: serious.length, critical: critical.length, rules: [...serious, ...critical].map((v) => v.id).slice(0, 20) } : null,
      overflowX: probes?.overflowX ?? f.overflowX,
      consoleErrors: consoleErrors.length,
      cls: probes?.cls ?? 0,
      viewport: { width: input.viewport.width, height: input.viewport.height },
    },
  }
}

// ── Captures on disk ────────────────────────────────────────────────────────

/** Pure: a folder name for a page key. */
export function captureFolder(key: string): string {
  return key.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join('-').slice(0, 110) || 'root'
}

function writeCapture(dir: string, c: PageCapture): string {
  const folder = join(dir, 'pages', captureFolder(c.facts.key))
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'facts.json'), JSON.stringify(c.facts, null, 2))
  writeFileSync(join(folder, 'early.png'), c.early)
  writeFileSync(join(folder, 'settled.png'), c.settled)
  return folder
}

/** Captures in `<dir>/pages/<page>/{facts.json, early.png, settled.png}`, as this tool or another driver wrote them. */
export function readCaptures(dir: string): Array<{ folder: string; facts: UxPageFacts }> {
  const root = join(dir, 'pages')
  if (!existsSync(root)) return []
  const out: Array<{ folder: string; facts: UxPageFacts }> = []
  for (const name of readdirSync(root).sort()) {
    const folder = join(root, name)
    const file = join(folder, 'facts.json')
    if (!existsSync(file)) continue
    const facts = JSON.parse(readFileSync(file, 'utf8')) as UxPageFacts
    out.push({ folder, facts: { ...facts, key: scorecardPageKey(facts.key || facts.path) } })
  }
  return out
}

// ── Scoring ─────────────────────────────────────────────────────────────────

export interface Scorer {
  readonly name: string
  score(facts: UxPageFacts, folder: string, ctx: { app: string; otherPages: string[]; about?: string }): Promise<{ score?: UxPageScore; error?: string }>
  group(pages: readonly ScoredPage[], base: readonly UxCause[], priorKeys: readonly string[]): Promise<{ causes: UxCause[]; error?: string }>
  /** Screenshot names this scorer already uploaded, per page key (the server scorer uploads as it scores). */
  readonly uploaded?: ReadonlyMap<string, string[]>
}

/** Score on this machine through one of the checker's transports. */
export function localScorer(via: Exclude<ScoreVia, 'server'>, model: string, client?: Anthropic): Scorer {
  const ask = async (prompt: string, folder: string, images: string[]): Promise<{ text: string | null; error?: string }> => {
    if (via === 'claude-code') return askClaudeCode(prompt, folder, model, undefined, images.length + 3)
    if (via === 'cursor') return askCursor(prompt, folder, model)
    const bufs = images.map((n) => readFileSync(join(folder, n)))
    return askApi(prompt, bufs, model, client ?? new Anthropic(), images)
  }
  return {
    name: `${via}:${model}`,
    async score(facts, folder, ctx) {
      const images = ['early.png', 'settled.png'].filter((n) => existsSync(join(folder, n)))
      const prompt = `${pageSystemPrompt()}\n\n${pageUserPrompt(facts, { ...ctx, images })}`
      const a = await ask(prompt, folder, images)
      if (!a.text) return { error: a.error ?? 'No answer.' }
      const parsed = parsePageAnswer(a.text, facts)
      return parsed.ok ? { score: parsed.value } : { error: parsed.error }
    },
    async group(pages, base, priorKeys) {
      if (pages.length < 2) return { causes: [...base] }
      const p = groupingPrompt(pages, priorKeys)
      const dir = join(auditHome(), 'scorecard-group')
      mkdirSync(dir, { recursive: true })
      const a = await ask(`${p.system}\n\n${p.user}`, dir, [])
      if (!a.text) return { causes: [...base], error: a.error ?? 'No answer.' }
      return { causes: mergeGrouping(pages, base, a.text, priorKeys) }
    },
  }
}

async function api(cfg: SyncConfig, path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(`${cfg.endpoint}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}`, 'X-Mushi-Api-Key': cfg.apiKey, 'X-Mushi-Project': cfg.projectId, ...(init.headers ?? {}) },
  })
  const body = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, body }
}

function apiError(r: { status: number; body: unknown }): string {
  const e = (r.body as { error?: { message?: string } } | null)?.error?.message
  return `the API answered ${r.status}${e ? `: ${e.slice(0, 200)}` : ''}`
}

/** Upload a page's screenshots to the run; the names it uploaded. */
async function uploadShots(cfg: SyncConfig, runId: string, folder: string, key: string): Promise<string[]> {
  const base = captureFolder(key)
  const names = ['early', 'settled'].filter((n) => existsSync(join(folder, `${n}.png`))).map((n) => `${base}/${n}.png`)
  if (!names.length) return []
  const r = await api(cfg, `/v1/admin/projects/${cfg.projectId}/ux-scorecard/${runId}/uploads`, { method: 'POST', body: JSON.stringify({ names }) })
  if (!r.ok) throw new Error(`Screenshots not uploaded: ${apiError(r)}`)
  const uploads = ((r.body as { data?: { uploads?: Array<{ name: string; signedUrl: string }> } } | null)?.data?.uploads ?? []) as Array<{ name: string; signedUrl: string }>
  for (const u of uploads) {
    const png = readFileSync(join(folder, u.name.split('/').pop()!))
    const put = await fetch(u.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(png) })
    if (!put.ok) throw new Error(`Screenshot ${u.name} not uploaded: storage answered ${put.status}`)
  }
  return names
}

/** Score on the server through the `ux-scorecard` platform route (the app's own key first). */
export function serverScorer(cfg: SyncConfig, runId: string): Scorer {
  const uploaded = new Map<string, string[]>()
  return {
    name: 'server',
    uploaded,
    async score(facts, folder, ctx) {
      const shots = await uploadShots(cfg, runId, folder, facts.key)
      uploaded.set(facts.key, shots)
      const r = await api(cfg, `/v1/admin/projects/${cfg.projectId}/ux-scorecard/${runId}/score`, {
        method: 'POST',
        body: JSON.stringify({ facts, shots, app: ctx.app, about: ctx.about, other_pages: ctx.otherPages }),
      })
      if (!r.ok) return { error: apiError(r) }
      const score = (r.body as { data?: { score?: UxPageScore } } | null)?.data?.score
      return score ? { score } : { error: 'The API returned no score.' }
    },
    async group(_pages, base) {
      const r = await api(cfg, `/v1/admin/projects/${cfg.projectId}/ux-scorecard/${runId}/group`, { method: 'POST', body: '{}' })
      if (!r.ok) return { causes: [...base], error: apiError(r) }
      return { causes: ((r.body as { data?: { causes?: UxCause[] } } | null)?.data?.causes ?? [...base]) as UxCause[] }
    },
  }
}

// ── The run ─────────────────────────────────────────────────────────────────

export interface ScorecardOptions {
  url: string
  app: string
  about?: string
  /** Pages to score (paths with their view query). Default: the routes in `routesFrom`, else a crawl. */
  paths?: string[]
  routesFrom?: string
  maxPages?: number
  viewport?: { width: number; height: number }
  /** Score captures already on disk instead of opening a browser. */
  fromCaptures?: string
  profileDir?: string
  channel?: 'chrome' | 'chromium'
  allow?: AllowRule[]
  ignore?: string[]
  scorer: Scorer
  /** Pages scored at once (local transports are slow; the server takes one page a request). */
  concurrency?: number
  /** Earlier runs' pattern keys, so a reworded cause keeps its report. */
  priorKeys?: string[]
  /** Earlier runs' page scores, for the trend in scorecard.md. */
  history?: Array<{ key: string; overall: number; at: string }>
  runId: string
  outDir?: string
  onProgress?: (msg: string) => void
  /** After each page is captured or scored (the CLI syncs the run as it goes). */
  onPage?: (page: ScorecardPageResult) => Promise<void> | void
}

export interface ScorecardPageResult {
  facts: UxPageFacts
  folder: string
  score?: UxPageScore
  error?: string
}

export interface ScorecardResult {
  runId: string
  dir: string
  pages: ScorecardPageResult[]
  causes: UxCause[]
  groupError?: string
  markdown: string
}

const SIGN_IN_PATH_RE = /\/(log-?in|sign-?in|auth)\b/i

/** Pure: a scorecard run id in the console's format (yyyymmdd-hhmmss-xxxx). */
export function scorecardRunId(now: Date, rand: () => number = Math.random): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const d = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`
  const tail = Array.from({ length: 4 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rand() * 36)]).join('')
  return `${d}-${tail}`
}

async function pagesToScore(session: BrowserSession, opts: ScorecardOptions): Promise<string[]> {
  if (opts.paths?.length) return opts.paths
  const scopePath = trimTrailingSlashes(new URL(opts.url).pathname) || '/'
  if (opts.routesFrom) {
    const routes = routesFromSource(opts.routesFrom)
    if (routes.length) return routes.map((r) => (r.startsWith('/') ? r : `/${r}`))
  }
  const found = await discover(session, { baseUrl: opts.url, startPaths: [new URL(opts.url).pathname], scopePath, maxPages: opts.maxPages ?? 40, maxStatesPerPage: 0, dedupe: 'route' })
  return found.filter((s) => s.kind === 'page').map((s) => s.path)
}

async function captureAll(opts: ScorecardOptions, dir: string, progress: (m: string) => void): Promise<Array<{ folder: string; facts: UxPageFacts; error?: string }>> {
  const viewport = opts.viewport ?? DEFAULT_SCORECARD_VIEWPORT
  const session = await openSession({ profileDir: opts.profileDir, channel: opts.channel, allow: [...AUDIT_DEFAULT_ALLOW, ...(opts.allow ?? [])], ignore: opts.ignore, headless: true })
  const out: Array<{ folder: string; facts: UxPageFacts; error?: string }> = []
  try {
    await session.warmUp(opts.url, [new URL(opts.url).pathname])
    const probe = await session.context.newPage()
    try {
      await probe.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await probe.waitForTimeout(2500)
      if (SIGN_IN_PATH_RE.test(new URL(probe.url()).pathname) || (await probe.locator('input[type="password"]').count()) > 0) {
        throw new Error('The browser profile is signed out of this app. Ask the owner to sign the cached profile in once; never type credentials.')
      }
    } finally {
      await probe.close()
    }
    const paths = [...new Set(await pagesToScore(session, opts))].slice(0, opts.maxPages ?? 120)
    progress(`${paths.length} page(s) to capture at ${viewport.width}x${viewport.height}`)
    for (const path of paths) {
      const ctx = await session.freshContext()
      const page = await ctx.newPage()
      try {
        const cap = await capturePage(page, { baseUrl: opts.url, path, viewport, ignore: session.ignore })
        out.push({ folder: writeCapture(dir, cap), facts: cap.facts })
        progress(`captured ${path} (${cap.facts.settleMs == null ? 'did not settle' : `${(cap.facts.settleMs / 1000).toFixed(1)} s`})`)
      } catch (err) {
        const key = scorecardPageKey(path)
        const msg = (err as Error).message.split('\n')[0].slice(0, 300)
        out.push({ folder: join(dir, 'pages', captureFolder(key)), facts: blankFacts(key, path, viewport), error: `Not captured: ${msg}` })
        progress(`could not capture ${path}: ${msg}`)
      } finally {
        await ctx.close()
      }
    }
  } finally {
    await session.close()
  }
  return out
}

function blankFacts(key: string, path: string, viewport: { width: number; height: number }): UxPageFacts {
  return { key, path, label: key, title: '', headings: [], text: '', controls: [], settleMs: null, axe: null, overflowX: false, consoleErrors: 0, cls: 0, viewport }
}

/** Run `fn` over items, at most `n` at a time, in order of start. */
async function pool<T>(items: readonly T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const worker = async () => {
    while (i < items.length) await fn(items[i++])
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker))
}

export async function runScorecard(opts: ScorecardOptions): Promise<ScorecardResult> {
  const progress = opts.onProgress ?? (() => {})
  const dir = opts.outDir ?? opts.fromCaptures ?? join(auditHome(), `scorecard-${opts.runId}`)
  mkdirSync(dir, { recursive: true })
  const captured = opts.fromCaptures ? readCaptures(opts.fromCaptures) : await captureAll(opts, dir, progress)
  if (!captured.length) throw new Error(opts.fromCaptures ? `No captures in ${opts.fromCaptures}/pages.` : 'No pages to score.')
  const labels = captured.map((c) => c.facts.label)
  const results: ScorecardPageResult[] = captured.map((c) => ({ ...c }))
  for (const r of results) await opts.onPage?.(r)
  await pool(
    results.filter((r) => !r.error),
    opts.concurrency ?? (opts.scorer.name === 'server' ? 3 : 4),
    async (r) => {
      const ask = () => opts.scorer.score(r.facts, r.folder, { app: opts.app, about: opts.about, otherPages: labels.filter((l) => l !== r.facts.label) }).catch((err: Error) => ({ error: err.message, score: undefined }))
      // One retry: an answer with no JSON, or a busy model, usually comes right
      // the second time (1 of 72 console pages on 2026-11-21).
      let s = await ask()
      if (!s.score) s = await ask()
      if (s.score) r.score = s.score
      else r.error = `Not scored: ${s.error ?? 'no answer'}`
      progress(r.score ? `scored ${r.facts.key}: ${r.score.overall}/10` : `could not score ${r.facts.key}: ${r.error}`)
      await opts.onPage?.(r)
    },
  )
  const scored: ScoredPage[] = results.filter((r) => r.score).map((r) => ({ key: r.facts.key, label: r.facts.label, score: r.score!, facts: r.facts }))
  const base = groupCauses(scored, opts.priorKeys ?? [])
  progress(`grouping ${scored.reduce((n, p) => n + p.score.issues.length, 0)} issue(s) on ${scored.length} page(s)`)
  const grouped = await opts.scorer.group(scored, base, opts.priorKeys ?? [])
  const markdown = scorecardMarkdown({
    app: opts.app,
    url: opts.url,
    at: new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z',
    viewport: opts.viewport ?? captured[0]?.facts.viewport ?? DEFAULT_SCORECARD_VIEWPORT,
    rows: scorecardRows(scored, opts.history ?? []),
    causes: grouped.causes,
  })
  writeFileSync(join(dir, 'scorecard.md'), markdown)
  writeFileSync(join(dir, 'scorecard.json'), JSON.stringify({ runId: opts.runId, app: opts.app, url: opts.url, scoredBy: opts.scorer.name, pages: results, causes: grouped.causes, groupError: grouped.error ?? null }, null, 2))
  return { runId: opts.runId, dir, pages: results, causes: grouped.causes, ...(grouped.error ? { groupError: grouped.error } : {}), markdown }
}

// ── Console sync and filing ─────────────────────────────────────────────────

/** Put the run on the console. Pages scored on the server are left as the server scored them. */
export async function syncScorecard(
  cfg: SyncConfig,
  input: { runId: string; url: string; viewport: { width: number; height: number }; scoredBy: string; startedAt: string; finished: boolean; error?: string; pages: readonly ScorecardPageResult[]; causes?: readonly UxCause[]; cliVersion?: string; uploaded?: ReadonlyMap<string, string[]> },
): Promise<string | null> {
  const body = {
    status: input.error ? 'failed' : input.finished ? 'done' : 'running',
    start_url: input.url,
    viewport: `${input.viewport.width}x${input.viewport.height}`,
    scored_by: input.scoredBy,
    ...(input.cliVersion ? { cli_version: input.cliVersion } : {}),
    started_at: input.startedAt,
    finished_at: input.finished ? new Date().toISOString() : null,
    error: input.error ?? null,
    pages: input.pages.map((p) => ({ facts: p.facts, score: p.score ?? null, shots: input.uploaded?.get(p.facts.key) ?? [], ...(p.error && !p.score ? { error: p.error } : {}) })),
    ...(input.causes ? { causes: input.causes } : {}),
  }
  const r = await api(cfg, `/v1/admin/projects/${cfg.projectId}/ux-scorecard/${input.runId}`, { method: 'PUT', body: JSON.stringify(body) })
  return r.ok ? null : apiError(r)
}

/** Upload every page's screenshots (local scoring: the server scorer uploads as it scores). */
export async function uploadAllShots(cfg: SyncConfig, runId: string, pages: readonly ScorecardPageResult[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  for (const p of pages) {
    if (p.error && !p.score) continue
    out.set(p.facts.key, await uploadShots(cfg, runId, p.folder, p.facts.key))
  }
  return out
}

export interface ScorecardFileOutcome {
  filed: Array<{ reportId: string; patternKey: string; title: string }>
  updated: Array<{ reportId: string; patternKey: string }>
  skipped: Array<{ patternKey: string; reason: string }>
  wouldFile?: Array<{ patternKey: string; title: string; pages: number }>
}

/** File the run's top root causes (the server plans: one per pattern, the run and app caps). */
export async function fileScorecard(cfg: SyncConfig, runId: string, input: { causes?: readonly UxCause[]; dryRun?: boolean }): Promise<ScorecardFileOutcome> {
  const r = await api(cfg, `/v1/admin/projects/${cfg.projectId}/ux-scorecard/${runId}/file`, { method: 'POST', body: JSON.stringify({ ...(input.causes ? { causes: input.causes } : {}), dry_run: input.dryRun === true }) })
  if (!r.ok) throw new Error(`Causes not filed: ${apiError(r)}`)
  return ((r.body as { data?: ScorecardFileOutcome } | null)?.data ?? { filed: [], updated: [], skipped: [] }) as ScorecardFileOutcome
}

/** The app's earlier scorecard: its viewport setting, open pattern keys and page history, for a new run. */
export async function scorecardContext(cfg: SyncConfig): Promise<{ viewport: string | null; history: Array<{ key: string; overall: number; at: string }>; priorKeys: string[] }> {
  const r = await api(cfg, `/v1/admin/projects/${cfg.projectId}/ux-scorecard`)
  if (!r.ok) return { viewport: null, history: [], priorKeys: [] }
  const d = (r.body as { data?: { viewport?: string; rows?: Array<{ key: string; overall: number }>; run?: { started_at?: string }; reports?: Array<{ pattern_key?: string | null; status?: string }> } } | null)?.data
  const at = d?.run?.started_at ?? ''
  return {
    viewport: d?.viewport ?? null,
    history: (d?.rows ?? []).map((x) => ({ key: x.key, overall: x.overall, at })),
    priorKeys: (d?.reports ?? []).map((x) => x.pattern_key).filter((k): k is string => !!k),
  }
}
