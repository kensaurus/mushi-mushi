/**
 * Grouped navigation for /explore — reduces 8 flat tabs to 5 primary groups
 * with optional secondary segments (Understand: Ask/Tour/Domains, Map: Graph/Layers).
 * URL params stay backward-compatible (`?tab=ask` still works).
 */

import type { ExploreTabId } from '../components/explore/ExploreStatsTypes'

export type ExplorePrimaryTabId = 'overview' | 'understand' | 'map' | 'search' | 'index'

export type ExploreUnderstandView = 'ask' | 'tour' | 'domains' | 'knowledge'
export type ExploreMapView = 'graph' | 'layers'

const UNDERSTAND_VIEWS: ExploreUnderstandView[] = ['ask', 'tour', 'domains', 'knowledge']
const MAP_VIEWS: ExploreMapView[] = ['graph', 'layers']

export function resolveExploreTab(value: string | null): ExploreTabId {
  if (
    value === 'overview' ||
    value === 'layers' ||
    value === 'search' ||
    value === 'index' ||
    value === 'ask' ||
    value === 'tour' ||
    value === 'domains' ||
    value === 'knowledge'
  ) {
    return value
  }
  return 'graph'
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
      return 'graph'
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
    description: 'Interactive graph or layer lane — click nodes for plain-English summaries.',
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
  { id: 'graph', label: 'Graph' },
  { id: 'layers', label: 'Layers' },
]
