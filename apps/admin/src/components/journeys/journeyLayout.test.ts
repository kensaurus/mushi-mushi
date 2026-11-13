import { describe, expect, it } from 'vitest'
import { buildJourneyLayout, edgeWidth, JOURNEY_NODE_SIZE } from './journeyLayout'
import { allFindingsPrompt, nodeSeverity, type JourneyFinding, type JourneyMap, type JourneyNode } from '../../lib/journeys'

const node = (path: string, over: Partial<JourneyNode> = {}): JourneyNode => ({
  path,
  label: path,
  visits: 10,
  entries: 0,
  exits: 0,
  exitRate: 0,
  inScan: true,
  inbound: 1,
  outbound: 1,
  depth: 1,
  broken: false,
  issues: [],
  ...over,
})

const finding = (kind: JourneyFinding['kind'], severity: JourneyFinding['severity'], pages: string[]): JourneyFinding => ({
  id: `${kind}:${pages.join('|')}`,
  kind,
  severity,
  pages,
  title: `${kind} on ${pages[0]}`,
  detail: 'd',
  suggestion: 's',
  prompt: 'p',
})

function map(over: Partial<JourneyMap> = {}): JourneyMap {
  return {
    stats: { sessions: 10, pageViews: 30, pages: 4, avgPagesPerSession: 3, bounceRate: 0.1, sampled: false },
    score: 88,
    rootPath: '/',
    nodes: [node('/', { visits: 20 }), node('/pricing'), node('/signup'), node('/lonely', { visits: 0 })],
    edges: [
      { from: '/', to: '/pricing', moves: 9, linked: true },
      { from: '/pricing', to: '/signup', moves: 2, linked: false },
      { from: '/', to: '/signup', moves: 0, linked: true },
    ],
    flows: [],
    findings: [finding('dead_end', 'high', ['/signup'])],
    ...over,
  }
}

describe('buildJourneyLayout', () => {
  it('lays pages out left to right from the start page', () => {
    const l = buildJourneyLayout(map(), true)
    const x = (id: string) => l.nodes.find((n) => n.id === id)!.position.x
    expect(x('/')).toBeLessThan(x('/pricing'))
    expect(x('/pricing')).toBeLessThan(x('/signup'))
  })

  it('puts pages nothing connects to in a last column instead of hiding them', () => {
    const l = buildJourneyLayout(map(), true)
    const lonely = l.nodes.find((n) => n.id === '/lonely')!
    const others = l.nodes.filter((n) => n.id !== '/lonely')
    expect(lonely.position.x).toBeGreaterThan(Math.max(...others.map((n) => n.position.x)))
    expect(l.width).toBe(lonely.position.x + JOURNEY_NODE_SIZE.width)
  })

  it('draws used moves thicker, flags moves into problem pages, keeps unused links', () => {
    const l = buildJourneyLayout(map(), true)
    const e = (id: string) => l.edges.find((x) => x.id === id)!.data!
    expect(e('/->/pricing').width).toBeGreaterThan(e('/pricing->/signup').width)
    expect(e('/pricing->/signup')).toMatchObject({ onIssue: true, linked: false, hasScan: true })
    expect(e('/->/signup')).toMatchObject({ moves: 0, width: 1, onIssue: false })
  })

  it('colours a page by its worst finding and marks the start page', () => {
    const l = buildJourneyLayout(map(), true)
    expect(l.nodes.find((n) => n.id === '/signup')!.data.severity).toBe('high')
    expect(l.nodes.find((n) => n.id === '/')!.data.isRoot).toBe(true)
    expect(l.nodes.find((n) => n.id === '/')!.data.share).toBeCloseTo(20 / 40)
  })

  it('lays out a scan-only map on its links', () => {
    const l = buildJourneyLayout(map({ edges: [{ from: '/', to: '/pricing', moves: 0, linked: true }] }), true)
    const x = (id: string) => l.nodes.find((n) => n.id === id)!.position.x
    expect(x('/')).toBeLessThan(x('/pricing'))
  })

  it('handles an empty map', () => {
    expect(buildJourneyLayout(map({ nodes: [], edges: [], findings: [] }), false)).toEqual({ nodes: [], edges: [], width: 0, height: 0 })
  })
})

describe('helpers', () => {
  it('scales edge width on a log curve between 1 and 7', () => {
    expect(edgeWidth(0, 10)).toBe(1)
    expect(edgeWidth(10, 10)).toBe(7)
    expect(edgeWidth(1, 100)).toBeLessThan(edgeWidth(10, 100))
  })

  it('picks the worst severity for a node', () => {
    const fs = [finding('orphan', 'low', ['/a']), finding('loop', 'medium', ['/a', '/b'])]
    expect(nodeSeverity(node('/a'), fs)).toBe('medium')
    expect(nodeSeverity(node('/c'), fs)).toBeNull()
  })

  it('joins every finding into one numbered prompt', () => {
    const text = allFindingsPrompt([finding('dead_end', 'high', ['/x']), finding('orphan', 'low', ['/y'])], 'https://app.test')
    expect(text).toContain('(https://app.test)')
    expect(text).toContain('found 2 problems')
    expect(text).toContain('1. dead_end on /x')
    expect(text).toContain('2. orphan on /y')
  })
})

describe('Home Pages card count', () => {
  it('counts only pages with their own visits, bugs or broken flag', async () => {
    const { shownPages } = await import('../home/SitemapCard')
    const page = (path: string, views: number, bugs = 0) => ({ path, label: path, depth: path === '/' ? 0 : 1, views, bugs, broken: false })
    // SBC on 2026-11-13: Home row with nothing, three pages with bugs, three distinct pages.
    expect(shownPages({ pages: [page('/', 0), page('/company', 0, 2), page('/closing', 0, 1), page('/settings', 0, 1)], totalPages: 3, sampled: false })).toBe(3)
  })
})
