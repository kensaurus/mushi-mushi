/**
 * FILE: packages/server/supabase/functions/_shared/journey-map.ts
 * PURPOSE: The Journey optimizer's analysis, pure and testable (ADR 0058).
 *
 *          Two sources, either one enough on its own:
 *          - real visits: `session_page_views` rows from the SDK session
 *            tracker. Each session's pages in time order give page-to-page
 *            moves, where people arrive and where they leave.
 *          - a site scan: a Firecrawl crawl of the live site (no LLM). Each
 *            page's internal links give the site map, click depth from the
 *            start page, pages nothing links to, and a content fingerprint
 *            for near-duplicate pages.
 *
 *          The result is a graph (nodes, edges, common flows) plus findings
 *          in plain words, each with a suggestion and a prompt the user can
 *          paste into their coding agent.
 */

import { normalizeRoute } from './project-home.ts'

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface PageViewRow {
  session_id: string
  route: string
  ts: string
}

/** One page of a site scan, as stored in `site_structure_scans.pages`. */
export interface ScannedPage {
  path: string
  url: string
  title: string | null
  /** Internal links on the page, as normalized paths, without duplicates. */
  links: string[]
  /** Words of the page's own content (shared header/footer text removed). */
  words: number
  /** MinHash signature of the page's own content; [] when the page had too little text. */
  sig: number[]
}

export interface SiteScanInput {
  rootPath: string
  pages: ScannedPage[]
}

export interface JourneyInput {
  views: PageViewRow[]
  /** True when the visit sample hit its row cap. */
  viewsSampled: boolean
  scan: SiteScanInput | null
  /** URLs or paths the live-site watch found broken and has not resolved. */
  brokenUrls: string[]
  now?: Date
}

// ── Output ──────────────────────────────────────────────────────────────────

export type JourneyFindingKind =
  | 'broken'
  | 'dead_end'
  | 'high_exit'
  | 'loop'
  | 'reload'
  | 'duplicate_page'
  | 'route_variant'
  | 'duplicate_title'
  | 'orphan'
  | 'deep_page'
  | 'unvisited'

export type JourneySeverity = 'high' | 'medium' | 'low'

export interface JourneyFinding {
  id: string
  kind: JourneyFindingKind
  severity: JourneySeverity
  /** The pages involved, most important first. */
  pages: string[]
  title: string
  detail: string
  suggestion: string
  /** A self-contained instruction for a coding agent working in the app's repo. */
  prompt: string
}

export interface JourneyNode {
  path: string
  label: string
  visits: number
  /** Sessions that started here. */
  entries: number
  /** Sessions that ended here. */
  exits: number
  /** exits / sessions that saw the page; null with no visits. */
  exitRate: number | null
  inScan: boolean
  /** Scanned pages that link here (null without a scan or when not scanned). */
  inbound: number | null
  /** Distinct internal links on the page (null when not scanned). */
  outbound: number | null
  /** Clicks from the start page, by links (null when unreachable or not scanned). */
  depth: number | null
  broken: boolean
  issues: JourneyFindingKind[]
}

export interface JourneyEdge {
  from: string
  to: string
  /** Times people went from `from` to `to`. */
  moves: number
  /** True when the scan found a link from `from` to `to`. */
  linked: boolean
}

export interface JourneyFlow {
  pages: string[]
  sessions: number
}

export interface JourneyStats {
  sessions: number
  pageViews: number
  pages: number
  avgPagesPerSession: number | null
  /** Share of sessions that saw one page only; null with no sessions. */
  bounceRate: number | null
  sampled: boolean
}

export interface JourneyMap {
  stats: JourneyStats
  /** 0–100, 100 = no findings. */
  score: number
  rootPath: string
  nodes: JourneyNode[]
  edges: JourneyEdge[]
  flows: JourneyFlow[]
  findings: JourneyFinding[]
}

// ── Tuning ──────────────────────────────────────────────────────────────────

/** Most nodes the map returns (busiest first); findings still cover every page. */
export const MAX_NODES = 60
/** Most edges the map returns. */
export const MAX_EDGES = 160
const MIN_VISITS_FOR_EXIT = 8
const HIGH_EXIT_RATE = 0.6
const MIN_LOOPS = 3
const LOOP_SHARE = 0.25
const MIN_RELOADS = 4
const RELOAD_SHARE = 0.15
const DEEP_CLICKS = 4
const NEAR_DUPLICATE = 0.85
const MIN_WORDS_FOR_DUPLICATE = 40
/** A link on at least this share of scanned pages is site navigation. */
const NAV_LINK_SHARE = 0.6
const UNVISITED_MIN_SESSIONS = 30
export const SIG_SIZE = 64

/** Pages where leaving is the point, not a problem. */
const NATURAL_END = /(thank|thanks|success|complete|done|confirm|receipt|logout|log-out|sign-?out|goodbye|unsubscribe|not-found|404|offline)/i

const SEVERITY_WEIGHT: Record<JourneySeverity, number> = { high: 12, medium: 6, low: 2 }
const SEVERITY_ORDER: Record<JourneySeverity, number> = { high: 0, medium: 1, low: 2 }

// ── Build ───────────────────────────────────────────────────────────────────

interface PageStats {
  visits: number
  sessions: number
  entries: number
  exits: number
  reloads: number
}

export function buildJourneyMap(input: JourneyInput): JourneyMap {
  const now = input.now ?? new Date()
  const future = now.getTime() + 5 * 60_000

  // Sessions in time order, routes normalized (ids become :id). A row stamped
  // in the future (a client clock ahead) is dropped, not trusted.
  const bySession = new Map<string, Array<{ path: string; t: number }>>()
  let pageViews = 0
  for (const v of input.views) {
    const path = normalizeRoute(v.route)
    const t = Date.parse(v.ts)
    if (!path || !Number.isFinite(t) || t > future) continue
    pageViews += 1
    const list = bySession.get(v.session_id) ?? []
    list.push({ path, t })
    bySession.set(v.session_id, list)
  }

  const stats = new Map<string, PageStats>()
  const stat = (path: string): PageStats => {
    let s = stats.get(path)
    if (!s) {
      s = { visits: 0, sessions: 0, entries: 0, exits: 0, reloads: 0 }
      stats.set(path, s)
    }
    return s
  }
  const moves = new Map<string, number>()
  const loops = new Map<string, number>()
  const flowCounts = new Map<string, number>()
  let bounces = 0

  for (const list of bySession.values()) {
    list.sort((a, b) => a.t - b.t)
    // Collapse repeats: A A B → A B, counting the repeat as a reload of A.
    const seq: string[] = []
    for (const { path } of list) {
      stat(path).visits += 1
      if (seq.at(-1) === path) stat(path).reloads += 1
      else seq.push(path)
    }
    for (const p of new Set(seq)) stat(p).sessions += 1
    stat(seq[0]!).entries += 1
    stat(seq.at(-1)!).exits += 1
    if (seq.length === 1) bounces += 1
    for (let i = 1; i < seq.length; i++) {
      const key = `${seq[i - 1]}\u0000${seq[i]}`
      moves.set(key, (moves.get(key) ?? 0) + 1)
      // A → B → A: went somewhere and came straight back.
      if (i >= 2 && seq[i] === seq[i - 2]) {
        const lk = `${seq[i - 2]}\u0000${seq[i - 1]}`
        loops.set(lk, (loops.get(lk) ?? 0) + 1)
      }
    }
    if (seq.length >= 2) {
      const flow = seq.slice(0, 4).join('\u0000')
      flowCounts.set(flow, (flowCounts.get(flow) ?? 0) + 1)
    }
  }

  const sessions = bySession.size
  const scan = input.scan
  const rootPath = scan?.rootPath ?? '/'

  // ── Scan structure ──
  const scanned = new Map<string, ScannedPage>()
  for (const p of scan?.pages ?? []) if (!scanned.has(p.path)) scanned.set(p.path, p)
  const navLinks = navigationLinks([...scanned.values()])
  const inbound = new Map<string, number>()
  const linked = new Set<string>()
  for (const page of scanned.values()) {
    for (const to of new Set(page.links)) {
      if (to === page.path) continue
      inbound.set(to, (inbound.get(to) ?? 0) + 1)
      linked.add(`${page.path}\u0000${to}`)
    }
  }
  const depth = clickDepth(rootPath, scanned)

  const broken = new Set<string>()
  for (const u of input.brokenUrls) {
    const p = normalizeRoute(u)
    if (p) broken.add(p)
  }

  // ── Nodes: every page any source knows ──
  const allPaths = new Set<string>([...stats.keys(), ...scanned.keys(), ...broken])
  const nodes = new Map<string, JourneyNode>()
  for (const path of allPaths) {
    const s = stats.get(path)
    const page = scanned.get(path)
    nodes.set(path, {
      path,
      label: labelFor(path, page?.title ?? null),
      visits: s?.visits ?? 0,
      entries: s?.entries ?? 0,
      exits: s?.exits ?? 0,
      exitRate: s && s.sessions > 0 ? round2(s.exits / s.sessions) : null,
      inScan: !!page,
      inbound: scan ? inbound.get(path) ?? 0 : null,
      outbound: page ? new Set(page.links.filter((l) => l !== path)).size : null,
      depth: depth.get(path) ?? null,
      broken: broken.has(path),
      issues: [],
    })
  }

  // ── Findings ──
  const findings: JourneyFinding[] = []
  const add = (f: Omit<JourneyFinding, 'id' | 'prompt'> & { prompt?: string }) => {
    const id = `${f.kind}:${f.pages.join('|')}`
    findings.push({ ...f, id, prompt: f.prompt ?? agentPrompt(f) })
    for (const p of f.pages) nodes.get(p)?.issues.push(f.kind)
  }

  for (const path of broken) {
    add({
      kind: 'broken',
      severity: 'high',
      pages: [path],
      title: `${path} is broken`,
      detail: 'The live-site watch found this page failing (an error, a 404 or a blank page). Every journey through it stops here.',
      suggestion: 'Fix the page first, then check the links that lead to it.',
    })
  }

  for (const [path, s] of stats) {
    if (s.sessions < MIN_VISITS_FOR_EXIT || NATURAL_END.test(path)) continue
    const rate = s.exits / s.sessions
    if (rate < HIGH_EXIT_RATE) continue
    const page = scanned.get(path)
    const ownLinks = page ? page.links.filter((l) => l !== path && !navLinks.has(l)).length : null
    const pct = Math.round(rate * 100)
    if (ownLinks === 0) {
      add({
        kind: 'dead_end',
        severity: s.sessions >= 30 ? 'high' : 'medium',
        pages: [path],
        title: `Dead end on ${path}`,
        detail: `${pct}% of the ${s.sessions} visits that reach ${path} end there, and the page has no link onward except the site menu.`,
        suggestion: 'Add one clear next step on the page: a button to the thing people usually do next, or back to where they came from.',
      })
    } else {
      add({
        kind: 'high_exit',
        severity: rate >= 0.8 && s.sessions >= 30 ? 'high' : 'medium',
        pages: [path],
        title: `People leave from ${path}`,
        detail: `${pct}% of the ${s.sessions} visits that reach ${path} end there${s.entries > s.sessions / 2 ? ', most of them on the first page they saw' : ''}.`,
        suggestion: 'Check that the page answers what people came for and that the main action is easy to see above the fold.',
      })
    }
  }

  for (const [key, n] of loops) {
    const [a, b] = key.split('\u0000') as [string, string]
    const out = moves.get(key) ?? 0
    if (n < MIN_LOOPS || out === 0 || n / out < LOOP_SHARE) continue
    add({
      kind: 'loop',
      severity: n >= 15 ? 'high' : 'medium',
      pages: [b, a],
      title: `People go back and forth between ${a} and ${b}`,
      detail: `${n} times people went from ${a} to ${b} and straight back (${Math.round((n / out) * 100)}% of moves from ${a} to ${b}). ${b} probably does not have what they expected.`,
      suggestion: `Make the link on ${a} say what ${b} contains, or put the missing information on ${b}.`,
    })
  }

  for (const [path, s] of stats) {
    if (s.reloads < MIN_RELOADS || s.reloads / s.visits < RELOAD_SHARE) continue
    add({
      kind: 'reload',
      severity: 'medium',
      pages: [path],
      title: `${path} gets reloaded a lot`,
      detail: `${s.reloads} of ${s.visits} visits to ${path} were the same page opened again right away. People reload when a page is slow, looks stuck or did not save.`,
      suggestion: 'Check the page for slow loading, a missing loading state, or a form that seems not to save.',
    })
  }

  for (const group of duplicateGroups([...scanned.values()])) {
    add({
      kind: 'duplicate_page',
      severity: 'medium',
      pages: group.pages,
      title: `${group.pages.length} pages say almost the same thing`,
      detail: `${group.pages.join(', ')} share about ${Math.round(group.similarity * 100)}% of their content. People (and search engines) cannot tell which one to use.`,
      suggestion: 'Merge them into one page and redirect the others to it, or make each page clearly about something different.',
    })
  }

  for (const group of routeVariants([...allPaths])) {
    add({
      kind: 'route_variant',
      severity: 'medium',
      pages: group,
      title: `One page, ${group.length} addresses`,
      detail: `${group.join(', ')} look like the same page at different addresses. Visits and links are split between them.`,
      suggestion: 'Pick one address, redirect the others to it, and update links to use it.',
    })
  }

  const dupContent = new Set(findings.filter((f) => f.kind === 'duplicate_page').flatMap((f) => f.pages))
  for (const group of duplicateTitles([...scanned.values()])) {
    if (group.pages.every((p) => dupContent.has(p))) continue
    add({
      kind: 'duplicate_title',
      severity: 'low',
      pages: group.pages,
      title: `${group.pages.length} pages share the title "${truncate(group.title, 60)}"`,
      detail: 'Pages with the same title look identical in tabs, bookmarks and search results.',
      suggestion: 'Give each page a title that says what is on it.',
    })
  }

  if (scan && scanned.size >= 3) {
    for (const page of scanned.values()) {
      if (page.path === rootPath || (inbound.get(page.path) ?? 0) > 0 || NATURAL_END.test(page.path)) continue
      add({
        kind: 'orphan',
        severity: (stats.get(page.path)?.visits ?? 0) > 0 ? 'medium' : 'low',
        pages: [page.path],
        title: `Nothing links to ${page.path}`,
        detail: `No scanned page links to ${page.path}. People can only reach it from a search, a bookmark or a link from outside.`,
        suggestion: 'Link to it from the page where people would look for it, or remove it if it is no longer needed.',
      })
    }
    for (const [path, d] of depth) {
      if (d < DEEP_CLICKS) continue
      add({
        kind: 'deep_page',
        severity: (stats.get(path)?.visits ?? 0) >= 10 ? 'medium' : 'low',
        pages: [path],
        title: `${path} is ${d} clicks from the start page`,
        detail: `The shortest way from ${rootPath} to ${path} takes ${d} clicks. Most people give up before that.`,
        suggestion: 'Link to it from the start page or the main menu if people need it.',
      })
    }
  }

  if (scan && sessions >= UNVISITED_MIN_SESSIONS) {
    const unvisited = [...scanned.keys()].filter((p) => !stats.has(p) && p !== rootPath).sort()
    if (unvisited.length > 0) {
      add({
        kind: 'unvisited',
        severity: 'low',
        pages: unvisited.slice(0, 12),
        title: `${unvisited.length} ${unvisited.length === 1 ? 'page' : 'pages'} nobody opened`,
        detail: `None of the ${sessions} visits in this period opened ${unvisited.length === 1 ? 'this page' : 'these pages'}${unvisited.length > 12 ? ` (first 12 shown)` : ''}.`,
        suggestion: 'If the pages matter, link to them where people look. If not, remove them so the site is easier to find your way around.',
      })
    }
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || pageWeight(b, stats) - pageWeight(a, stats) || a.id.localeCompare(b.id))

  // ── Graph for the canvas: busiest pages, their moves and links ──
  const ranked = [...nodes.values()].sort(
    (a, b) =>
      Number(b.path === rootPath) - Number(a.path === rootPath) ||
      Number(b.issues.length > 0) - Number(a.issues.length > 0) ||
      b.visits - a.visits ||
      (b.inbound ?? 0) - (a.inbound ?? 0) ||
      a.path.localeCompare(b.path),
  )
  const kept = new Set(ranked.slice(0, MAX_NODES).map((n) => n.path))
  const edges: JourneyEdge[] = []
  const edgeSeen = new Set<string>()
  for (const [key, n] of [...moves].sort((a, b) => b[1] - a[1])) {
    const [from, to] = key.split('\u0000') as [string, string]
    if (!kept.has(from) || !kept.has(to)) continue
    edges.push({ from, to, moves: n, linked: linked.has(key) })
    edgeSeen.add(key)
  }
  // Links nobody used, skipping site navigation (it would connect everything to everything).
  for (const key of [...linked].sort()) {
    if (edgeSeen.has(key)) continue
    const [from, to] = key.split('\u0000') as [string, string]
    if (!kept.has(from) || !kept.has(to) || navLinks.has(to)) continue
    edges.push({ from, to, moves: 0, linked: true })
  }

  const flows = [...flowCounts]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([k, n]) => ({ pages: k.split('\u0000'), sessions: n }))

  const penalty = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0)
  return {
    stats: {
      sessions,
      pageViews,
      pages: allPaths.size,
      avgPagesPerSession: sessions > 0 ? round2(pageViews / sessions) : null,
      bounceRate: sessions > 0 ? round2(bounces / sessions) : null,
      sampled: input.viewsSampled,
    },
    score: allPaths.size === 0 ? 0 : Math.max(0, 100 - penalty),
    rootPath,
    nodes: ranked.filter((n) => kept.has(n.path)),
    edges: edges.slice(0, MAX_EDGES),
    flows,
    findings,
  }
}

// ── Scan helpers (also used by the scan worker) ─────────────────────────────

const ASSET = /\.(png|jpe?g|gif|webp|avif|svg|ico|pdf|zip|gz|csv|xlsx?|docx?|pptx?|mp4|webm|mp3|wav|css|js|mjs|map|json|xml|txt|woff2?|ttf)$/i

/**
 * Internal links of a scanned page as normalized paths. Keeps links on the
 * site's own host (subdomains excluded) and under its base path when it has
 * one; drops files, anchors on the same page and other schemes.
 */
export function internalPaths(links: string[], pageUrl: string, baseUrl: string): string[] {
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    return []
  }
  const host = base.hostname.replace(/^www\./, '').toLowerCase()
  const basePath = base.pathname.replace(/\/+$/, '')
  const out = new Set<string>()
  for (const raw of links) {
    let u: URL
    try {
      u = new URL(raw, pageUrl)
    } catch {
      continue
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
    if (u.hostname.replace(/^www\./, '').toLowerCase() !== host) continue
    if (basePath && u.pathname !== basePath && !u.pathname.startsWith(`${basePath}/`)) continue
    if (ASSET.test(u.pathname)) continue
    const p = normalizeRoute(u.pathname)
    if (p) out.add(p)
  }
  return [...out]
}

/**
 * Text lines that appear on at least half the pages (header, menu, footer,
 * cookie banner). Removed before fingerprinting so two pages are not called
 * duplicates for sharing the site's chrome.
 */
export function boilerplateLines(markdowns: string[]): Set<string> {
  const out = new Set<string>()
  if (markdowns.length < 4) return out
  const counts = new Map<string, number>()
  for (const md of markdowns) {
    for (const line of new Set(contentLines(md))) counts.set(line, (counts.get(line) ?? 0) + 1)
  }
  const min = Math.ceil(markdowns.length * 0.5)
  for (const [line, n] of counts) if (n >= min) out.add(line)
  return out
}

function contentLines(md: string): string[] {
  return md
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 3)
}

/** The page's own words: markdown without the shared lines, links and images reduced to their text. */
export function ownWords(md: string, boilerplate: Set<string>): string[] {
  const text = contentLines(md)
    .filter((l) => !boilerplate.has(l))
    .join(' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .toLowerCase()
  return text.match(/[\p{L}\p{N}]+/gu) ?? []
}

/**
 * MinHash signature of a word list (5-word shingles; 3-character shingles
 * for scripts written without spaces, like Japanese). Two pages' share of
 * equal slots estimates the share of content they have in common.
 */
export function minhash(words: string[]): number[] {
  const shingles = shinglesOf(words)
  if (shingles.length === 0) return []
  const sig = new Array<number>(SIG_SIZE).fill(0xffffffff)
  for (const sh of shingles) {
    const h = fnv1a(sh)
    for (let i = 0; i < SIG_SIZE; i++) {
      const v = mix32(h ^ SEEDS[i]!)
      if (v < sig[i]!) sig[i] = v
    }
  }
  return sig
}

function shinglesOf(words: string[]): string[] {
  const out = new Set<string>()
  const spaced = words.filter((w) => w.length <= 24)
  if (spaced.length >= 5) {
    for (let i = 0; i + 5 <= spaced.length; i++) out.add(spaced.slice(i, i + 5).join(' '))
  }
  // Long runs without spaces (Japanese, Chinese): character 3-grams.
  for (const w of words) {
    if (w.length <= 24) continue
    for (let i = 0; i + 3 <= w.length; i++) out.add(w.slice(i, i + 3))
  }
  return [...out]
}

export function similarity(a: number[], b: number[]): number {
  if (a.length !== SIG_SIZE || b.length !== SIG_SIZE) return 0
  let same = 0
  for (let i = 0; i < SIG_SIZE; i++) if (a[i] === b[i]) same += 1
  return same / SIG_SIZE
}

const SEEDS: number[] = (() => {
  const out: number[] = []
  let x = 0x9e3779b9
  for (let i = 0; i < SIG_SIZE; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    out.push(x)
  }
  return out
})()

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function mix32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b)
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
  return (x ^ (x >>> 16)) >>> 0
}

// ── Internals ───────────────────────────────────────────────────────────────

function navigationLinks(pages: ScannedPage[]): Set<string> {
  const out = new Set<string>()
  if (pages.length < 3) return out
  const counts = new Map<string, number>()
  for (const p of pages) for (const l of new Set(p.links)) counts.set(l, (counts.get(l) ?? 0) + 1)
  const min = Math.ceil(pages.length * NAV_LINK_SHARE)
  for (const [l, n] of counts) if (n >= min) out.add(l)
  return out
}

function clickDepth(root: string, pages: Map<string, ScannedPage>): Map<string, number> {
  const depth = new Map<string, number>()
  if (!pages.has(root)) return depth
  depth.set(root, 0)
  const queue = [root]
  while (queue.length > 0) {
    const at = queue.shift()!
    const d = depth.get(at)!
    for (const next of pages.get(at)?.links ?? []) {
      if (depth.has(next) || !pages.has(next)) continue
      depth.set(next, d + 1)
      queue.push(next)
    }
  }
  return depth
}

function duplicateGroups(pages: ScannedPage[]): Array<{ pages: string[]; similarity: number }> {
  const usable = pages.filter((p) => p.sig.length === SIG_SIZE && p.words >= MIN_WORDS_FOR_DUPLICATE)
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    while (parent.get(x) !== x) x = parent.get(x)!
    return x
  }
  for (const p of usable) parent.set(p.path, p.path)
  const best = new Map<string, number>()
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const s = similarity(usable[i]!.sig, usable[j]!.sig)
      if (s < NEAR_DUPLICATE) continue
      const a = find(usable[i]!.path)
      const b = find(usable[j]!.path)
      if (a !== b) parent.set(b, a)
      const root = find(a)
      best.set(root, Math.min(best.get(root) ?? 1, s))
    }
  }
  const groups = new Map<string, string[]>()
  for (const p of usable) {
    const r = find(p.path)
    groups.set(r, [...(groups.get(r) ?? []), p.path])
  }
  return [...groups.entries()]
    .filter(([, g]) => g.length > 1)
    .map(([r, g]) => ({ pages: g.sort(), similarity: best.get(r) ?? NEAR_DUPLICATE }))
}

/** Paths that differ only in case, a trailing slash, `index`, or an `.html` ending. */
export function routeVariants(paths: string[]): string[][] {
  const groups = new Map<string, Set<string>>()
  for (const p of paths) {
    const key =
      p
        .toLowerCase()
        .replace(/\/index(\.html?)?$/, '')
        .replace(/\.html?$/, '')
        .replace(/\/+$/, '') || '/'
    groups.set(key, (groups.get(key) ?? new Set()).add(p))
  }
  return [...groups.values()].filter((g) => g.size > 1).map((g) => [...g].sort())
}

function duplicateTitles(pages: ScannedPage[]): Array<{ title: string; pages: string[] }> {
  const groups = new Map<string, string[]>()
  for (const p of pages) {
    const t = p.title?.trim()
    if (!t) continue
    groups.set(t, [...(groups.get(t) ?? []), p.path])
  }
  return [...groups.entries()].filter(([, g]) => g.length > 1).map(([title, g]) => ({ title, pages: g.sort() }))
}

function labelFor(path: string, title: string | null): string {
  if (path === '/') return 'Home'
  const last = path.split('/').filter(Boolean).at(-1) ?? path
  const t = title?.split(/\s[|\-–—·]\s/)[0]?.trim()
  return t && t.length <= 40 ? t : last
}

function pageWeight(f: JourneyFinding, stats: Map<string, PageStats>): number {
  return f.pages.reduce((n, p) => n + (stats.get(p)?.visits ?? 0), 0)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** What the user pastes into Cursor, Claude Code, Lovable or Bolt. */
export function agentPrompt(f: Pick<JourneyFinding, 'title' | 'detail' | 'suggestion' | 'pages' | 'kind'>): string {
  const pages = f.pages.map((p) => `- ${p}`).join('\n')
  return [
    `Improve a user journey in this app. Mushi Mushi's Journey optimizer found: ${f.title}.`,
    '',
    f.detail,
    '',
    `Pages:\n${pages}`,
    '',
    `What to change: ${f.suggestion}`,
    '',
    'Find the route or page component for each page above in this repo, make the smallest change that fixes it, keep the existing design and components, and tell me what you changed and how to check it.',
  ].join('\n')
}
