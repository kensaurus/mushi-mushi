// SPDX-License-Identifier: MIT
/**
 * `mushi-ux audit`: find UI/UX bugs on the signed-in screens of a live app
 * and file each one as a Mushi report, so the fix loop picks it up (ADR 0045).
 *
 * - The session is a cached, signed-in browser profile (`--profile-dir`),
 *   never a fresh browser that needs a new sign-in.
 * - Read-only: discovery and captures run behind the write guard (guard.ts).
 * - Facts first (ADR 0039): serious axe violations, sideways scrolling,
 *   console errors and layout shift come from measurements. A model review of
 *   the screenshots is optional and only adds concrete visual defects with an
 *   element and a "Done when"; taste notes are dropped.
 * - Filing is deduped by a fingerprint per (screen, kind, rule): a ledger on
 *   this machine plus a marker in the report description that the reports
 *   search finds, so an open report is never filed twice.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { captureSurface, openSession } from './capture.js'
import { askApi, askClaudeCode, askCursor } from './checker.js'
import { discover } from './discover.js'
import type { AllowRule } from './guard.js'
import { contentShare, cropTop } from './image.js'
import { CLS_GOOD, isFrameworkNoise } from './probes.js'
import { trimTrailingSlashes } from './routes.js'
import type { SyncConfig } from './sync.js'
import { VIEWPORTS, type ProbeResult, type Surface, type Viewport } from './types.js'

/** @internal Exported for tests only. */
export type FindingKind = 'axe' | 'overflow' | 'console' | 'cls' | 'visual' | 'explore'
type FindingSeverity = 'high' | 'medium' | 'low'
export type ReviewVia = 'claude-code' | 'anthropic-api' | 'cursor' | 'none'

export interface AuditFinding {
  /** sha1 of (path, screen key, kind, rule), 16 hex. */
  fingerprint: string
  kind: FindingKind
  /** axe rule id, 'horizontal-overflow', 'console-error', 'layout-shift', or the visual defect kind. */
  rule: string
  severity: FindingSeverity
  path: string
  screen: string
  viewports: Viewport['name'][]
  summary: string
  evidence: string[]
  expected: string
  doneWhen: string
  /** The report's footer line; default: the read-only audit. */
  foundBy?: string
}

type ScreenRef = Pick<Surface, 'key' | 'path' | 'label'>

const SEVERITY_RANK: Record<FindingSeverity, number> = { high: 3, medium: 2, low: 1 }
/** Layout shift past this is a jump a person notices, not just over the "good" line. */
const CLS_POOR = 0.25
const MAX_EVIDENCE = 6
/** Screenshot height sent to a model review: past it, a full page is mostly the same rows. */
const REVIEW_MAX_HEIGHT = 2400
export const AUDIT_FILE_CAP = 15
const AUDIT_DEDUPE_DAYS = 14

/** @internal Exported for tests only. Pure: a path without its query: `/reports?project=…` is one page however it was opened. */
export function pagePath(path: string): string {
  const q = path.search(/[?#]/)
  return q < 0 ? path : path.slice(0, q)
}

/**
 * @internal Exported for tests only.
 * Pure: a screen's name without the live counts a page title carries
 * ("Bugs · solo-boss-cloud · 95 reports" → "Bugs"), keeping the clicks that
 * reached it ("Bugs › Fix →"), so a report title stays the same across runs.
 */
export function screenName(label: string): string {
  const [page, ...steps] = label.split(' › ')
  const name = (page.split(' · ')[0] ?? page).trim() || page.trim()
  return [name, ...steps.map((s) => s.trim())].join(' › ').slice(0, 120)
}

/**
 * @internal Exported for tests only.
 * Pure: the stable id of one finding on one page. The same rule on the same
 * page is one finding, whichever tab or dialog it was seen in and whatever
 * the query string was.
 */
export function fingerprintOf(screen: Pick<ScreenRef, 'path'>, kind: FindingKind, rule: string): string {
  return createHash('sha1').update(`${pagePath(screen.path)}|${kind}|${rule}`).digest('hex').slice(0, 16)
}

/** Pure: the last, most specific part of a long axe selector. */
function shortSelector(selector: string): string {
  const last = selector.split(' > ').pop() ?? selector
  return last.length > 100 ? `${last.slice(0, 100)}…` : last
}

function finding(screen: ScreenRef, viewport: Viewport['name'], f: Omit<AuditFinding, 'fingerprint' | 'path' | 'screen' | 'viewports'>): AuditFinding {
  return { ...f, fingerprint: fingerprintOf(screen, f.kind, f.rule), path: screen.path, screen: screenName(screen.label), viewports: [viewport] }
}

/**
 * @internal Exported for tests only.
 * Pure: the measured findings of one screen at one viewport. Only what a
 * person would notice: serious or critical axe rules (not "moderate"), a page
 * that scrolls sideways, errors in the console, and layout shift past the
 * "good" line. Small tap targets stay out (counted by the run loop, too noisy
 * to file one report per screen).
 */
export function findingsFromProbes(screen: ScreenRef, viewport: Viewport, probes: ProbeResult): AuditFinding[] {
  const out: AuditFinding[] = []
  const where = `${screenName(screen.label)} at ${viewport.width}px`
  for (const v of probes.axe) {
    if (v.impact !== 'critical' && v.impact !== 'serious') continue
    out.push(
      finding(screen, viewport.name, {
        kind: 'axe',
        rule: v.id,
        severity: v.impact === 'critical' ? 'high' : 'medium',
        summary: `${v.help} (${v.count} element${v.count === 1 ? '' : 's'})`,
        evidence: [`axe ${v.id} (${v.impact}), ${viewport.name}: ${v.targets.slice(0, 3).map(shortSelector).join(' | ') || 'no selector'}`],
        expected: `No element on the screen fails the accessibility rule ${v.id}.`,
        doneWhen: `axe reports no ${v.id} violation on ${where}.`,
      }),
    )
  }
  if (probes.overflowX) {
    out.push(
      finding(screen, viewport.name, {
        kind: 'overflow',
        rule: 'horizontal-overflow',
        severity: 'medium',
        summary: `The page scrolls sideways at ${viewport.width}px wide`,
        evidence: [`document scrollWidth exceeds the ${viewport.width}px viewport (${viewport.name})`],
        expected: `Everything fits the ${viewport.width}px width; wide content (tables, code) scrolls inside its own box.`,
        doneWhen: `${where} has no horizontal page scroll.`,
      }),
    )
  }
  const errors = [...new Set(probes.consoleErrors.filter((m) => !isFrameworkNoise(m)))]
  if (errors.length) {
    out.push(
      finding(screen, viewport.name, {
        kind: 'console',
        rule: 'console-error',
        severity: 'medium',
        summary: `${errors.length} console error${errors.length === 1 ? '' : 's'} while the screen loads`,
        evidence: errors.slice(0, 3).map((m) => `console (${viewport.name}): ${m.slice(0, 240)}`),
        expected: 'The screen loads without errors in the browser console.',
        doneWhen: `Loading ${screenName(screen.label)} logs no console errors.`,
      }),
    )
  }
  if (probes.cls > CLS_GOOD) {
    out.push(
      finding(screen, viewport.name, {
        kind: 'cls',
        rule: 'layout-shift',
        severity: probes.cls > CLS_POOR ? 'medium' : 'low',
        summary: `Content jumps while the screen loads (layout shift ${probes.cls.toFixed(2)})`,
        evidence: [`cumulative layout shift ${probes.cls.toFixed(3)} at ${viewport.name} (good is ${CLS_GOOD} or less)`],
        expected: `Layout shift of ${CLS_GOOD} or less: space is reserved for content that loads late.`,
        doneWhen: `${where} measures a layout shift of ${CLS_GOOD} or less.`,
      }),
    )
  }
  return out
}

/** Below this share of non-background pixels a settled screen shows nothing. */
const BLANK_SHARE = 0.002

/**
 * @internal Exported for tests only.
 * Pure: a screen that settled with (almost) nothing drawn. On 2026-10-24 the
 * console rendered blank at /mushi-mushi/admin (no trailing slash: its router
 * basename did not match), with no error a probe could see.
 */
export function blankScreenFinding(screen: ScreenRef, viewport: Viewport, share: number): AuditFinding[] {
  if (share >= BLANK_SHARE) return []
  return [
    finding(screen, viewport.name, {
      kind: 'visual',
      rule: 'blank-screen',
      severity: 'high',
      summary: 'The screen loads blank',
      evidence: [`${(share * 100).toFixed(2)}% of the ${viewport.name} screenshot differs from the background after the page settled`],
      expected: 'The screen shows its content.',
      doneWhen: `${screenName(screen.label)} at ${viewport.width}px shows its content when opened at ${pagePath(screen.path)}.`,
    }),
  ]
}

/** @internal Exported for tests only. Pure: one finding per fingerprint, its viewports and evidence combined, the worst severity kept. */
export function mergeFindings(list: readonly AuditFinding[]): AuditFinding[] {
  const by = new Map<string, AuditFinding>()
  for (const f of list) {
    const cur = by.get(f.fingerprint)
    if (!cur) {
      by.set(f.fingerprint, { ...f, viewports: [...f.viewports], evidence: [...f.evidence] })
      continue
    }
    for (const v of f.viewports) if (!cur.viewports.includes(v)) cur.viewports.push(v)
    for (const e of f.evidence) if (!cur.evidence.includes(e) && cur.evidence.length < MAX_EVIDENCE) cur.evidence.push(e)
    if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[cur.severity]) cur.severity = f.severity
  }
  return [...by.values()].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.path.localeCompare(b.path))
}

/** Pure: the first selector an axe finding's evidence names. */
function firstSelector(f: AuditFinding): string | null {
  const line = f.evidence[0] ?? ''
  const at = line.indexOf(': ')
  const sel = at < 0 ? '' : line.slice(at + 2).split(' | ')[0].trim()
  return sel && sel !== 'no selector' ? sel : null
}

/**
 * @internal Exported for tests only.
 * Pure: the same axe rule failing on the same element on several pages is one
 * cause (a shared token or component), so it becomes one finding naming every
 * page instead of one report a page. On 2026-10-24 `.text-danger` failed
 * color-contrast on four console pages.
 */
export function groupSharedCauses(list: readonly AuditFinding[]): AuditFinding[] {
  const groups = new Map<string, AuditFinding[]>()
  const rest: AuditFinding[] = []
  for (const f of list) {
    const sel = f.kind === 'axe' ? firstSelector(f) : null
    if (!sel) {
      rest.push(f)
      continue
    }
    const key = `${f.rule}|${sel}`
    groups.set(key, [...(groups.get(key) ?? []), f])
  }
  const out = [...rest]
  for (const [key, fs] of groups) {
    if (fs.length < 2) {
      out.push(...fs)
      continue
    }
    const pages = [...fs].sort((a, b) => a.path.localeCompare(b.path))
    const sel = key.slice(key.indexOf('|') + 1)
    const names = pages.map((f) => f.screen)
    out.push({
      ...pages[0],
      fingerprint: createHash('sha1').update(`shared|axe|${key}`).digest('hex').slice(0, 16),
      screen: `${pages.length} screens`,
      viewports: [...new Set(pages.flatMap((f) => f.viewports))],
      severity: pages.some((f) => f.severity === 'high') ? 'high' : pages[0].severity,
      summary: `${pages[0].summary.replace(/ \(\d+ elements?\)$/, '')} on \`${sel}\` (${names.join(', ')})`,
      evidence: pages.flatMap((f) => f.evidence.map((e) => `${f.screen} (${pagePath(f.path)}): ${e}`)).slice(0, MAX_EVIDENCE),
      doneWhen: `axe reports no ${pages[0].rule} violation on ${names.join(', ')}.`,
    })
  }
  return out.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.path.localeCompare(b.path))
}

/** @internal Exported for tests only. The marker a filed report carries, found later by the reports search. */
export function auditMarker(fingerprint: string): string {
  return `mushi-ux-audit:${fingerprint}`
}

export interface AuditReportBody {
  title: string
  description: string
  severity: FindingSeverity
  component: string
}

/** @internal Exported for tests only. Pure: the report a finding files (POST /v1/admin/projects/:id/reports, the same body as `mushi reports file`). */
export function reportBodyFor(f: AuditFinding, baseUrl: string): AuditReportBody {
  const url = new URL(f.path, baseUrl).toString()
  const title = `${f.screen}: ${f.summary}`.slice(0, 200)
  const description = [
    `Page: ${url}`,
    `Viewport: ${f.viewports.map((v) => (v === 'mobile' ? 'phone 390x844' : 'desktop 1440x900')).join(', ')} (signed in)`,
    '',
    `What happens: ${f.summary}.`,
    '',
    'Evidence:',
    ...f.evidence.map((e) => `- ${e}`),
    '',
    `Expected: ${f.expected}`,
    `Done when: ${f.doneWhen}`,
    '',
    `${f.foundBy ?? 'Found by mushi-ux audit (read-only, cached signed-in session).'} ${auditMarker(f.fingerprint)}`,
  ].join('\n')
  return { title, description: description.slice(0, 10_000), severity: f.severity, component: new URL(url).pathname.slice(0, 200) }
}

/** @internal Exported for tests only. */
export type FiledLedger = Record<string, string>

/** Where `--file` remembers what it filed: per machine, never in a repo. */
export function auditHome(): string {
  return join(process.env.LOCALAPPDATA ?? join(homedir(), '.cache'), 'mushi', 'ux-audits')
}

function loadLedger(path: string): FiledLedger {
  try {
    const j = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return j && typeof j === 'object' ? (j as FiledLedger) : {}
  } catch {
    return {}
  }
}

/** @internal Exported for tests only. Pure: whether a fingerprint was filed in the last `days`. */
export function filedRecently(ledger: FiledLedger, fingerprint: string, now: Date, days = AUDIT_DEDUPE_DAYS): boolean {
  const at = ledger[fingerprint]
  return !!at && now.getTime() - Date.parse(at) < days * 86_400_000
}

// ── Model review (optional, judgement) ──────────────────────────────────────

const VISUAL_KINDS = ['overlap', 'clipping', 'contrast', 'layout', 'offscreen', 'broken_state', 'contradiction'] as const
/** A defect worded as a preference is a taste note, not a bug. */
const TASTE_RE = /\b(could|consider|might|maybe|perhaps|prefer|nicer|cleaner|more modern|feels?|would be better|slightly)\b/i

const REVIEW_PROMPT = (screen: string, files: string[]) => `You check one screen of a signed-in web app, "${screen}", for concrete UI defects.
${files.length === 2 ? 'The images desktop.png (1440px wide) and mobile.png (390px wide) show the screen' : `The image ${files[0]} shows the screen`}. ${files.length === 2 ? 'They are' : 'It is'} in the current folder: read ${files.length === 2 ? 'both' : 'it'}.
Report only defects a user would notice and a developer can fix: elements overlapping or clipped, text cut off or unreadable against its background, a broken or misaligned layout, a control pushed off-screen at phone width, an empty or broken state where content should be, or two numbers on this screen that contradict each other.
Do not report taste, copy preferences, "could be better", or anything you are unsure of. Content cut at the edge of a row or table that scrolls sideways is not a defect. Name the element and where it is.
Answer with ONLY this JSON: {"defects":[{"kind":"${VISUAL_KINDS.join('|')}","viewport":"desktop|mobile|both","element":"...","where":"...","problem":"...","severity":"high|medium|low","done_when":"..."}]} with at most 3 defects, or {"defects":[]}.`

/** @internal Exported for tests only. Pure: the visual findings in a review answer; incomplete, unknown or taste entries are dropped. */
export function visualFindingsFrom(answer: string | null, screen: ScreenRef): AuditFinding[] {
  if (!answer) return []
  const start = answer.indexOf('{')
  const end = answer.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(answer.slice(start, end + 1))
  } catch {
    return []
  }
  const defects = (parsed as { defects?: unknown }).defects
  if (!Array.isArray(defects)) return []
  const out: AuditFinding[] = []
  for (const d of defects.slice(0, 3) as Array<Record<string, unknown>>) {
    const kind = String(d.kind ?? '')
    const element = String(d.element ?? '').trim()
    const problem = String(d.problem ?? '').trim()
    const doneWhen = String(d.done_when ?? '').trim()
    if (!(VISUAL_KINDS as readonly string[]).includes(kind) || !element || !problem || !doneWhen) continue
    if (TASTE_RE.test(problem)) continue
    const vp = String(d.viewport ?? 'both')
    const viewports: Viewport['name'][] = vp === 'desktop' ? ['desktop'] : vp === 'mobile' ? ['mobile'] : ['desktop', 'mobile']
    const severity: FindingSeverity = d.severity === 'high' ? 'high' : d.severity === 'low' ? 'low' : 'medium'
    const rule = `${kind}:${element.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`
    out.push({
      fingerprint: fingerprintOf(screen, 'visual', rule),
      kind: 'visual',
      rule,
      severity,
      path: screen.path,
      screen: screenName(screen.label),
      viewports,
      summary: `${element}: ${problem}`.slice(0, 160),
      evidence: [`model review (${viewports.join(', ')}): ${element}${d.where ? ` (${String(d.where).slice(0, 120)})` : ''}: ${problem.slice(0, 300)}`],
      expected: `The ${element} shows without this defect.`,
      doneWhen: doneWhen.slice(0, 300),
    })
  }
  return out
}

async function reviewScreen(input: {
  screen: ScreenRef
  shots: Partial<Record<Viewport['name'], Buffer>>
  via: Exclude<ReviewVia, 'none'>
  model: string
  dir: string
  client?: Anthropic
}): Promise<{ findings: AuditFinding[]; error?: string }> {
  const names: string[] = []
  const images: Buffer[] = []
  for (const vp of ['desktop', 'mobile'] as const) {
    const png = input.shots[vp]
    if (!png) continue
    names.push(`${vp}.png`)
    images.push(cropTop(png, REVIEW_MAX_HEIGHT))
  }
  if (!images.length) return { findings: [] }
  mkdirSync(input.dir, { recursive: true })
  images.forEach((png, i) => writeFileSync(join(input.dir, names[i]), png))
  const prompt = REVIEW_PROMPT(screenName(input.screen.label), names)
  const a =
    input.via === 'claude-code'
      ? await askClaudeCode(prompt, input.dir, input.model)
      : input.via === 'cursor'
        ? await askCursor(prompt, input.dir, input.model)
        : await askApi(prompt, images, input.model, input.client ?? new Anthropic(), names)
  if (a.error || !a.text) return { findings: [], error: a.error ?? 'No answer.' }
  return { findings: visualFindingsFrom(a.text, input.screen) }
}

// ── The run ─────────────────────────────────────────────────────────────────

export interface AuditOptions {
  url: string
  profileDir?: string
  channel?: 'chrome' | 'chromium'
  paths?: string[]
  maxPages?: number
  /** Screens (pages, then their tabs and dialogs) captured in one run. */
  maxScreens?: number
  /** Tabs, dialogs and menus opened on each page (0: pages only). */
  statesPerPage?: number
  viewports?: Viewport['name'][]
  review?: ReviewVia
  reviewModel: string
  allow?: AllowRule[]
  ignore?: string[]
  onProgress?: (msg: string) => void
  /** Default: auditHome()/<run id>. */
  outDir?: string
  now?: () => Date
}

export interface AuditResult {
  runId: string
  dir: string
  screens: number
  findings: AuditFinding[]
  blockedWrites: number
  reviewErrors: string[]
}

const DEFAULT_MAX_SCREENS = 30

/**
 * @internal Exported for tests only.
 * Requests an audit lets through on top of `--allow`: a cached session
 * renewing itself writes no app data, and without it a signed-in app boots
 * blank (Supabase refreshes its access token with this POST; 25 were blocked
 * on the first console audit, 2026-10-24).
 */
export const AUDIT_DEFAULT_ALLOW = ['POST /auth/v1/token?grant_type=refresh_token'] as const

/** A network failure the write guard caused: the request it aborted. */
const GUARD_FETCH_ERROR_RE = /\b(failed to fetch|networkerror|load failed|net::err_failed|err_blocked_by_client)\b/i

/** @internal Exported for tests only. Pure: drop the console errors the guard caused when it blocked a request during this capture. */
export function dropGuardErrors(probes: ProbeResult, guardBlocked: boolean): ProbeResult {
  if (!guardBlocked) return probes
  return { ...probes, consoleErrors: probes.consoleErrors.filter((m) => !GUARD_FETCH_ERROR_RE.test(m)) }
}

/** @internal Exported for tests only. Pure: at most `max` screens, every page before any tab, dialog or menu, in discovery order. */
export function pickScreens<T extends Pick<Surface, 'kind'>>(surfaces: readonly T[], max: number): T[] {
  const pages = surfaces.filter((s) => s.kind === 'page')
  const rest = surfaces.filter((s) => s.kind !== 'page')
  return [...pages, ...rest].slice(0, Math.max(1, max))
}

/** Signed out: a password field, or a sign-in path, where the app should be. */
const SIGN_IN_PATH_RE = /\/(log-?in|sign-?in|auth)\b/i

export async function runAudit(opts: AuditOptions): Promise<AuditResult> {
  const progress = opts.onProgress ?? (() => {})
  const now = (opts.now ?? (() => new Date()))()
  const runId = `audit-${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
  const dir = opts.outDir ?? join(auditHome(), runId)
  mkdirSync(join(dir, 'shots'), { recursive: true })
  const base = new URL(opts.url)
  const scopePath = trimTrailingSlashes(base.pathname) || '/'
  const viewports = VIEWPORTS.filter((v) => (opts.viewports ?? ['desktop', 'mobile']).includes(v.name))
  const session = await openSession({
    profileDir: opts.profileDir,
    channel: opts.channel,
    allow: [...AUDIT_DEFAULT_ALLOW, ...(opts.allow ?? [])],
    ignore: opts.ignore,
    headless: true,
  })
  const findings: AuditFinding[] = []
  const reviewErrors: string[] = []
  try {
    await session.warmUp(opts.url, [base.pathname])
    const probe = await session.context.newPage()
    try {
      await probe.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await probe.waitForTimeout(2500)
      const signedOut = SIGN_IN_PATH_RE.test(new URL(probe.url()).pathname) || (await probe.locator('input[type="password"]').count()) > 0
      if (signedOut) throw new Error('The browser profile is signed out of this app. Ask the owner to sign the cached profile in once; never type credentials.')
    } finally {
      await probe.close()
    }
    const found = await discover(session, {
      baseUrl: opts.url,
      startPaths: [base.pathname, ...(opts.paths ?? [])],
      scopePath,
      maxPages: opts.maxPages ?? 15,
      // Clicking open each tab and dialog costs a settle per click (minutes a
      // page on a heavy console, 2026-10-24); an audit maps pages unless asked.
      maxStatesPerPage: opts.statesPerPage ?? 0,
      // Every route is its own page to an audit; the loop's shape dedupe
      // folds an app shell's pages into one.
      dedupe: 'route',
      onProgress: (m) => progress(m),
    })
    const surfaces = pickScreens(found, opts.maxScreens ?? DEFAULT_MAX_SCREENS)
    progress(`${surfaces.length} of ${found.length} screen(s) to audit`)
    for (const s of surfaces) {
      const shots: Partial<Record<Viewport['name'], Buffer>> = {}
      for (const vp of viewports) {
        try {
          const blockedBefore = session.guard.blocked.length
          const cap = await captureSurface(session, opts.url, s, vp)
          shots[vp.name] = cap.png
          writeFileSync(join(dir, 'shots', `${s.key}-${vp.name}.png`), cap.png)
          const probes = dropGuardErrors(cap.probes, session.guard.blocked.length > blockedBefore)
          findings.push(...findingsFromProbes(s, vp, probes), ...blankScreenFinding(s, vp, contentShare(cap.png)))
        } catch (err) {
          progress(`could not capture ${s.path} at ${vp.name}: ${(err as Error).message.split('\n')[0].slice(0, 160)}`)
        }
      }
      // The model sees whole pages; a tab or dialog is measured, not reviewed (one call a page keeps a run's cost bounded).
      if (opts.review && opts.review !== 'none' && s.kind === 'page') {
        const r = await reviewScreen({ screen: s, shots, via: opts.review, model: opts.reviewModel, dir: join(dir, 'review', s.key) })
        if (r.error) reviewErrors.push(`${s.path}: ${r.error}`)
        findings.push(...r.findings)
      }
      progress(`audited ${s.label}`)
    }
    const merged = groupSharedCauses(mergeFindings(findings))
    const blocked = blockedSummary(session.guard.blocked)
    writeFileSync(join(dir, 'findings.json'), JSON.stringify({ runId, url: opts.url, screens: surfaces.length, blocked, findings: merged }, null, 2))
    writeFileSync(join(dir, 'summary.md'), summaryMarkdown(opts.url, surfaces.length, merged, blocked))
    return { runId, dir, screens: surfaces.length, findings: merged, blockedWrites: session.guard.blocked.length, reviewErrors }
  } finally {
    await session.close()
  }
}

/** Pure: the run's summary as Markdown. */
function summaryMarkdown(url: string, screens: number, findings: readonly AuditFinding[], blocked: ReadonlyArray<{ request: string; count: number }>): string {
  const total = blocked.reduce((n, b) => n + b.count, 0)
  const lines = [`# UX audit of ${url}`, '', `${screens} screen(s), ${findings.length} finding(s), ${total} write request(s) blocked.`, '']
  if (blocked.length) {
    lines.push('Blocked requests (pass reads among them with `--allow "METHOD /path*"`):', '', ...blocked.slice(0, 20).map((b) => `- ${b.request} ×${b.count}`), '')
  }
  for (const f of findings) {
    lines.push(`## ${f.severity.toUpperCase()} · ${f.screen}: ${f.summary}`, '', `- Page: ${f.path} (${f.viewports.join(', ')})`, ...f.evidence.map((e) => `- ${e}`), `- Done when: ${f.doneWhen}`, '')
  }
  return lines.join('\n')
}

/** @internal Exported for tests only. Pure: blocked requests as "METHOD /path" with counts, query strings dropped, most frequent first. */
export function blockedSummary(blocked: ReadonlyArray<{ method: string; url: string }>): Array<{ request: string; count: number }> {
  const counts = new Map<string, number>()
  for (const b of blocked) {
    let path = b.url
    try {
      path = new URL(b.url).pathname
    } catch {
      /* keep the raw value */
    }
    const key = `${b.method.toUpperCase()} ${path}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts].map(([request, count]) => ({ request, count })).sort((a, b) => b.count - a.count || a.request.localeCompare(b.request))
}

// ── Filing ──────────────────────────────────────────────────────────────────

export interface FileOutcome {
  filed: Array<{ fingerprint: string; reportId: string; title: string }>
  skipped: Array<{ fingerprint: string; reason: string }>
  /** Bodies left to file when no credentials were available. */
  pending: AuditReportBody[]
}

async function api(cfg: SyncConfig, path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(`${cfg.endpoint}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}`, 'X-Mushi-Api-Key': cfg.apiKey, 'X-Mushi-Project': cfg.projectId, ...(init.headers ?? {}) },
  })
  const body = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, body }
}

/** An open report already carries this finding's marker. */
async function openReportExists(cfg: SyncConfig, fingerprint: string): Promise<boolean> {
  const r = await api(cfg, `/v1/admin/reports?q=${encodeURIComponent(auditMarker(fingerprint))}&limit=5`)
  if (!r.ok) return false
  const reports = ((r.body as { data?: { reports?: Array<{ status?: string }> } } | null)?.data?.reports ?? []) as Array<{ status?: string }>
  return reports.some((x) => !['fixed', 'resolved', 'verified', 'dismissed'].includes(String(x.status ?? '')))
}

export async function fileFindings(input: {
  findings: readonly AuditFinding[]
  baseUrl: string
  cfg: SyncConfig | null
  ledgerPath: string
  dryRun?: boolean
  cap?: number
  now?: Date
}): Promise<FileOutcome> {
  const now = input.now ?? new Date()
  const ledger = loadLedger(input.ledgerPath)
  const out: FileOutcome = { filed: [], skipped: [], pending: [] }
  const cap = input.cap ?? AUDIT_FILE_CAP
  for (const f of input.findings) {
    if (out.filed.length + out.pending.length >= cap) {
      out.skipped.push({ fingerprint: f.fingerprint, reason: `cap of ${cap} reached` })
      continue
    }
    if (filedRecently(ledger, f.fingerprint, now)) {
      out.skipped.push({ fingerprint: f.fingerprint, reason: `filed in the last ${AUDIT_DEDUPE_DAYS} days` })
      continue
    }
    const body = reportBodyFor(f, input.baseUrl)
    if (input.dryRun || !input.cfg) {
      out.pending.push(body)
      continue
    }
    if (await openReportExists(input.cfg, f.fingerprint)) {
      out.skipped.push({ fingerprint: f.fingerprint, reason: 'an open report has it' })
      ledger[f.fingerprint] = now.toISOString()
      continue
    }
    const r = await api(input.cfg, `/v1/admin/projects/${input.cfg.projectId}/reports`, { method: 'POST', body: JSON.stringify(body) })
    const reportId = (r.body as { data?: { reportId?: string } } | null)?.data?.reportId
    if (!r.ok || !reportId) {
      out.skipped.push({ fingerprint: f.fingerprint, reason: `the API answered ${r.status}` })
      continue
    }
    ledger[f.fingerprint] = now.toISOString()
    out.filed.push({ fingerprint: f.fingerprint, reportId, title: body.title })
  }
  if (!input.dryRun && input.cfg) {
    mkdirSync(join(input.ledgerPath, '..'), { recursive: true })
    writeFileSync(input.ledgerPath, JSON.stringify(ledger, null, 2))
  }
  return out
}

/** Bodies left to file (no credentials, or --dry-run), next to the run's summary. */
export function writePending(dir: string, pending: readonly AuditReportBody[]): string | null {
  if (!pending.length) return null
  const path = join(dir, 'to-file.json')
  writeFileSync(path, JSON.stringify(pending, null, 2))
  return path
}
