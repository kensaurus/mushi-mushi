/**
 * Grouped navigation for /explore — reduces 8 flat tabs to 5 primary groups
 * with optional secondary segments (Understand: Ask/Tour/Domains, Map: Graph/Layers/Diagram).
 * URL params stay backward-compatible (`?tab=ask` still works).
 */

import type { ExploreTabId } from '../components/explore/ExploreStatsTypes'

export type ExplorePrimaryTabId = 'overview' | 'understand' | 'map' | 'search' | 'index'

export type ExploreUnderstandView = 'ask' | 'tour' | 'domains' | 'knowledge'
export type ExploreMapView = 'graph' | 'layers' | 'diagram'

const UNDERSTAND_VIEWS: ExploreUnderstandView[] = ['ask', 'tour', 'domains', 'knowledge']
const MAP_VIEWS: ExploreMapView[] = ['graph', 'layers', 'diagram']

export function resolveExploreTab(value: string | null): ExploreTabId {
  if (
    value === 'overview' ||
    value === 'graph' ||
    value === 'diagram' ||
    value === 'search' ||
    value === 'index' ||
    value === 'ask' ||
    value === 'tour' ||
    value === 'domains' ||
    value === 'knowledge'
  ) {
    return value
  }
  // Layers is the default map: hundreds of files drawn as a graph and fit to
  // the canvas render as a thin strip with an empty minimap.
  return 'layers'
}

/**
 * The URL for switching to `tab`. Always writes `tab` explicitly, Graph
 * included: a bare `/explore` lets Beginner and Quickstart modes pick a
 * starting tab, so deleting the param for Graph made every "show in graph"
 * action (Map tab, citations, tour stops, domain files) bounce straight back.
 */
export function exploreTabSearchParams(prev: URLSearchParams, tab: ExploreTabId): URLSearchParams {
  const next = new URLSearchParams(prev)
  next.set('tab', tab)
  return next
}

const TAB_ACTION_LABELS: Partial<Record<ExploreTabId, string>> = {
  index: 'Open Index',
  ask: 'Open Ask',
  graph: 'Open Graph',
  layers: 'Open Layers',
  overview: 'Open Summary',
  search: 'Open Search',
}

/**
 * Button text for a banner link, named after where it goes. The stale and
 * ready banners said "Open Graph" while linking to the Index or Ask tab.
 */
export function exploreActionLabelFor(to: string | null | undefined): string {
  if (!to) return 'Open Graph'
  if (to.startsWith('/connect')) return 'Open Connect'
  if (!to.startsWith('/explore')) return 'Open'
  const query = to.includes('?') ? to.slice(to.indexOf('?') + 1) : ''
  const tab = resolveExploreTab(new URLSearchParams(query).get('tab'))
  return TAB_ACTION_LABELS[tab] ?? 'Open'
}

export function primaryTabOf(tab: ExploreTabId): ExplorePrimaryTabId {
  if (tab === 'overview') return 'overview'
  if (UNDERSTAND_VIEWS.includes(tab as ExploreUnderstandView)) return 'understand'
  if (MAP_VIEWS.includes(tab as ExploreMapView)) return 'map'
  if (tab === 'search') return 'search'
  return 'index'
}

export function defaultTabForPrimary(primary: ExplorePrimaryTabId): ExploreTabId {
  switch (primary) {
    case 'overview':
      return 'overview'
    case 'understand':
      return 'ask'
    case 'map':
      return 'layers'
    case 'search':
      return 'search'
    case 'index':
      return 'index'
  }
}

export function isUnderstandView(tab: ExploreTabId): tab is ExploreUnderstandView {
  return UNDERSTAND_VIEWS.includes(tab as ExploreUnderstandView)
}

export function isMapView(tab: ExploreTabId): tab is ExploreMapView {
  return MAP_VIEWS.includes(tab as ExploreMapView)
}

export const EXPLORE_PRIMARY_TABS: Array<{
  id: ExplorePrimaryTabId
  label: string
  description: string
}> = [
  {
    id: 'overview',
    label: 'Summary',
    description: 'Index posture, layer breakdown, and quick links into Ask or Tour.',
  },
  {
    id: 'understand',
    label: 'Understand',
    description: 'Ask questions, follow a guided tour, or explore business domains.',
  },
  {
    id: 'map',
    label: 'Map',
    description: 'Interactive graph, layer lane, or an AI architecture diagram — click nodes for plain-English summaries.',
  },
  {
    id: 'search',
    label: 'Search',
    description: 'Semantic search over embedded files — plain-English queries.',
  },
  {
    id: 'index',
    label: 'Index',
    description: 'Indexer debug — repo URL, webhook, last error, embedding coverage.',
  },
]

export const EXPLORE_UNDERSTAND_VIEWS: Array<{ id: ExploreUnderstandView; label: string }> = [
  { id: 'ask', label: 'Ask' },
  { id: 'tour', label: 'Tour' },
  { id: 'domains', label: 'Domains' },
  { id: 'knowledge', label: 'Knowledge' },
]

export const EXPLORE_MAP_VIEWS: Array<{ id: ExploreMapView; label: string }> = [
  { id: 'layers', label: 'Layers' },
  { id: 'graph', label: 'Graph' },
  { id: 'diagram', label: 'Diagram' },
]
