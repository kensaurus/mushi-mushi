/**
 * FILE: packages/server/supabase/functions/_shared/fix-context.ts
 * PURPOSE: The "Relevant code" the fix model sees: which files, in what
 *          order, and their FULL current contents from the base branch the
 *          PR will branch from.
 *
 * Why (2026-10-03): the context used to be codebase-index previews (RAG
 * chunks, `content_preview`), which are truncated. Eight real Sentry
 * dispatches ended in review_failed with the model saying "the retrieved
 * context truncates <file>" and "the code that emits 'fetch_patterns_failed'
 * was not in the context". Two changes fix that:
 *   1. distinctive literals from the report (quoted strings, snake/dotted/
 *      colon identifiers, the Sentry culprit, the route, stack-frame files)
 *      find the files that emit the error, ahead of weaker RAG hits;
 *   2. the top candidates are shown whole, with line numbers. A file that
 *      cannot be fetched falls back to its preview and is labelled so; a
 *      preview is never presented as the whole file.
 *
 * Pure: the GitHub read is injected, so vitest covers caps and labels
 * without a network. No Deno globals, no npm: specifiers.
 */

import type { BaseFileState } from './fix-file-guard.ts'
import { reportFramePaths } from './report-seeds.ts'

// ---------------------------------------------------------------------------
// Literal extraction
// ---------------------------------------------------------------------------

export const MAX_REPORT_LITERALS = 6

/**
 * Build output, deploy bundles and hashed chunks: a stack frame here names a
 * file that is not in the repo (e.g. Supabase's `dist-bundle/index.mjs`).
 */
export function isBundledPath(path: string): boolean {
  const p = path.replace(/\\/g, '/')
  return (
    /(?:^|\/)(?:dist|dist-[\w-]+|build|out|\.output|\.vercel|\.netlify|\.svelte-kit|bundle|bundles)\//i.test(p) ||
    /(?:^|\/)[^/]*bundle[^/]*\.[cm]?js$/i.test(p) ||
    /\.(?:min|chunk|bundle)\.[cm]?js$/i.test(p) ||
    /[-.][0-9a-f]{8,}\.[cm]?js$/i.test(p) ||
    /^(?:var\/task|tmp|deno|ext:|node:)/i.test(p)
  )
}

/** Built-in error class names and generic keys: they match everywhere. */
const STOP_WORDS = new Set(
  [
    'error', 'typeerror', 'referenceerror', 'syntaxerror', 'rangeerror', 'aborterror', 'networkerror',
    'chunkloaderror', 'securityerror', 'domexception', 'fetcherror', 'httperror', 'axioserror',
    'unhandledrejection', 'promiserejection', 'undefined', 'null', 'true', 'false', 'object',
    'request_id', 'user_id', 'project_id', 'report_id', 'error_code', 'status_code', 'created_at',
    'updated_at', 'event_id', 'trace_id', 'span_id', 'session_id',
  ].map((w) => w.toLowerCase()),
)

/** Code-search qualifiers: report text is untrusted, never let it steer the query. */
const SEARCH_QUALIFIER_RE = /(?:^|[\s"'])(?:repo|org|user|path|in|language|filename|extension|size|fork|is):/i

function isUrlish(s: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^www\./i.test(s) || /@[\w-]+\.[a-z]{2,}$/i.test(s)
}

function isNoise(s: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) || // uuid
    /^[0-9a-f]{12,}$/i.test(s) || // hash
    /^v?\d+(?:\.\d+)+$/.test(s) || // version
    /^[\d\W_]+$/.test(s) // no letters
  )
}

/** A bare token is distinctive enough to search for. */
function isDistinctiveToken(t: string): boolean {
  if (t.length < 6 || t.length > 100) return false
  if (STOP_WORDS.has(t.toLowerCase()) || isUrlish(t) || isNoise(t)) return false
  if (/^(?:https?|ftp|mailto|file|data):/i.test(t)) return false
  if (t.includes('/')) return false // paths come from stack frames
  if (/\.(?:[cm]?[jt]sx?|json|py|rb|go|rs|md|css|html)$/i.test(t)) return false // a file name
  const snake = /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/.test(t)
  // fetchPartner / PartnerCard: one hump is enough once the name is long.
  const humps = (t.match(/[a-z0-9][A-Z]/g) ?? []).length
  const camel = /^[a-z]+(?:[A-Z][a-z0-9]+)+$/.test(t) && (humps >= 2 || t.length >= 10)
  const pascal = /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+$/.test(t) && (humps >= 2 || t.length >= 10) &&
    !/(?:Error|Exception)$/.test(t)
  const compound = /^[A-Za-z_$][\w$]*(?:[.:-][\w$]+)+$/.test(t) && /[a-z]/i.test(t) &&
    (/[_:]/.test(t) || /[a-z][A-Z]/.test(t) || (/-/.test(t) && /\d/.test(t)))
  return snake || camel || pascal || compound
}

/** A quoted string from the report is worth searching for. */
function isDistinctiveQuoted(q: string): boolean {
  const s = q.trim()
  if (s.length < 4 || s.length > 100) return false
  if (isUrlish(s) || isNoise(s) || SEARCH_QUALIFIER_RE.test(s)) return false
  if (/\s/.test(s)) return s.length >= 12 && s.split(/\s+/).length <= 8
  return isDistinctiveToken(s) || (s.length >= 6 && /[_.:-]/.test(s) && /[a-z]/i.test(s))
}

const QUOTED_RE = /(?:^|[\s([{:=,])(["'`])([^"'`\n]{3,100}?)\1(?=$|[\s)\]},.:;!?])/g
const TOKEN_RE = /[A-Za-z_$][\w$]*(?:[.:-][\w$]+)*/g

function quotedStrings(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(QUOTED_RE)) {
    const s = m[2].trim()
    if (isDistinctiveQuoted(s)) out.push(s)
  }
  return out
}

function tokens(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(TOKEN_RE)) {
    const t = m[0].replace(/[.:-]+$/, '')
    if (isDistinctiveToken(t)) out.push(t)
  }
  return out
}

/** `/checkout/[id]/confirm?x=1` → `/checkout/confirm`; null for `/` or a Sentry link. */
function routeLiteral(raw: string): string | null {
  let path = raw.trim()
  if (!path) return null
  if (/^https?:\/\//i.test(path)) {
    try {
      const u = new URL(path)
      if (/sentry\.io$/i.test(u.hostname)) return null
      path = u.pathname
    } catch {
      return null
    }
  }
  path = path.split(/[?#]/)[0] ?? ''
  const segments = path
    .split('/')
    .filter((s) => s && !/^[[:(]/.test(s) && !/^\d+$/.test(s) && !isNoise(s) && s.length <= 40)
    .slice(0, 3)
  if (segments.length === 0) return null
  const route = `/${segments.join('/')}`
  return route.length >= 4 ? route : null
}

export interface ReportForLiterals {
  summary?: unknown
  description?: unknown
  console_logs?: unknown
  custom_metadata?: unknown
  environment?: unknown
}

export interface ReportLiterals {
  /** Strings to search the code for, most distinctive first. */
  literals: string[]
  /** Repo-relative paths from the stack, bundle output removed. */
  framePaths: string[]
}

/**
 * Distinctive literals and stack-frame paths from a report, in priority
 * order: quoted strings, then identifiers from the title and error
 * messages, then the Sentry culprit, then the route.
 */
export function extractReportLiterals(report: ReportForLiterals): ReportLiterals {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const meta = (report.custom_metadata ?? {}) as { culprit?: unknown }
  const env = (report.environment ?? {}) as { url?: unknown }
  const logs = Array.isArray(report.console_logs) ? report.console_logs : []
  const logText = logs
    .filter((l) => {
      const level = (l as { level?: unknown } | null)?.level
      return level === 'error' || level === 'warn'
    })
    .slice(0, 10)
    .map((l) => {
      const entry = l as { message?: unknown; stack?: unknown }
      // The first stack line is "Type: message"; frame lines are paths.
      return [str(entry.message), str(entry.stack).split('\n')[0] ?? ''].join('\n')
    })
    .join('\n')
  const summary = str(report.summary)
  const description = str(report.description).slice(0, 4000)
  const culprit = str(meta.culprit)

  const ordered: string[] = [
    ...quotedStrings(`${summary}\n${description}\n${logText}\n${culprit}`),
    ...tokens(`${summary}\n${description.split('\n')[0] ?? ''}\n${logText}`),
    ...tokens(culprit),
    ...tokens(description),
  ]
  const route = routeLiteral(str(env.url)) ?? routeLiteral(culprit.match(/(?:^|\s)(\/[\w\-/[\]:.]+)/)?.[1] ?? '')
  if (route) ordered.push(route)

  const literals: string[] = []
  const seen = new Set<string>()
  for (const l of ordered) {
    const key = l.toLowerCase()
    if (seen.has(key) || SEARCH_QUALIFIER_RE.test(` ${l}`)) continue
    // A token inside an already-kept quoted string adds nothing.
    if (literals.some((kept) => kept.includes(l))) continue
    seen.add(key)
    literals.push(l)
    if (literals.length >= MAX_REPORT_LITERALS) break
  }

  const framePaths = reportFramePaths({
    custom_metadata: report.custom_metadata,
    console_logs: report.console_logs,
  }).filter((p) => !isBundledPath(p))

  return { literals, framePaths: [...new Set(framePaths)].slice(0, 10) }
}

/**
 * What to search for, in order, for one literal: the literal itself, then
 * stems for strings the app builds at runtime. glot.it reports
 * `ota:manifest-504`, but its source holds `` `ota:${reason}` `` and
 * `` `manifest-${res.status}` ``, so only the stem `manifest-` is in the code.
 *   - a trailing number is cut, keeping the separator (`ota:manifest-`);
 *   - a namespace prefix before `:` or `.` is cut (`manifest-504`,
 *     `get_partner_failed`), then its trailing number too (`manifest-`).
 * Every term keeps at least 6 characters and a letter run of 3+, and the
 * caller verifies whichever term matched against the full file text.
 */
export function literalSearchTerms(literal: string): string[] {
  const out: string[] = [literal]
  const stripNumber = (s: string): string | null => {
    const m = /^(.*?[A-Za-z][^\d]*?[-_:./]?)\d{2,}$/.exec(s)
    return m && m[1] !== s ? m[1] : null
  }
  const tails = (s: string): string[] => {
    const t: string[] = []
    const colon = s.lastIndexOf(':')
    if (colon > 0 && colon < s.length - 1) t.push(s.slice(colon + 1))
    const dot = s.indexOf('.')
    if (dot > 0 && dot < s.length - 1 && !/\s/.test(s)) t.push(s.slice(dot + 1))
    return t
  }
  const add = (s: string | null) => {
    if (!s || s.length < 6 || !/[A-Za-z]{3,}/.test(s) || out.includes(s)) return
    out.push(s)
  }
  add(stripNumber(literal))
  for (const t of tails(literal)) {
    add(t)
    add(stripNumber(t))
  }
  return out.slice(0, 4)
}

// ---------------------------------------------------------------------------
// Candidate ranking
// ---------------------------------------------------------------------------

export interface PreviewChunk {
  text: string
  lineStart: number | null
  lineEnd: number | null
}

export interface ContextCandidate {
  path: string
  /** Literals a search said this file contains (verified against the full text later). */
  literals: string[]
  /** The file appears in the report's stack trace. */
  inStack: boolean
  /** Best RAG similarity, when the index matched it. */
  ragSimilarity: number | null
  /** Index preview chunks: the fallback when the full file cannot be read. */
  previews: PreviewChunk[]
}

// ---------------------------------------------------------------------------
// Repo attribution
// ---------------------------------------------------------------------------

/**
 * Which linked repo an index path belongs to. The codebase index
 * (`project_codebase_files`, `match_codebase_files`) is keyed by project, not
 * repo, so in a multi-repo project a RAG hit may be another repo's file:
 * solo-boss-cloud's frontend and backend both own `src/**`.
 *   - target:  only the target repo's path globs cover it;
 *   - other:   the target's globs do not cover it (it cannot be the target's);
 *   - unknown: another linked repo claims it too. Usable only after a read
 *              from the target repo succeeds, and its index preview (which
 *              may be the other repo's text) is never shown.
 */
export type RepoAttribution = 'target' | 'other' | 'unknown'

export interface LinkedRepoScope {
  /** The target repo's `path_globs`; null or empty = the whole repo. */
  targetGlobs: readonly string[] | null
  /** `path_globs` of every OTHER repo linked to the project. */
  otherRepoGlobs: ReadonlyArray<readonly string[] | null>
}

/** `src/**` → `src`, `./apps/web/*` → `apps/web`; '' covers everything. */
export function globRoot(glob: string): string {
  return glob.trim().replace(/\\/g, '/').replace(/\/\*\*?$/, '').replace(/^\.?\//, '').replace(/\/+$/, '')
}

/** True when `path` is under one of `globs` (null or empty = everything). */
export function underRepoGlobs(path: string, globs: readonly string[] | null): boolean {
  if (!globs || globs.length === 0) return true
  const p = path.replace(/\\/g, '/').replace(/^\.?\/+/, '')
  return globs.some((g) => {
    const root = globRoot(g)
    return root === '' || p === root || p.startsWith(`${root}/`)
  })
}

export function attributeIndexPath(path: string, scope: LinkedRepoScope): RepoAttribution {
  if (!underRepoGlobs(path, scope.targetGlobs)) return 'other'
  if (scope.otherRepoGlobs.length === 0) return 'target'
  return scope.otherRepoGlobs.some((g) => underRepoGlobs(path, g)) ? 'unknown' : 'target'
}

export interface CandidateSources {
  /** path → literals found in it by code search on the TARGET repo. */
  literalHits: ReadonlyMap<string, readonly string[]>
  /** path → literals found in it by the project-wide index (attributed). */
  indexLiteralHits?: ReadonlyMap<string, readonly string[]>
  /** Stack-frame paths taken as-is (only ever read from the target repo). */
  framePaths: readonly string[]
  /** Stack-frame paths matched in the project-wide index (attributed). */
  indexFramePaths?: readonly string[]
  /** RAG rows from the project-wide index (one per chunk; attributed). */
  rag: ReadonlyArray<{
    filePath: string
    preview: string
    similarity: number
    lineStart?: number | null
    lineEnd?: number | null
  }>
  /**
   * Attribution for index-derived paths. Omitted = single-repo project:
   * every index path is the target's.
   */
  attribute?: (path: string) => RepoAttribution
}

/**
 * Merge every source into one list per path, strongest first: each literal
 * the file contains (up to 3) outweighs a stack frame, which outweighs any
 * RAG similarity. Ties keep the order the sources arrived in.
 *
 * Index-derived paths another linked repo owns are dropped; paths of
 * unknown ownership are kept without their index previews, so they appear
 * only if the read from the target repo finds them.
 */
export function rankContextCandidates(sources: CandidateSources): ContextCandidate[] {
  const attribute = sources.attribute ?? (() => 'target' as const)
  const byPath = new Map<string, ContextCandidate>()
  const get = (raw: string): ContextCandidate => {
    const path = raw.replace(/\\/g, '/').replace(/^\.?\/+/, '')
    let c = byPath.get(path)
    if (!c) {
      c = { path, literals: [], inStack: false, ragSimilarity: null, previews: [] }
      byPath.set(path, c)
    }
    return c
  }
  const addLiterals = (path: string, lits: readonly string[]) => {
    const c = get(path)
    for (const l of lits) if (!c.literals.includes(l)) c.literals.push(l)
  }
  for (const [path, lits] of sources.literalHits) addLiterals(path, lits)
  for (const [path, lits] of sources.indexLiteralHits ?? []) {
    if (attribute(path) !== 'other') addLiterals(path, lits)
  }
  for (const p of sources.framePaths) get(p).inStack = true
  for (const p of sources.indexFramePaths ?? []) {
    if (attribute(p) !== 'other') get(p).inStack = true
  }
  for (const r of sources.rag) {
    const owner = attribute(r.filePath)
    if (owner === 'other') continue
    const c = get(r.filePath)
    c.ragSimilarity = Math.max(c.ragSimilarity ?? 0, r.similarity)
    // An unknown-owner preview may be another repo's text: never show it.
    if (r.preview && owner === 'target') {
      c.previews.push({ text: r.preview, lineStart: r.lineStart ?? null, lineEnd: r.lineEnd ?? null })
    }
  }
  const score = (c: ContextCandidate) =>
    3 * Math.min(c.literals.length, 3) + (c.inStack ? 2 : 0) + (c.ragSimilarity ?? 0)
  return [...byPath.values()]
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ c }) => {
      c.previews.sort((a, b) => (a.lineStart ?? 0) - (b.lineStart ?? 0))
      return c
    })
}

// ---------------------------------------------------------------------------
// Full-file context
// ---------------------------------------------------------------------------

export const FULL_CONTEXT_LIMITS = {
  maxFiles: 8,
  maxFileBytes: 60_000,
  maxTotalBytes: 200_000,
} as const

export interface FullContextOptions {
  maxFiles?: number
  maxFileBytes?: number
  maxTotalBytes?: number
  /** Lines of context on each side of a literal in an excerpt of an oversized file. */
  excerptRadius?: number
}

export interface ContextFileOutcome {
  path: string
  shown: 'full' | 'excerpt' | 'preview' | 'omitted'
  /** Why the file is not shown in full (absent for `full`). */
  reason?: string
}

export interface FullFileContext {
  /** The "Relevant code" section body. Empty when nothing could be shown. */
  text: string
  outcomes: ContextFileOutcome[]
  /** Files shown in any form (full, excerpt or preview). */
  shownCount: number
  /** Every base-branch state read (the same commit the PR branches from). */
  states: Map<string, BaseFileState>
}

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length
const kb = (n: number) => `${Math.round(n / 1000)} KB`

function splitLines(text: string): string[] {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''))
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function numbered(lines: readonly string[], firstLine: number, width: number): string {
  return lines.map((l, i) => `${String(firstLine + i).padStart(width)} | ${l}`).join('\n')
}

function describeSignals(c: ContextCandidate, verified: readonly string[]): string {
  const parts: string[] = []
  if (verified.length > 0) parts.push(`contains ${verified.map((l) => `\`${l}\``).join(', ')}`)
  if (c.inStack) parts.push('in the stack trace')
  return parts.length > 0 ? `; ${parts.join('; ')}` : ''
}

function renderPreview(c: ContextCandidate, why: string): string | null {
  if (c.previews.length === 0) return null
  const blocks = c.previews.map((p) => {
    const lines = splitLines(p.text)
    return p.lineStart != null
      ? numbered(lines, p.lineStart, String(p.lineStart + lines.length).length)
      : lines.join('\n')
  })
  const lineCount = c.previews.reduce((n, p) => n + splitLines(p.text).length, 0)
  return [
    `--- ${c.path} (preview only, ${lineCount} lines; ${why}. This is NOT the whole file: do not write edits for text you cannot see here) ---`,
    blocks.join('\n…\n'),
  ].join('\n')
}

/** Windows of ±radius lines around each line containing a verified literal. */
function renderExcerpt(c: ContextCandidate, lines: readonly string[], verified: readonly string[], radius: number, maxBytes: number, why: string): string | null {
  const anchors: number[] = []
  lines.forEach((l, i) => {
    if (verified.some((lit) => l.includes(lit))) anchors.push(i)
  })
  if (anchors.length === 0) return null
  const windows: Array<[number, number]> = []
  for (const a of anchors) {
    const lo = Math.max(0, a - radius)
    const hi = Math.min(lines.length - 1, a + radius)
    const last = windows[windows.length - 1]
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi)
    else windows.push([lo, hi])
  }
  const width = String(lines.length).length
  const parts: string[] = []
  let used = 0
  const shownRanges: string[] = []
  for (const [lo, hi] of windows) {
    const block = numbered(lines.slice(lo, hi + 1), lo + 1, width)
    if (used + block.length > maxBytes && parts.length > 0) break
    parts.push(block)
    shownRanges.push(`${lo + 1}-${hi + 1}`)
    used += block.length
  }
  return [
    `--- ${c.path} (excerpt only, lines ${shownRanges.join(', ')} of ${lines.length}; ${why}${describeSignals(c, verified)}. Edits are allowed only for text shown here) ---`,
    parts.join('\n…\n'),
  ].join('\n')
}

/**
 * Read the top candidates in full from the base branch and render them.
 *
 * Caps: `maxFiles` candidates are read; each shown whole only when it is at
 * most `maxFileBytes` and the running total stays within `maxTotalBytes`.
 * A file over a cap is shown as an excerpt around the literals it contains,
 * else as its index preview, and the header says which and why. A file the
 * base branch does not have is dropped (a stale index path must never invite
 * edits). A literal-search hit whose text does not actually contain the
 * literal, with no other signal, is dropped as a false positive.
 *
 * `readFile` null means no GitHub access: every file falls back to its preview.
 */
export async function buildFullFileContext(
  candidates: readonly ContextCandidate[],
  readFile: ((path: string) => Promise<BaseFileState>) | null,
  opts: FullContextOptions = {},
): Promise<FullFileContext> {
  const maxFiles = opts.maxFiles ?? FULL_CONTEXT_LIMITS.maxFiles
  const maxFileBytes = opts.maxFileBytes ?? FULL_CONTEXT_LIMITS.maxFileBytes
  const maxTotalBytes = opts.maxTotalBytes ?? FULL_CONTEXT_LIMITS.maxTotalBytes
  const radius = opts.excerptRadius ?? 30

  const picked = candidates.slice(0, maxFiles)
  const states = new Map<string, BaseFileState>()
  if (readFile) {
    const read = await Promise.all(
      picked.map(async (c) => {
        try {
          return await readFile(c.path)
        } catch (err) {
          return { kind: 'unreadable', detail: String(err).slice(0, 120) } as BaseFileState
        }
      }),
    )
    picked.forEach((c, i) => states.set(c.path, read[i]))
  }

  const blocks: string[] = []
  const outcomes: ContextFileOutcome[] = []
  let totalBytes = 0

  const fallback = (c: ContextCandidate, why: string, lines?: string[], verified: string[] = []) => {
    const excerpt = lines ? renderExcerpt(c, lines, verified, radius, Math.min(maxFileBytes, 20_000), why) : null
    if (excerpt) {
      blocks.push(excerpt)
      outcomes.push({ path: c.path, shown: 'excerpt', reason: why })
      return
    }
    const preview = renderPreview(c, why)
    if (preview) {
      blocks.push(preview)
      outcomes.push({ path: c.path, shown: 'preview', reason: why })
      return
    }
    outcomes.push({ path: c.path, shown: 'omitted', reason: why })
  }

  for (const c of picked) {
    const state = states.get(c.path)
    if (!state) {
      fallback(c, 'full file unavailable: no GitHub access')
      continue
    }
    if (state.kind === 'absent') {
      outcomes.push({ path: c.path, shown: 'omitted', reason: 'not found on the base branch' })
      continue
    }
    if (state.kind === 'unreadable') {
      fallback(c, `full file unavailable: ${state.detail}`)
      continue
    }
    const verified = c.literals.filter((l) => state.contents.includes(l))
    if (verified.length === 0 && c.literals.length > 0 && !c.inStack && c.ragSimilarity == null) {
      outcomes.push({ path: c.path, shown: 'omitted', reason: 'search hit does not contain the literal' })
      continue
    }
    const bytes = utf8Bytes(state.contents)
    const lines = splitLines(state.contents)
    if (bytes > maxFileBytes) {
      fallback(c, `file is ${kb(bytes)}, over the ${kb(maxFileBytes)} per-file cap`, lines, verified)
      continue
    }
    if (totalBytes + bytes > maxTotalBytes) {
      fallback(c, `the ${kb(maxTotalBytes)} total context cap was reached`, lines, verified)
      continue
    }
    totalBytes += bytes
    blocks.push(
      [
        `--- ${c.path} (full file, ${lines.length} lines${describeSignals(c, verified)}) ---`,
        numbered(lines, 1, String(lines.length).length),
      ].join('\n'),
    )
    outcomes.push({ path: c.path, shown: 'full' })
  }

  for (const c of candidates.slice(maxFiles)) {
    outcomes.push({ path: c.path, shown: 'omitted', reason: `over the ${maxFiles}-file cap` })
  }

  const notShown = outcomes.filter((o) => o.shown === 'omitted')
  if (notShown.length > 0 && blocks.length > 0) {
    blocks.push(`Not shown: ${notShown.map((o) => `${o.path} (${o.reason})`).join('; ')}.`)
  }

  return {
    text: blocks.join('\n\n'),
    outcomes,
    shownCount: outcomes.filter((o) => o.shown !== 'omitted').length,
    states,
  }
}
