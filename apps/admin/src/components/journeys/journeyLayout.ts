/**
 * FILE: apps/admin/src/components/journeys/journeyLayout.ts
 * PURPOSE: Pure builder for the Journey optimizer's flow map: JourneyMap →
 *          React Flow nodes and edges, laid out left to right by dagre from
 *          the start page, so the busiest paths read like a story.
 *
 * Rules:
 * - Edges with real moves are the skeleton dagre ranks on; links nobody
 *   used are drawn faint and do not shape the layout.
 * - An edge's width grows with its share of moves (log scale, 1–7 px).
 * - A move that does not follow a link on the page (`linked` false, with a
 *   scan) is dashed: people got there by the menu, back button or search.
 * - Pages no edge reaches are stacked in a last column, so nothing hides.
 * - With no real moves (a site scan only), the map is the site's own
 *   hierarchy instead: each page under its nearest parent path (/docs/a
 *   under /docs, everything else under the start page), level by level,
 *   with a large group of siblings wrapped into columns. A docs sidebar
 *   links every page to every page, so the links alone draw nothing useful
 *   (Solo Boss Cloud, 2026-11-13: 110 sidebar links on each page).
 */

import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'
import { nodeSeverity, type JourneyFinding, type JourneyMap, type JourneyNode, type JourneySeverity } from '../../lib/journeys'

/** @internal Exported for tests. */
export const JOURNEY_NODE_SIZE = { width: 196, height: 70 }
const ROW_GAP = 26
const COLUMN_GAP = 90
/** @internal Exported for tests. Most siblings stacked in one column of the site hierarchy before it wraps. */
export const SITEMAP_MAX_ROWS = 8

export interface JourneyNodeData extends Record<string, unknown> {
  node: JourneyNode
  severity: JourneySeverity | null
  isRoot: boolean
  /** Share of all page views (0–1). */
  share: number
}

export interface JourneyEdgeData extends Record<string, unknown> {
  moves: number
  linked: boolean
  /** True when the map has a scan, so `linked` false means "no link". */
  hasScan: boolean
  width: number
  onIssue: boolean
  /** An edge of the site hierarchy (no visits yet), not a link or a move. */
  tree?: boolean
}

export interface JourneyLayout {
  /** 'flow': laid out on real moves (or links); 'sitemap': the site's own hierarchy. */
  mode: 'flow' | 'sitemap'
  nodes: Node<JourneyNodeData>[]
  edges: Edge<JourneyEdgeData>[]
  width: number
  height: number
}

/** @internal Exported for tests. */
export function edgeWidth(moves: number, maxMoves: number): number {
  if (moves <= 0 || maxMoves <= 0) return 1
  return Math.round((1 + (6 * Math.log1p(moves)) / Math.log1p(maxMoves)) * 10) / 10
}

export function buildJourneyLayout(map: JourneyMap, hasScan: boolean, findings: JourneyFinding[] = map.findings): JourneyLayout {
  const hasMoves = map.edges.some((e) => e.moves > 0 && e.from !== e.to)
  if (!hasMoves && map.nodes.length > 1) return sitemapLayout(map, hasScan, findings)
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: ROW_GAP, ranksep: COLUMN_GAP, marginx: 8, marginy: 8 })
  g.setDefaultEdgeLabel(() => ({}))
  const paths = new Set(map.nodes.map((n) => n.path))
  for (const n of map.nodes) g.setNode(n.path, { ...JOURNEY_NODE_SIZE })

  const used = map.edges.filter((e) => e.moves > 0 && e.from !== e.to && paths.has(e.from) && paths.has(e.to))
  const linkedOnly = map.edges.filter((e) => e.moves === 0 && paths.has(e.from) && paths.has(e.to))
  // Shape the layout on real moves; with none (scan only), on links.
  for (const e of used.length > 0 ? used : linkedOnly) g.setEdge(e.from, e.to)
  dagre.layout(g)

  const totalViews = map.nodes.reduce((s, n) => s + n.visits, 0)
  const issuePages = new Set(findings.flatMap((f) => f.pages))
  const touched = new Set([...used, ...(used.length > 0 ? [] : linkedOnly)].flatMap((e) => [e.from, e.to]))

  let maxX = 0
  let maxY = 0
  const nodes: Node<JourneyNodeData>[] = []
  const loose: JourneyNode[] = []
  for (const n of map.nodes) {
    if (!touched.has(n.path) && map.nodes.length > 1) {
      loose.push(n)
      continue
    }
    const pos = g.node(n.path) as { x: number; y: number } | undefined
    const x = (pos?.x ?? 0) - JOURNEY_NODE_SIZE.width / 2
    const y = (pos?.y ?? 0) - JOURNEY_NODE_SIZE.height / 2
    maxX = Math.max(maxX, x + JOURNEY_NODE_SIZE.width)
    maxY = Math.max(maxY, y + JOURNEY_NODE_SIZE.height)
    nodes.push(toNode(n, x, y))
  }
  // Pages nothing connects to: one column at the right edge.
  const looseX = nodes.length > 0 ? maxX + COLUMN_GAP : 0
  loose.forEach((n, i) => {
    const y = i * (JOURNEY_NODE_SIZE.height + ROW_GAP)
    maxY = Math.max(maxY, y + JOURNEY_NODE_SIZE.height)
    nodes.push(toNode(n, looseX, y))
  })
  if (loose.length > 0) maxX = looseX + JOURNEY_NODE_SIZE.width

  const maxMoves = Math.max(0, ...used.map((e) => e.moves))
  const edges: Edge<JourneyEdgeData>[] = [...used, ...linkedOnly].map((e) => ({
    id: `${e.from}->${e.to}`,
    source: e.from,
    target: e.to,
    type: 'journey',
    data: {
      moves: e.moves,
      linked: e.linked,
      hasScan,
      width: edgeWidth(e.moves, maxMoves),
      onIssue: issuePages.has(e.to) && e.moves > 0,
    },
  }))

  return { mode: 'flow', nodes, edges, width: maxX, height: maxY }

  function toNode(n: JourneyNode, x: number, y: number): Node<JourneyNodeData> {
    return {
      id: n.path,
      type: 'journey-page',
      position: { x, y },
      width: JOURNEY_NODE_SIZE.width,
      height: JOURNEY_NODE_SIZE.height,
      draggable: false,
      connectable: false,
      data: {
        node: n,
        severity: nodeSeverity(n, findings),
        isRoot: n.path === map.rootPath,
        share: totalViews > 0 ? n.visits / totalViews : 0,
      },
    }
  }
}

/** @internal Exported for tests. Each page's parent in the site hierarchy: the longest other page path it sits under, else the start page. */
export function sitemapParents(paths: string[], rootPath: string): Map<string, string> {
  const set = new Set(paths)
  const root = set.has(rootPath) ? rootPath : set.has('/') ? '/' : null
  const parents = new Map<string, string>()
  for (const p of paths) {
    if (p === root) continue
    let best: string | null = null
    for (const q of paths) {
      if (q === p || q === '/' || !p.startsWith(`${q}/`)) continue
      if (!best || q.length > best.length) best = q
    }
    const parent = best ?? root
    if (parent && parent !== p) parents.set(p, parent)
  }
  return parents
}

function sitemapLayout(map: JourneyMap, hasScan: boolean, findings: JourneyFinding[]): JourneyLayout {
  const paths = map.nodes.map((n) => n.path)
  const parents = sitemapParents(paths, map.rootPath)
  const byPath = new Map(map.nodes.map((n) => [n.path, n]))
  const level = (p: string): number => {
    let d = 0
    for (let at = p; parents.has(at) && d < 50; at = parents.get(at)!) d++
    return d
  }
  // Order: depth first from the start page, so siblings sit together.
  const children = new Map<string, string[]>()
  for (const [child, parent] of parents) children.set(parent, [...(children.get(parent) ?? []), child])
  for (const list of children.values()) list.sort()
  const order: string[] = []
  const visit = (p: string) => {
    order.push(p)
    for (const c of children.get(p) ?? []) visit(c)
  }
  for (const p of [...paths].filter((x) => !parents.has(x)).sort()) visit(p)

  const levels = new Map<number, string[]>()
  for (const p of order) levels.set(level(p), [...(levels.get(level(p)) ?? []), p])
  const rowH = JOURNEY_NODE_SIZE.height + ROW_GAP
  const colW = JOURNEY_NODE_SIZE.width + COLUMN_GAP / 2
  const tallest = Math.min(SITEMAP_MAX_ROWS, Math.max(...[...levels.values()].map((l) => l.length)))
  const positions = new Map<string, { x: number; y: number }>()
  let x = 0
  for (const d of [...levels.keys()].sort((a, b) => a - b)) {
    const items = levels.get(d)!
    const cols = Math.ceil(items.length / SITEMAP_MAX_ROWS)
    const rows = Math.min(items.length, SITEMAP_MAX_ROWS)
    const top = ((tallest - rows) * rowH) / 2
    items.forEach((p, i) => {
      positions.set(p, { x: x + Math.floor(i / SITEMAP_MAX_ROWS) * colW, y: top + (i % SITEMAP_MAX_ROWS) * rowH })
    })
    x += cols * colW + COLUMN_GAP / 2
  }

  const totalViews = map.nodes.reduce((sum, n) => sum + n.visits, 0)
  const nodes: Node<JourneyNodeData>[] = order.map((p) => {
    const n = byPath.get(p)!
    const pos = positions.get(p)!
    return {
      id: p,
      type: 'journey-page',
      position: pos,
      width: JOURNEY_NODE_SIZE.width,
      height: JOURNEY_NODE_SIZE.height,
      draggable: false,
      connectable: false,
      data: { node: n, severity: nodeSeverity(n, findings), isRoot: p === map.rootPath, share: totalViews > 0 ? n.visits / totalViews : 0 },
    }
  })
  const edges: Edge<JourneyEdgeData>[] = [...parents].map(([child, parent]) => ({
    id: `${parent}->${child}`,
    source: parent,
    target: child,
    type: 'journey',
    data: { moves: 0, linked: true, hasScan, width: 1, onIssue: false, tree: true },
  }))
  const width = Math.max(0, ...nodes.map((n) => n.position.x + JOURNEY_NODE_SIZE.width))
  const height = Math.max(0, ...nodes.map((n) => n.position.y + JOURNEY_NODE_SIZE.height))
  return { mode: 'sitemap', nodes, edges, width, height }
}
