/**
 * FILE: apps/admin/src/lib/navLabelContract.test.ts
 * PURPOSE: One page, one name. The sidebar label in NAV_REGISTRY is the
 *          contract; the page heading (`<PageHeaderBar title=…>` fallback)
 *          and every per-mode `title:` override in lib/copy.ts must match it.
 *
 *          Console audit 2026-10-20 found the same page carrying three or
 *          four names (sidebar "Bugs", heading "Bugs to fix", tab "Reports").
 *          This test reads the page sources so the drift fails in CI instead
 *          of in a screenshot review.
 *
 *          Resolution: registry path → <Route path element={<X/>}> in App.tsx
 *          → X's import → page file. Hub pages (/dashboard, /health, /team)
 *          render a PageHubView; their heading is the first view's page.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NAV_REGISTRY } from './navRegistry'
import { HEALTH_HUB, HOME_HUB, TEAM_HUB, type PageHub } from './pageHubs'

const srcRoot = resolve(__dirname, '..')
const read = (rel: string): string => readFileSync(resolve(srcRoot, rel), 'utf8')

/**
 * Sidebar entries this test cannot check, each with the reason. Add here
 * instead of letting an entry fall through silently; the hygiene test below
 * fails when a listed entry becomes checkable again.
 */
const SKIPPED: ReadonlyArray<{ path: string; reason: string }> = [
  {
    path: '/team',
    reason:
      'hub whose first view (Members) is the re-homed /organization/members page; its heading "Team members" belongs to the view, not the hub',
  },
]

/** Hub constants by the name a page passes as `hub={…}`. */
const PAGE_HUBS: Record<string, PageHub> = { HOME_HUB, HEALTH_HUB, TEAM_HUB }

// ── App.tsx: route → component → page file ─────────────────────────────────

const appSource = read('App.tsx')

/** `<Route path="/reports" element={<ReportsPage />} />` → { '/reports': 'ReportsPage' } */
function parseRoutes(source: string): Map<string, string> {
  const routes = new Map<string, string>()
  const re = /<Route\s+path="([^"]+)"\s+element=\{<(\w+)[^>]*\/?>\}/g
  for (const m of source.matchAll(re)) routes.set(m[1], m[2])
  return routes
}

/**
 * Component name → module path relative to the file's directory, from either
 *   const X = lazy(() => import('./pages/X').then(…))
 *   import { X } from './pages/X'
 */
function parseComponentImports(source: string): Map<string, string> {
  const imports = new Map<string, string>()
  for (const m of source.matchAll(/const\s+(\w+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*'([^']+)'\s*\)/g)) {
    imports.set(m[1], m[2])
  }
  for (const m of source.matchAll(/import\s+\{([^}]+)\}\s+from\s+'([^']+)'/g)) {
    for (const name of m[1].split(',')) {
      const bare = name.trim().split(/\s+as\s+/).pop()
      if (bare) imports.set(bare, m[2])
    }
  }
  return imports
}

const ROUTES = parseRoutes(appSource)
const APP_IMPORTS = parseComponentImports(appSource)

/** Resolve `./pages/ReportsPage` (relative to `fromDir`) to a src-relative `.tsx` path. */
function moduleToFile(fromDir: string, modulePath: string): string {
  const joined = resolve(srcRoot, fromDir, modulePath)
  return `${joined.slice(srcRoot.length + 1)}.tsx`
}

// ── Page source: <PageHeaderBar title=…> ───────────────────────────────────

/** The attribute text of every `<PageHeaderBar …>` opening tag in a file. */
function pageHeaderBarAttrs(source: string): string[] {
  const out: string[] = []
  const tag = '<PageHeaderBar'
  let from = 0
  for (;;) {
    const start = source.indexOf(tag, from)
    if (start === -1) break
    let depth = 0
    let i = start + tag.length
    for (; i < source.length; i += 1) {
      const ch = source[i]
      if (ch === '{') depth += 1
      else if (ch === '}') depth -= 1
      else if (ch === '>' && depth === 0) break
    }
    out.push(source.slice(start + tag.length, i))
    from = i
  }
  return out
}

type Heading = { literal: string } | { unparsed: string }

/**
 * `title="Bugs"`, `title={'Bugs'}`, `title={copy?.title ?? 'Bugs'}`,
 * `title={pageCopy.title ?? "Bugs"}` → the literal fallback.
 */
function headingFromAttrs(attrs: string): Heading | null {
  const m = attrs.match(/(?:^|\s)title=(?:"([^"]*)"|\{([^}]*)\})/)
  if (!m) return null
  if (m[1] !== undefined) return { literal: m[1] }
  const expr = m[2].trim()
  const literal = expr.match(/^(['"])(.*)\1$/)
  if (literal) return { literal: literal[2] }
  const fallback = expr.match(/\?\?\s*(['"])(.*?)\1$/)
  if (fallback) return { literal: fallback[2] }
  return { unparsed: expr }
}

/**
 * The page a hub shows by default, as a src-relative file. Only a view the
 * hub owns (`legacyPath: null`) carries the hub's heading; a re-homed page
 * keeps its own name and is reported as a skip reason instead.
 */
function hubFirstViewFile(pageFile: string, source: string): { file: string } | { skip: string } | null {
  const hubMatch = source.match(/<PageHubView[\s\S]*?hub=\{(\w+)\}/)
  if (!hubMatch) return null
  const hub = PAGE_HUBS[hubMatch[1]]
  if (!hub) return { skip: `${pageFile} renders hub ${hubMatch[1]}, which lib/pageHubs.ts does not export` }
  const first = hub.views[0]
  if (first.legacyPath) {
    return {
      skip: `${pageFile} is a hub whose first view "${first.label}" is the re-homed ${first.legacyPath} page; its heading belongs to the view`,
    }
  }
  const render = source.match(new RegExp(`\\b${first.id}:\\s*\\(\\)\\s*=>\\s*<(\\w+)`))
  if (!render) return { skip: `${pageFile}: could not find the "${first.id}" view in the PageHubView render map` }
  const modulePath = parseComponentImports(source).get(render[1])
  if (!modulePath) return { skip: `${pageFile} does not import <${render[1]}> for its "${first.id}" view` }
  const dir = pageFile.slice(0, pageFile.lastIndexOf('/'))
  return { file: moduleToFile(dir, modulePath) }
}

interface PageHeadings {
  /** Src-relative file the headings were read from (a hub's first view page). */
  file: string
  headings: Heading[]
}

function readPageHeadings(pageFile: string): PageHeadings | { skip: string } {
  const source = read(pageFile)
  const attrs = pageHeaderBarAttrs(source)
  if (attrs.length === 0) {
    const view = hubFirstViewFile(pageFile, source)
    if (!view) return { skip: `${pageFile} has no <PageHeaderBar> and is not a PageHubView hub` }
    if ('skip' in view) return view
    return readPageHeadings(view.file)
  }
  const headings = attrs.map(headingFromAttrs)
  if (headings.some((h) => h === null)) {
    return { skip: `${pageFile} has a <PageHeaderBar> without a title= prop` }
  }
  return { file: pageFile, headings: headings as Heading[] }
}

// ── lib/copy.ts: per-mode `title:` overrides ────────────────────────────────

const copySource = read('lib/copy.ts')

interface CopyTitle {
  mode: string
  line: number
  title: string
}

/**
 * Every route-level `title:` under `'<path>': {` in each mode block of COPY.
 * Route keys sit at 4-space indent, their fields at 6 — `help.title` (8) is
 * ignored on purpose; it is the help heading, not the page heading.
 */
function copyTitlesFor(path: string): CopyTitle[] {
  const out: CopyTitle[] = []
  const modeStarts = [...copySource.matchAll(/^  (quickstart|beginner|advanced): \{/gm)].map((m) => ({
    mode: m[1],
    index: m.index ?? 0,
  }))
  const key = `\n    '${path}': {`
  let from = 0
  for (;;) {
    const start = copySource.indexOf(key, from)
    if (start === -1) break
    const mode = [...modeStarts].reverse().find((m) => m.index < start)?.mode ?? '?'
    const block = blockAt(copySource, start + key.length - 1)
    const title = block.match(/\n {6}title:\s*(?:'([^']*)'|"([^"]*)")/)
    if (title) {
      const line = copySource.slice(0, start + 1 + (title.index ?? 0)).split('\n').length + 1
      out.push({ mode, line, title: title[1] ?? title[2] })
    }
    from = start + key.length
  }
  return out
}

/** Text from the `{` at `openIndex` to its matching `}` (inclusive). */
function blockAt(source: string, openIndex: number): string {
  let depth = 0
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(openIndex, i + 1)
    }
  }
  return source.slice(openIndex)
}

// ── Entries under test ─────────────────────────────────────────────────────

const SIDEBAR_ENTRIES = NAV_REGISTRY.filter((e) => e.inSidebar !== false)

interface Resolved {
  path: string
  label: string
  pageFile: string
  headings: Heading[]
}

type Resolution = Resolved | { path: string; label: string; skip: string }

function resolveEntry(entry: { path: string; label: string }): Resolution {
  const { path, label } = entry
  const component = ROUTES.get(path)
  if (!component) return { path, label, skip: `no direct <Route path="${path}"> in App.tsx` }
  const modulePath = APP_IMPORTS.get(component)
  if (!modulePath) return { path, label, skip: `App.tsx renders <${component}> for ${path} but does not import it from ./pages` }
  const result = readPageHeadings(moduleToFile('.', modulePath))
  if ('skip' in result) return { path, label, skip: result.skip }
  return { path, label, pageFile: result.file, headings: result.headings }
}

const RESOLVED = SIDEBAR_ENTRIES.map(resolveEntry)
const CHECKABLE = RESOLVED.filter((r): r is Resolved => !('skip' in r))
const UNCHECKABLE = RESOLVED.filter((r): r is Extract<Resolution, { skip: string }> => 'skip' in r)

describe('nav label contract: sidebar label = page heading = copy title', () => {
  it('reads at least the known sidebar routes', () => {
    expect(ROUTES.size).toBeGreaterThan(20)
    expect(CHECKABLE.length).toBeGreaterThan(20)
  })

  it.each(CHECKABLE.map((r) => [r.path, r] as const))('%s', (_path, r) => {
    const problems: string[] = []
    for (const h of r.headings) {
      if ('unparsed' in h) {
        problems.push(`${r.pageFile}: could not parse PageHeaderBar title expression {${h.unparsed}} — add to SKIPPED with a reason`)
      } else if (h.literal !== r.label) {
        problems.push(`${r.pageFile}: heading "${h.literal}" but NAV_REGISTRY label for ${r.path} is "${r.label}"`)
      }
    }
    for (const c of copyTitlesFor(r.path)) {
      if (c.title !== r.label) {
        problems.push(`lib/copy.ts:${c.line} (${c.mode} '${r.path}'): title "${c.title}" but NAV_REGISTRY label is "${r.label}"`)
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('every entry it cannot check is listed in SKIPPED with a reason', () => {
    const silent = UNCHECKABLE.filter((u) => !SKIPPED.some((s) => s.path === u.path)).map(
      (u) => `${u.path} ("${u.label}"): ${u.skip}`,
    )
    expect(silent, silent.join('\n')).toEqual([])
  })

  it('SKIPPED holds only sidebar entries that are still uncheckable', () => {
    const stale = SKIPPED.filter((s) => !UNCHECKABLE.some((u) => u.path === s.path)).map(
      (s) => `${s.path}: ${s.reason} — but it is checkable now (or not a sidebar entry); remove it from SKIPPED`,
    )
    expect(stale, stale.join('\n')).toEqual([])
  })
})
