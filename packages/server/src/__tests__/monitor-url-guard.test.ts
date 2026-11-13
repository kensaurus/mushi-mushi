/**
 * FILE: monitor-url-guard.test.ts
 * PURPOSE: Every Firecrawl call site that loads a page of a customer's app
 *          goes through `_shared/monitor-url.ts`, so the app can tell
 *          Mushi's scheduled jobs from people (2026-11-13: Firecrawl's
 *          browser arrives with a google.com referrer and a stock Chrome UA,
 *          and inflated every app's analytics about 5×).
 *
 *          A static scan of the edge functions:
 *            1. every file that talks to Firecrawl is classified below, as a
 *               page loader (with its job kind) or with the reason it loads
 *               no customer page; a new call site fails until classified;
 *            2. a page loader imports the helper and uses it for its kind;
 *            3. in a page loader, every JSON body that carries `url`/`urls`
 *               is built by `monitorScrapeBody(...)`, except a map body (URL
 *               discovery renders no page);
 *            4. a file that loads no customer page calls no Firecrawl
 *               page-loading endpoint (scrape, batch scrape, crawl, monitor);
 *            5. nothing starts a crawl or builds a crawl monitor target: a
 *               crawl marks only its seed (ADR 0059).
 *          The behaviour of each builder is tested next to it (site-watch,
 *          site-audit-worker, production-check, home-thumbnail,
 *          inventory-crawler, firecrawl-v2).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const FUNCTIONS_DIR = resolve(__dirname, '../../supabase/functions')

function collectSources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      out.push(...collectSources(full))
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

const rel = (p: string) => relative(FUNCTIONS_DIR, p).split(sep).join('/')

/** Calls Firecrawl directly, or through the shared client (a static or a dynamic import). */
const TALKS_TO_FIRECRAWL = /api\.firecrawl\.dev|(?:from\s+|import\(\s*)['"][./]*(?:_shared\/)?firecrawl\.ts['"]/

/** Files that load a page of the customer's app through Firecrawl, and the job kind they mark it with. */
const PAGE_LOADERS: Record<string, 'watch' | 'audit' | 'qa'> = {
  '_shared/site-watch.ts': 'watch', // the live-site watch monitor and its confirm scrapes
  '_shared/home-thumbnail.ts': 'watch', // the Home card's screenshot of the live app
  'site-audit/index.ts': 'audit', // the scheduled site audit's batch scrape
  '_shared/production-check.ts': 'audit', // Production Check scrapes
  'inventory-crawler/index.ts': 'audit', // browser renders for the gate inventory
  'qa-story-runner/index.ts': 'qa', // QA stories on firecrawl_actions
  '_shared/firecrawl.ts': 'qa', // firecrawlScrapeOwnSite, the story mapper's crawl
}

/** Files that talk to Firecrawl but load no page of the customer's app, and why. */
const NO_CUSTOMER_PAGE_LOAD: Record<string, string> = {
  '_shared/known-issues.ts': 'searches the web for an error message',
  'fix-worker/index.ts': 'searches the web for a symptom',
  'library-modernizer/index.ts': 'reads package-registry changelogs (firecrawlScrapeChangelog)',
  'api/routes/settings-research.ts': 'manual research search',
  'search-rank/index.ts': 'reads search results; the app page is not loaded',
  'api/routes/search-rank.ts': 'resolves the key only',
  'api/routes/site-audit.ts': 'resolves the key only; the worker loads the pages',
  'api/routes/site-watch.ts': 'resolves the key and maps the site (no render); monitor requests are built in _shared/site-watch.ts',
  'site-watch-poll/index.ts': 'resolves the key and maps the site (no render); monitor requests are built in _shared/site-watch.ts',
  'api/routes/production-check.ts': 'resolves the key only; pages load in _shared/production-check.ts',
  'api/routes/project-home.ts': 'resolves the key only; the screenshot is taken in _shared/home-thumbnail.ts',
  'story-mapper/index.ts': 'pages only through firecrawlScrapeOwnSite (marked in _shared/firecrawl.ts) and the map',
  '_shared/byok-validation.ts': 'key check on the credit-usage endpoint',
  '_shared/provider-credits.ts': 'reads the credit-usage endpoint',
}

/** A Firecrawl endpoint that loads a page: scrape, batch scrape, crawl or monitor. */
const PAGE_ENDPOINT = /\/v[12]\/(?:scrape|batch\/scrape|crawl|monitor)\b|['"`]\/(?:scrape|batch\/scrape|crawl|monitor)\b/

const sources = collectSources(FUNCTIONS_DIR).map((p) => ({ file: rel(p), src: readFileSync(p, 'utf8') }))
const firecrawlFiles = sources.filter((s) => TALKS_TO_FIRECRAWL.test(s.src))

/** The argument text of every `JSON.stringify(...)` call, with its offset. */
function stringifyArgs(src: string): Array<{ at: number; arg: string }> {
  const out: Array<{ at: number; arg: string }> = []
  const marker = 'JSON.stringify('
  let from = 0
  for (;;) {
    const at = src.indexOf(marker, from)
    if (at < 0) return out
    let depth = 1
    let i = at + marker.length
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') depth--
    }
    out.push({ at, arg: src.slice(at + marker.length, i - 1).trim() })
    from = at + marker.length
  }
}

describe('Firecrawl call sites mark customer page loads (monitor-url.ts)', () => {
  it('finds the call sites at all', () => {
    expect(firecrawlFiles.length).toBeGreaterThanOrEqual(Object.keys(PAGE_LOADERS).length)
  })

  it('classifies every file that talks to Firecrawl, and lists no file that does not', () => {
    const known = new Set([...Object.keys(PAGE_LOADERS), ...Object.keys(NO_CUSTOMER_PAGE_LOAD)])
    const unclassified = firecrawlFiles.map((f) => f.file).filter((f) => !known.has(f))
    expect(unclassified, 'add the file to PAGE_LOADERS (and use monitor-url.ts) or to NO_CUSTOMER_PAGE_LOAD with a reason').toEqual([])
    const stale = [...known].filter((f) => !firecrawlFiles.some((s) => s.file === f))
    expect(stale).toEqual([])
  })

  it('every page loader imports the helper and marks its own job kind', () => {
    for (const [file, kind] of Object.entries(PAGE_LOADERS)) {
      const src = sources.find((s) => s.file === file)!.src
      expect(src, file).toMatch(/from\s+['"][./]*(?:_shared\/)?monitor-url\.ts['"]/)
      const marks = new RegExp(`(?:monitorScrapeBody|tagMonitorUrl)\\(\\s*'${kind}'|monitorKind:\\s*'${kind}'`)
      expect(src, file).toMatch(marks)
    }
  })

  it('in a page loader, every JSON body with a url is built by monitorScrapeBody (map bodies aside)', () => {
    const raw: string[] = []
    for (const file of Object.keys(PAGE_LOADERS)) {
      const src = sources.find((s) => s.file === file)!.src
      for (const { at, arg } of stringifyArgs(src)) {
        if (!/(?:^|[{,\s])urls?\s*[:,}]/.test(arg)) continue
        if (/^monitorScrapeBody\(/.test(arg)) continue
        // A map discovers URLs and renders no page (monitor-url.ts).
        if (/\/map['"`]|\/v2\/map/.test(src.slice(Math.max(0, at - 300), at))) continue
        raw.push(`${file}: JSON.stringify(${arg.slice(0, 80)}…)`)
      }
    }
    expect(raw).toEqual([])
  })

  it('a file that loads no customer page calls no Firecrawl page-loading endpoint', () => {
    const offenders = Object.keys(NO_CUSTOMER_PAGE_LOAD).filter((file) => PAGE_ENDPOINT.test(sources.find((s) => s.file === file)!.src))
    expect(offenders).toEqual([])
  })

  it('nothing starts a Firecrawl crawl: a crawl marks only its seed URL (ADR 0059)', () => {
    // A crawl loads the pages it finds by their bare links, so ~500 pages a
    // day reached the apps unmarked. The live-site watch is a marked page
    // list (scrape targets) instead; a new crawl needs a new ADR.
    const crawl = /\/v[12]\/crawl\b|['"`]\/crawl['"`/]|type:\s*['"]crawl['"]/
    const offenders = firecrawlFiles.filter((f) => crawl.test(f.src)).map((f) => f.file)
    expect(offenders).toEqual([])
  })
})
