/**
 * FILE: journey-map.test.ts
 * PURPOSE: The Journey optimizer's pure analysis (_shared/journey-map.ts):
 *          moves, entries and exits from visits; dead ends vs high exits;
 *          back-and-forth loops; reloads; near-duplicate and same-address
 *          pages; orphan and deep pages from a scan; future-dated rows
 *          dropped; and the helpers the scan worker uses.
 */

import { describe, expect, it } from 'vitest'
import {
  agentPrompt,
  boilerplateLines,
  buildJourneyMap,
  internalPaths,
  minhash,
  ownWords,
  routeVariants,
  similarity,
  SIG_SIZE,
  type PageViewRow,
  type ScannedPage,
} from '../../supabase/functions/_shared/journey-map.ts'

const NOW = new Date('2026-11-13T12:00:00Z')
let clock = NOW.getTime() - 3 * 86_400_000

/** One session visiting `routes` in order, `gapMs` apart (a minute by default). */
function sessionAt(id: string, gapMs: number, ...routes: string[]): PageViewRow[] {
  return routes.map((route) => {
    clock += gapMs
    return { session_id: id, route, ts: new Date(clock).toISOString() }
  })
}

function session(id: string, ...routes: string[]): PageViewRow[] {
  return sessionAt(id, 60_000, ...routes)
}

function many(n: number, prefix: string, ...routes: string[]): PageViewRow[] {
  return Array.from({ length: n }, (_, i) => session(`${prefix}${i}`, ...routes)).flat()
}

function manyAt(n: number, prefix: string, gapMs: number, ...routes: string[]): PageViewRow[] {
  return Array.from({ length: n }, (_, i) => sessionAt(`${prefix}${i}`, gapMs, ...routes)).flat()
}

function page(path: string, links: string[], text = '', title: string | null = null): ScannedPage {
  const words = text ? text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [] : []
  return { path, url: `https://app.test${path}`, title, links, words: words.length, sig: minhash(words) }
}

const LOREM =
  'our pricing is simple you pay one flat fee each month for every project and every teammate you add there are no hidden costs and you can cancel at any time from the settings page with one click and keep your data for thirty days after'

describe('buildJourneyMap from visits', () => {
  it('counts moves, entries, exits, bounces and common flows', () => {
    const views = [
      ...many(3, 'a', '/', '/pricing', '/signup'),
      ...session('b0', '/'),
      ...session('c0', '/blog/123', '/'),
    ]
    const map = buildJourneyMap({ views, viewsSampled: false, scan: null, brokenUrls: [], now: NOW })
    expect(map.stats).toMatchObject({ sessions: 5, pageViews: 12, pages: 4, bounceRate: 0.2, sampled: false })
    const home = map.nodes.find((n) => n.path === '/')!
    expect(home).toMatchObject({ visits: 5, entries: 4, exits: 2 })
    // /blog/123 is normalized to /blog/:id.
    expect(map.nodes.some((n) => n.path === '/blog/:id')).toBe(true)
    expect(map.edges.find((e) => e.from === '/' && e.to === '/pricing')).toMatchObject({ moves: 3, linked: false })
    expect(map.flows[0]).toEqual({ pages: ['/', '/pricing', '/signup'], sessions: 3 })
  })

  it('drops rows stamped in the future instead of trusting a client clock', () => {
    const views: PageViewRow[] = [
      { session_id: 's', route: '/', ts: new Date(NOW.getTime() - 60_000).toISOString() },
      { session_id: 's', route: '/later', ts: new Date(NOW.getTime() + 86_400_000).toISOString() },
    ]
    const map = buildJourneyMap({ views, viewsSampled: false, scan: null, brokenUrls: [], now: NOW })
    expect(map.stats.pageViews).toBe(1)
    expect(map.nodes.map((n) => n.path)).toEqual(['/'])
  })

  it('calls a page with many exits a dead end only when it has no link onward', () => {
    const views = [...many(10, 'd', '/', '/report'), ...many(10, 'e', '/', '/faq')]
    const scan = {
      rootPath: '/',
      pages: [
        page('/', ['/report', '/faq', '/about']),
        page('/report', ['/', '/faq', '/about']),
        page('/faq', ['/', '/report', '/about', '/contact']),
        page('/about', ['/', '/report', '/faq']),
      ],
    }
    const map = buildJourneyMap({ views, viewsSampled: false, scan, brokenUrls: [], now: NOW })
    const kinds = Object.fromEntries(map.findings.filter((f) => ['dead_end', 'high_exit'].includes(f.kind)).map((f) => [f.pages[0], f.kind]))
    // /report links only to site navigation; /faq links on to /contact.
    expect(kinds['/report']).toBe('dead_end')
    expect(kinds['/faq']).toBe('high_exit')
  })

  it('does not flag pages where leaving is the point', () => {
    const map = buildJourneyMap({ views: many(12, 't', '/checkout', '/thank-you'), viewsSampled: false, scan: null, brokenUrls: [], now: NOW })
    expect(map.findings.filter((f) => f.pages.includes('/thank-you'))).toEqual([])
  })

  it('finds wrong doors (a bounce within seconds, then another page) and reloads', () => {
    const views = [
      ...manyAt(5, 'l', 5_000, '/settings', '/billing', '/settings', '/invoices'),
      // Under the bar (5 cases): two bounces are not a finding.
      ...manyAt(2, 'q', 5_000, '/settings', '/help', '/settings', '/invoices'),
      ...many(5, 'r', '/editor', '/editor', '/editor'),
    ]
    const map = buildJourneyMap({ views, viewsSampled: false, scan: null, brokenUrls: [], now: NOW })
    expect(map.findings.filter((f) => f.kind === 'loop')).toHaveLength(1)
    const loop = map.findings.find((f) => f.kind === 'loop')!
    expect(loop.pages).toEqual(['/billing', '/settings', '/invoices'])
    expect(loop.severity).toBe('low')
    expect(loop.title).toBe('People open /billing by mistake and go to /invoices instead')
    expect(loop.detail).toContain('5 times')
    expect(loop.detail).toContain('within 15 seconds')
    const reload = map.findings.find((f) => f.kind === 'reload')!
    expect(reload.pages).toEqual(['/editor'])
    expect(map.nodes.find((n) => n.path === '/editor')!.issues).toContain('reload')
  })

  it('does not call normal list and hub use a wrong door, and reports a pair of pages once', () => {
    // Home → new transaction → home after using the form (a tab app): normal.
    const hub = buildJourneyMap({ views: many(10, 'h', '/(tabs)', '/transaction/new', '/(tabs)', '/(tabs)/plan'), viewsSampled: false, scan: null, brokenUrls: [], now: NOW })
    expect(hub.findings.filter((f) => f.kind === 'loop')).toEqual([])
    // List → item → list → another item, quickly: browsing, not confusion.
    const list = buildJourneyMap({ views: manyAt(10, 'l', 3_000, '/orders', '/orders/101', '/orders', '/orders/102'), viewsSampled: false, scan: null, brokenUrls: [], now: NOW })
    expect(list.findings.filter((f) => f.kind === 'loop')).toEqual([])
    // A bounce and then leaving the app is not a wrong door either.
    const leave = buildJourneyMap({ views: manyAt(10, 'x', 3_000, '/a', '/b', '/a'), viewsSampled: false, scan: null, brokenUrls: [], now: NOW })
    expect(leave.findings.filter((f) => f.kind === 'loop')).toEqual([])
    // Wrong doors both ways between two pages: one finding, not two.
    const both = buildJourneyMap({
      views: [...manyAt(6, 'a', 4_000, '/a', '/b', '/a', '/c'), ...manyAt(4, 'b', 4_000, '/b', '/a', '/b', '/c')],
      viewsSampled: false,
      scan: null,
      brokenUrls: [],
      now: NOW,
    })
    expect(both.findings.filter((f) => f.kind === 'loop')).toHaveLength(1)
  })

  it('counts each kind of finding at most three times toward the score', () => {
    const scanPages = [page('/', ['/a']), page('/a', ['/'])]
    for (let i = 0; i < 10; i++) scanPages.push(page(`/orphan-${i}`, ['/']))
    const map = buildJourneyMap({ views: [], viewsSampled: false, scan: { rootPath: '/', pages: scanPages }, brokenUrls: [], now: NOW })
    expect(map.findings.filter((f) => f.kind === 'orphan')).toHaveLength(10)
    // Ten low-severity orphans cost three times the low weight, not ten.
    expect(map.score).toBe(94)
  })

  it('puts broken pages first and scores lower with more findings', () => {
    const clean = buildJourneyMap({ views: many(3, 'x', '/', '/a'), viewsSampled: false, scan: null, brokenUrls: [], now: NOW })
    const broken = buildJourneyMap({ views: many(3, 'x', '/', '/a'), viewsSampled: false, scan: null, brokenUrls: ['https://app.test/a?x=1'], now: NOW })
    expect(clean.score).toBe(100)
    expect(broken.findings[0]).toMatchObject({ kind: 'broken', severity: 'high', pages: ['/a'] })
    expect(broken.score).toBeLessThan(clean.score)
    expect(buildJourneyMap({ views: [], viewsSampled: false, scan: null, brokenUrls: [], now: NOW }).score).toBe(0)
  })
})

describe('buildJourneyMap from a site scan', () => {
  const scan = {
    rootPath: '/',
    pages: [
      page('/', ['/pricing', '/docs']),
      page('/pricing', ['/'], LOREM, 'Pricing | App'),
      page('/plans', ['/'], `${LOREM} today`, 'Plans | App'),
      page('/docs', ['/', '/docs/a']),
      page('/docs/a', ['/docs/a/b']),
      page('/docs/a/b', ['/docs/a/b/c']),
      page('/docs/a/b/c', ['/docs/a/b/c/d']),
      page('/docs/a/b/c/d', []),
      page('/old', ['/'], '', 'App'),
      page('/older', ['/'], '', 'App'),
    ],
  }
  const map = buildJourneyMap({ views: [], viewsSampled: false, scan, brokenUrls: [], now: NOW })

  it('finds near-duplicate pages by content', () => {
    const dup = map.findings.find((f) => f.kind === 'duplicate_page')
    expect(dup?.pages).toEqual(['/plans', '/pricing'])
  })

  it('finds pages nothing links to and pages too many clicks deep', () => {
    const orphans = map.findings.filter((f) => f.kind === 'orphan').map((f) => f.pages[0])
    expect(orphans).toEqual(expect.arrayContaining(['/plans', '/old', '/older']))
    expect(orphans).not.toContain('/')
    const deep = map.findings.filter((f) => f.kind === 'deep_page').map((f) => f.pages[0]).sort()
    // 4 clicks or more from the start page.
    expect(deep).toEqual(['/docs/a/b/c', '/docs/a/b/c/d'])
    expect(map.nodes.find((n) => n.path === '/docs/a/b/c/d')?.depth).toBe(5)
  })

  it('finds shared titles, but not twice for pages already flagged as duplicates', () => {
    const titles = map.findings.filter((f) => f.kind === 'duplicate_title')
    expect(titles.map((f) => f.pages)).toEqual([['/old', '/older']])
  })

  it('marks moves that follow a real link', () => {
    const withVisits = buildJourneyMap({ views: many(2, 'v', '/', '/pricing'), viewsSampled: false, scan, brokenUrls: [], now: NOW })
    expect(withVisits.edges.find((e) => e.from === '/' && e.to === '/pricing')).toMatchObject({ moves: 2, linked: true })
    // Links nobody used still draw (moves 0).
    expect(withVisits.edges.find((e) => e.from === '/' && e.to === '/docs')).toMatchObject({ moves: 0, linked: true })
  })

  it('gives every finding a self-contained agent prompt', () => {
    for (const f of map.findings) {
      expect(f.prompt).toContain(f.title)
      for (const p of f.pages) expect(f.prompt).toContain(p)
    }
  })
})

describe('scan helpers', () => {
  it('keeps only internal page links as normalized paths', () => {
    const links = [
      'https://app.test/pricing?ref=nav',
      '/docs/getting-started#top',
      'https://www.app.test/About/',
      'https://other.test/x',
      'https://sub.app.test/y',
      'mailto:hi@app.test',
      '/logo.png',
      '/users/123456',
    ]
    expect(internalPaths(links, 'https://app.test/', 'https://app.test').sort()).toEqual(['/About', '/docs/getting-started', '/pricing', '/users/:id'])
    // A base path scopes the app on a shared host.
    expect(internalPaths(['/glot-it/a', '/yen-yen/b', '/glot-it'], 'https://kensaur.us/glot-it/', 'https://kensaur.us/glot-it')).toEqual(['/glot-it/a', '/glot-it'])
  })

  it('removes the lines every page shares before fingerprinting', () => {
    const chrome = '[Home](/)\n[Pricing](/pricing)\n© 2026 App'
    const mds = ['a', 'b', 'c', 'd'].map((x) => `${chrome}\nThis is page ${x} with its own words`)
    const boiler = boilerplateLines(mds)
    expect(boiler.has('© 2026 App')).toBe(true)
    expect(ownWords(mds[0]!, boiler)).toEqual(['this', 'is', 'page', 'a', 'with', 'its', 'own', 'words'])
  })

  it('estimates content overlap with MinHash, including text without spaces', () => {
    const a = minhash(LOREM.split(' '))
    expect(a).toHaveLength(SIG_SIZE)
    expect(similarity(a, minhash(LOREM.split(' ')))).toBe(1)
    expect(similarity(a, minhash('a completely different page about how to reset your password when the email does not arrive in time'.split(' ')))).toBeLessThan(0.2)
    const ja = '一人社長の決算と申告をはじめる前に必要な書類の一覧と準備の手順を説明します'
    expect(minhash([ja])).toHaveLength(SIG_SIZE)
    expect(minhash(['short'])).toEqual([])
  })

  it('groups addresses that are one page', () => {
    expect(routeVariants(['/About', '/about', '/about/index.html', '/pricing'])).toEqual([['/About', '/about', '/about/index.html']])
  })

  it('writes a prompt a coding agent can act on alone', () => {
    const prompt = agentPrompt({ kind: 'dead_end', title: 'Dead end on /report', detail: 'D', suggestion: 'Add a next step.', pages: ['/report'] })
    expect(prompt).toContain('Journey optimizer found: Dead end on /report.')
    expect(prompt).toContain('- /report')
    expect(prompt).toContain('What to change: Add a next step.')
  })
})
