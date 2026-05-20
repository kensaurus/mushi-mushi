/**
 * Codebase Atlas — /explore
 *
 * Three views:
 *   Graph  — ReactFlow canvas, nodes coloured by architectural layer
 *   Layers — horizontal Sankey lane (UI → Library → Backend → …)
 *   Search — semantic search via /codebase/search embedding RPC
 *
 * A fourth "layer filter" lets the user narrow any view to a single
 * architectural layer (clicking the pill again deselects).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { usePageData } from '../lib/usePageData'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useTheme } from '../lib/useTheme'
import {
  PageHeader,
  PageHelp,
  SegmentedControl,
  ErrorAlert,
} from '../components/ui'
import { GraphSkeleton } from '../components/skeletons/GraphSkeleton'
import { exploreGridLayout, EXPLORE_HEADER_H } from '../components/explore/exploreLayout'

import { ExploreCanvas } from '../components/explore/ExploreCanvas'
import { ExploreLayerLane } from '../components/explore/ExploreLayerLane'
import { ExploreSymbolPanel } from '../components/explore/ExploreSymbolPanel'
import { ExploreSearchBar } from '../components/explore/ExploreSearchBar'
import { LAYER_COLORS, LAYER_LABELS, LAYER_ORDER } from '../components/explore/exploreLayers'
import type { ExploreEdge, ExploreLayer, ExploreNode, ExplorePayload, ExploreSearchHit } from '../components/explore/exploreTypes'

type ViewMode = 'graph' | 'layers' | 'search'
type DensityMode = 'files' | 'symbols'

/** Top-level language stats derived from file extensions */
function detectLanguages(nodes: ExploreNode[]): string[] {
  const counts = new Map<string, number>()
  for (const n of nodes) {
    if (n.metadata.language) {
      counts.set(n.metadata.language, (counts.get(n.metadata.language) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([lang]) => lang)
}

export function ExplorePage() {
  const [searchParams] = useSearchParams()
  const urlProjectId = searchParams.get('project')
  const activeProjectId = useActiveProjectId()
  // Prefer the URL param so a direct link to a non-active project works.
  // Fall back to the active project for the common case.
  const projectId = urlProjectId ?? activeProjectId ?? ''
  // Derive indexedFileCount from the resolved projectId's setup state, not
  // unconditionally from activeProjectId, so the "not indexed" empty state
  // is accurate when viewing a non-active project via URL param.
  const setup = useSetupStatus(projectId || activeProjectId)
  const indexedFileCount = (setup.activeProject as Record<string, unknown> | null)?.indexed_file_count as number | undefined

  const { resolved: theme } = useTheme()

  const [view, setView] = useState<ViewMode>('graph')
  const [density, setDensity] = useState<DensityMode>('files')
  const [selectedNode, setSelectedNode] = useState<ExploreNode | null>(null)
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set())
  const [activeLayerFilter, setActiveLayerFilter] = useState<ExploreLayer | null>(null)
  const [filenameFilter, setFilenameFilter] = useState('')
  const densityRef = useRef(density)
  densityRef.current = density

  const exploreUrl = projectId
    ? `/v1/admin/projects/${projectId}/codebase/explore${density === 'symbols' ? '?symbols=1' : ''}`
    : null

  const exploreQuery = usePageData<ExplorePayload>(exploreUrl)
  const payload = exploreQuery.data
  const loading = exploreQuery.loading
  const error = exploreQuery.error

  // Reload when density or project changes
  const reloadRef = useRef(exploreQuery.reload)
  reloadRef.current = exploreQuery.reload
  useEffect(() => {
    if (projectId) reloadRef.current()
  }, [density, projectId])

  const allNodes: ExploreNode[] = payload?.nodes ?? []
  const allEdges: ExploreEdge[] = payload?.edges ?? []

  // Apply layer filter + optional filename quick-filter
  const nodes = useMemo(() => {
    let result = allNodes
    if (activeLayerFilter) result = result.filter((n) => n.metadata.layer === activeLayerFilter)
    if (filenameFilter.trim()) {
      const q = filenameFilter.trim().toLowerCase()
      result = result.filter((n) =>
        n.label.toLowerCase().includes(q) || n.metadata.file_path.toLowerCase().includes(q),
      )
    }
    return result
  }, [allNodes, activeLayerFilter, filenameFilter])

  const filteredNodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes])

  const edges = useMemo(() => {
    if (!activeLayerFilter && !filenameFilter.trim()) return allEdges
    return allEdges.filter((e) => filteredNodeIds.has(e.source_node_id) && filteredNodeIds.has(e.target_node_id))
  }, [allEdges, activeLayerFilter, filenameFilter, filteredNodeIds])

  const positions = useMemo(() => exploreGridLayout(nodes), [nodes])

  const flowNodes: Node[] = useMemo(() => {
    return nodes.map((n) => {
      const pos = positions.get(n.id) ?? { x: 0, y: 0 }
      const isSelected = selectedNode?.id === n.id
      const isDimmed = highlightIds.size > 0 && !highlightIds.has(n.id)
      return {
        id: n.id,
        position: pos,
        data: { node: n, isSelected, isDimmed, theme },
        type: 'default',
        label: n.label,
        style: { background: 'transparent', border: 'none', padding: 0, width: 'auto' },
      } as unknown as Node
    })
  }, [nodes, positions, selectedNode, highlightIds, theme])

  /** Floating layer-column header nodes rendered above each swimlane */
  const layerHeaderNodes: Node[] = useMemo(() => {
    const headers: Node[] = []
    for (const layer of LAYER_ORDER) {
      const layerNodes = nodes.filter((n) => (n.metadata.layer as string) === layer)
      if (!layerNodes.length) continue
      const layerPositions = layerNodes
        .map((n) => positions.get(n.id))
        .filter((p): p is { x: number; y: number } => !!p)
      if (!layerPositions.length) continue
      const minX = Math.min(...layerPositions.map((p) => p.x))
      const maxX = Math.max(...layerPositions.map((p) => p.x))
      const minY = Math.min(...layerPositions.map((p) => p.y))
      const centerX = (minX + maxX) / 2
      headers.push({
        id: `__hdr_${layer}`,
        position: { x: centerX - 55, y: minY - EXPLORE_HEADER_H },
        data: {
          label: LAYER_LABELS[layer],
          count: layerNodes.length,
          color: LAYER_COLORS[layer],
          layer,
        },
        type: 'layerHeader',
        selectable: false,
        draggable: false,
        style: { background: 'transparent', border: 'none', padding: 0 },
      } as unknown as Node)
    }
    return headers
  }, [nodes, positions])

  const nodeLayerMap = useMemo(() => {
    const m = new Map<string, ExploreLayer>()
    for (const n of nodes) m.set(n.id, (n.metadata.layer as ExploreLayer) ?? 'other')
    return m
  }, [nodes])

  const flowEdges: Edge[] = useMemo(() => {
    return edges.map((e) => {
      const srcLayer = nodeLayerMap.get(e.source_node_id) ?? 'other'
      const color = LAYER_COLORS[srcLayer] ?? LAYER_COLORS.other
      const isHighlighted = highlightIds.size > 0 && (
        highlightIds.has(e.source_node_id) || highlightIds.has(e.target_node_id)
      )
      const opacity = highlightIds.size > 0 ? (isHighlighted ? 0.85 : 0.05) : 0.35
      return {
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        markerEnd: { type: 'arrowclosed', width: 7, height: 7, color },
        style: {
          stroke: color,
          strokeWidth: isHighlighted ? 1.8 : 1,
          opacity,
        },
      } as Edge
    })
  }, [edges, highlightIds, nodeLayerMap])

  const handleNodeClick = useCallback((_: unknown, node: Node) => {
    if (node.id.startsWith('__hdr_')) return // layer header — not selectable
    const match = allNodes.find((n) => n.id === node.id) ?? null
    setSelectedNode(match)
    setHighlightIds(new Set())
  }, [allNodes])

  const handlePaneClick = useCallback(() => {
    setSelectedNode(null)
  }, [])

  const handleSearchHighlight = useCallback((ids: Set<string>) => {
    setHighlightIds(ids)
    setSelectedNode(null)
  }, [])

  const handleSelectHit = useCallback((hit: ExploreSearchHit) => {
    // Show the symbol panel within Search tab; user can click "View in graph" to navigate
    const match = allNodes.find((n) => n.id === hit.id) ?? null
    setSelectedNode(match)
    setHighlightIds(new Set())
  }, [allNodes])

  const handleViewInGraph = useCallback(() => {
    setView('graph')
  }, [])

  const [searchSeedQuery, setSearchSeedQuery] = useState('')

  const handleFindSimilar = useCallback((query: string) => {
    setSearchSeedQuery(query)
    setView('search')
    setSelectedNode(null)
  }, [])

  const toggleLayerFilter = useCallback((layer: ExploreLayer) => {
    setActiveLayerFilter((prev) => (prev === layer ? null : layer))
    setSelectedNode(null)
    setHighlightIds(new Set())
  }, [])

  // Hooks must be called unconditionally (before any early return).
  const languages = useMemo(() => detectLanguages(allNodes), [allNodes])

  // ── Empty state: no project ────────────────────────────────────────────────
  if (!projectId) {
    return (
      <div className="p-6 space-y-4">
        <PageHeader title="Explore" />
        <div className="rounded-md border border-edge bg-surface-raised p-8 text-center space-y-2">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto text-fg-faint mb-2" aria-hidden="true">
            <circle cx="8" cy="16" r="3" />
            <circle cx="24" cy="8" r="3" />
            <circle cx="24" cy="24" r="3" />
            <path d="M11 15l10-5M11 17l10 5" />
          </svg>
          <div className="text-sm font-medium text-fg">No project selected</div>
          <div className="text-2xs text-fg-muted">Select a project from the top bar to explore its codebase.</div>
        </div>
      </div>
    )
  }

  const notIndexed = !loading && !error && allNodes.length === 0 && indexedFileCount === 0
  const layerEntries = payload
    ? LAYER_ORDER.filter((l) => (payload.layers[l] ?? 0) > 0).map((l) => [l, payload.layers[l]] as [ExploreLayer, number])
    : []

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Explore" />

      <PageHelp
        title="Codebase Atlas"
        whatIsIt="Visual map of indexed source files grouped by architectural layer — UI, Library, Backend, Tests, Config."
        useCases={[
          'See which files live in which layer',
          'Trace import dependencies between files',
          'Semantic search: describe what you need in plain English',
          'Click a file to inspect its path, language, line count, and content preview',
        ]}
        howToUse="Switch between Graph (node graph), Layers (Sankey flow), and Search tabs. Click any node or row for full details. Use the layer filter chips to narrow the view."
      />

      {/* Stats bar */}
      {payload && !loading && (
        <div className="flex items-center gap-3 flex-wrap px-3 py-2 rounded-md border border-edge-subtle bg-surface-raised text-2xs text-fg-secondary">
          <span className="tabular-nums font-medium text-fg">
            {payload.total_files.toLocaleString()} files
          </span>
          {allEdges.length > 0 && (
            <>
              <span className="text-fg-faint/50">·</span>
              <span className="tabular-nums">{allEdges.length.toLocaleString()} import edges</span>
            </>
          )}
          {languages.length > 0 && (
            <>
              <span className="text-fg-faint/50">·</span>
              <span>{languages.join(', ')}</span>
            </>
          )}
          <span className="ml-auto text-fg-faint text-3xs">
            Indexed via Mushi SDK
          </span>
        </div>
      )}

      {/* View + density + layer filter controls */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <SegmentedControl
            value={view}
            onChange={(v) => setView(v as ViewMode)}
            options={[
              { id: 'graph', label: 'Graph' },
              { id: 'layers', label: 'Layers' },
              { id: 'search', label: 'Search' },
            ]}
          />
          <div className="flex items-center gap-2">
            {view !== 'search' && (
              <SegmentedControl
                value={density}
                onChange={(v) => setDensity(v as DensityMode)}
                options={[
                  { id: 'files', label: 'Files' },
                  { id: 'symbols', label: 'Symbols' },
                ]}
              />
            )}
            {(loading || exploreQuery.isValidating) && (
              <span className="text-2xs text-fg-faint animate-pulse">Loading…</span>
            )}
          </div>
        </div>

        {/* Layer filter chips + filename quick-filter */}
        {layerEntries.length > 0 && !loading && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-3xs text-fg-faint uppercase tracking-wider shrink-0">Filter:</span>
            {layerEntries.map(([layer, count]) => {
              const active = activeLayerFilter === layer
              return (
                <button
                  key={layer}
                  type="button"
                  onClick={() => toggleLayerFilter(layer)}
                  className={[
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-3xs border transition-all',
                    active ? 'font-semibold shadow-sm' : 'hover:border-current',
                  ].join(' ')}
                  style={{
                    backgroundColor: active ? `${LAYER_COLORS[layer]}22` : `${LAYER_COLORS[layer]}0d`,
                    borderColor: active ? LAYER_COLORS[layer] : `${LAYER_COLORS[layer]}35`,
                    color: LAYER_COLORS[layer],
                  }}
                  aria-pressed={active}
                >
                  <span className="font-mono">{count}</span>
                  <span>{LAYER_LABELS[layer]}</span>
                </button>
              )
            })}
            {activeLayerFilter && (
              <button
                type="button"
                onClick={() => setActiveLayerFilter(null)}
                className="text-3xs text-fg-faint hover:text-fg px-1.5 py-0.5 border border-edge-subtle rounded-full hover:border-edge transition-colors"
              >
                Clear
              </button>
            )}

            {/* Filename quick-filter — only shown on graph/layers views */}
            {view !== 'search' && (
              <div className="relative ml-auto">
                <svg
                  width="11" height="11" viewBox="0 0 16 16" fill="none"
                  stroke="currentColor" strokeWidth="1.5"
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-faint pointer-events-none"
                  aria-hidden="true"
                >
                  <circle cx="6.5" cy="6.5" r="4" />
                  <path d="M10.5 10.5L14 14" strokeLinecap="round" />
                </svg>
                <input
                  type="text"
                  value={filenameFilter}
                  onChange={(e) => setFilenameFilter(e.target.value)}
                  placeholder="Filter by filename…"
                  className="text-3xs pl-6 pr-6 py-1 rounded-full border border-edge-subtle bg-surface-raised text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-brand/40 focus:border-brand/40 w-44"
                  aria-label="Filter files by name"
                />
                {filenameFilter && (
                  <button
                    type="button"
                    onClick={() => setFilenameFilter('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-faint hover:text-fg"
                    aria-label="Clear filename filter"
                  >
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                      <path d="M2 2l6 6M8 2l-6 6" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {error && <ErrorAlert message={error} />}

      {/* Not indexed CTA */}
      {notIndexed && (
        <div className="rounded-md border border-edge bg-surface-raised p-8 text-center space-y-3">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.4" className="mx-auto text-fg-faint" aria-hidden="true">
            <rect x="6" y="8" width="28" height="24" rx="2" />
            <path d="M14 16h12M14 20h8M14 24h6" strokeLinecap="round" />
            <path d="M28 26l5 5" strokeLinecap="round" />
            <circle cx="28" cy="24" r="4" />
          </svg>
          <div className="text-sm font-medium text-fg">Codebase not indexed yet</div>
          <div className="text-2xs text-fg-muted max-w-md mx-auto">
            Enable codebase indexing in{' '}
            <a href="/settings" className="text-brand hover:underline">Settings → Codebase Indexing</a>
            {' '}or run{' '}
            <code className="text-2xs font-mono bg-surface-overlay px-1 rounded">mushi index</code>
            {' '}in your project directory.
          </div>
        </div>
      )}

      {/* Skeleton while initial load */}
      {loading && <GraphSkeleton />}

      {/* Main views */}
      {!loading && !notIndexed && (
        <>
          {view === 'graph' && (
            <div className="space-y-3">
              <ExploreCanvas
                flowNodes={[...layerHeaderNodes, ...flowNodes]}
                flowEdges={flowEdges}
                nodeCount={nodes.length}
                edgeCount={edges.length}
                onNodeClick={handleNodeClick}
                onPaneClick={handlePaneClick}
                layerCounts={payload?.layers}
              />
              {selectedNode && (
                <ExploreSymbolPanel
                  node={selectedNode}
                  onClear={() => setSelectedNode(null)}
                  onViewInGraph={handleViewInGraph}
                  onFindSimilar={handleFindSimilar}
                />
              )}
            </div>
          )}

          {view === 'layers' && (
            <div className="space-y-3">
              <ExploreLayerLane
                nodes={nodes}
                edges={edges}
                selectedId={selectedNode?.id ?? null}
                highlightIds={highlightIds}
                onSelect={(n) => { setSelectedNode(n); setHighlightIds(new Set()) }}
                onClear={() => setSelectedNode(null)}
              />
              {selectedNode && (
                <ExploreSymbolPanel
                  node={selectedNode}
                  onClear={() => setSelectedNode(null)}
                  onViewInGraph={handleViewInGraph}
                  onFindSimilar={handleFindSimilar}
                />
              )}
            </div>
          )}

          {view === 'search' && (
            <div className={selectedNode ? 'grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-4 items-start' : ''}>
              <ExploreSearchBar
                projectId={projectId}
                onHighlight={handleSearchHighlight}
                onSelectHit={handleSelectHit}
                seedQuery={searchSeedQuery}
                onSeedConsumed={() => setSearchSeedQuery('')}
              />
              {selectedNode && (
                <div className="sticky top-4">
                  <ExploreSymbolPanel
                    node={selectedNode}
                    onClear={() => setSelectedNode(null)}
                    onViewInGraph={handleViewInGraph}
                    onFindSimilar={handleFindSimilar}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
