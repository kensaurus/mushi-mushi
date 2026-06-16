/**
 * Codebase Atlas — /explore
 *
 * Tabs: Overview | Graph | Layers | Search | Index
 * Graph/Layers/Search reuse the ReactFlow canvas, Sankey lane, and semantic search.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { usePageData } from '../lib/usePageData'
import { usePageCopy } from '../lib/copy'
import { useExploreUx, resolveQuickExploreTab } from '../lib/exploreModeUx'
import { usePublishPageContext } from '../lib/pageContext'
import { useRealtimeReload } from '../lib/realtime'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useTheme } from '../lib/useTheme'
import { PageScopeHint,SnapshotSectionHint,PageHeader,
  PageHelp,
  SegmentedControl,
  ErrorAlert,
  Section,
  StatCard,
  FreshnessPill,
  Badge,
  Btn,
  Card,
  DetailRows,
  type DetailRowItem, } from '../components/ui'
import { GraphSkeleton } from '../components/skeletons/GraphSkeleton'
import { exploreGridLayout, EXPLORE_HEADER_H } from '../components/explore/exploreLayout'
import { PageHero } from '../components/PageHero'
import { ExploreCanvas } from '../components/explore/ExploreCanvas'
import { ExploreLayerLane } from '../components/explore/ExploreLayerLane'
import { ExploreSymbolPanel } from '../components/explore/ExploreSymbolPanel'
import { ExploreChatPanel } from '../components/explore/ExploreChatPanel'
import { ExploreTourPanel } from '../components/explore/ExploreTourPanel'
import { ExploreDomainsPanel } from '../components/explore/ExploreDomainsPanel'
import { ExploreImpactControl } from '../components/explore/ExploreImpactControl'
import { ExploreSearchBar } from '../components/explore/ExploreSearchBar'
import { LAYER_COLORS, LAYER_LABELS, LAYER_ORDER } from '../components/explore/exploreLayers'
import { ExploreStatusBanner } from '../components/explore/ExploreStatusBanner'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import { EmptySectionMessage } from '../components/report-detail/ReportClassification'
import {
  EMPTY_EXPLORE_STATS,
  type ExploreStats,
  type ExploreTabId,
} from '../components/explore/ExploreStatsTypes'
import type { ExploreEdge, ExploreLayer, ExploreNode, ExplorePayload, ExploreSearchHit } from '../components/explore/exploreTypes'
import type { AskSeed, CodebaseCitation, TourStop } from '../components/explore/exploreUnderstandTypes'
import {
  backendLayerDetail,
  backendLayerTooltip,
  embeddingsDetail,
  embeddingsTooltip,
  indexedFilesDetail,
  indexedFilesTooltip,
  uiLayerDetail,
  uiLayerTooltip,
} from '../lib/statTooltips/explore'
import { exploreLinks } from '../lib/statCardLinks'

type DensityMode = 'files' | 'symbols'

const EXPLORE_TABS: Array<{ id: ExploreTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Posture banner, layer breakdown, and how indexing → graph → search fit together.',
  },
  { id: 'ask', label: 'Ask', description: 'Chat with your repo — grounded answers with file:line citations.' },
  { id: 'tour', label: 'Tour', description: 'Guided onboarding walkthrough ordered by architectural dependencies.' },
  { id: 'domains', label: 'Domains', description: 'Business domains, user flows, and the files that implement each step.' },
  { id: 'graph', label: 'Graph', description: 'ReactFlow canvas — nodes coloured by architectural layer.' },
  { id: 'layers', label: 'Layers', description: 'Horizontal Sankey lane (UI → Library → Backend → …).' },
  { id: 'search', label: 'Search', description: 'Semantic search via embeddings — plain English queries.' },
  { id: 'index', label: 'Index', description: 'Indexer debug — repo, webhook, last error, embedding coverage.' },
]

function resolveExploreTab(value: string | null): ExploreTabId {
  if (
    value === 'overview' ||
    value === 'layers' ||
    value === 'search' ||
    value === 'index' ||
    value === 'ask' ||
    value === 'tour' ||
    value === 'domains'
  ) {
    return value
  }
  return 'graph'
}

function exploreErrorMessage(raw: string | null): string | null {
  if (!raw) return null
  if (raw.includes('404')) {
    return 'Codebase explorer API is unavailable. If you just deployed, wait a minute and refresh — otherwise contact support.'
  }
  return raw
}

function buildIndexRows(stats: ExploreStats): DetailRowItem[] {
  return [
    {
      label: 'Repo',
      value: stats.repoUrl ?? '—',
      mono: true,
      tone: stats.repoUrl ? 'info' : 'warn',
      copyable: !!stats.repoUrl,
    },
    {
      label: 'Index enabled',
      value: stats.codebaseIndexEnabled ? 'Yes' : 'No',
      tone: stats.codebaseIndexEnabled ? 'ok' : 'warn',
    },
    {
      label: 'Webhook secret',
      value: stats.hasWebhookSecret ? 'Configured' : 'Missing',
      tone: stats.hasWebhookSecret ? 'ok' : 'warn',
    },
    {
      label: 'Indexed files',
      value: stats.indexedFiles.toLocaleString(),
      mono: true,
      tone: stats.indexedFiles > 0 ? 'ok' : 'warn',
    },
    {
      label: 'Symbols',
      value: stats.symbolCount.toLocaleString(),
      mono: true,
      hint: 'Symbol rows when density = Symbols on Graph tab.',
    },
    {
      label: 'Embeddings',
      value: stats.withEmbeddings.toLocaleString(),
      mono: true,
      tone: stats.withEmbeddings > 0 ? 'ok' : 'warn',
      hint: 'Files with vectors for semantic search.',
    },
    {
      label: 'Last indexed',
      value: stats.lastIndexedAt ?? '—',
      mono: true,
    },
    {
      label: 'Last attempt',
      value: stats.lastIndexAttemptAt ?? '—',
      mono: true,
    },
    ...(stats.lastIndexError
      ? [
          {
            label: 'Last error',
            value: stats.lastIndexError,
            tone: 'danger' as const,
            wrap: true,
          },
        ]
      : []),
  ]
}

export function ExplorePage() {
  const copy = usePageCopy('/explore')
  const ux = useExploreUx()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlProjectId = searchParams.get('project')
  const activeProjectId = useActiveProjectId()
  const projectId = urlProjectId ?? activeProjectId ?? ''

  const tabParam = searchParams.get('tab')
  const activeTab = resolveExploreTab(tabParam)
  const activeTabMeta = EXPLORE_TABS.find((t) => t.id === activeTab) ?? EXPLORE_TABS[1]

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<ExploreStats>('/v1/admin/explore/stats')
  const stats = { ...EMPTY_EXPLORE_STATS, ...statsData }

  const { resolved: theme } = useTheme()

  const [density, setDensity] = useState<DensityMode>('files')
  const [selectedNode, setSelectedNode] = useState<ExploreNode | null>(null)
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set())
  const [activeLayerFilter, setActiveLayerFilter] = useState<ExploreLayer | null>(null)
  const [filenameFilter, setFilenameFilter] = useState('')
  const [searchSeedQuery, setSearchSeedQuery] = useState('')
  const [askSeed, setAskSeed] = useState<AskSeed | null>(null)
  const [tourStopOrder, setTourStopOrder] = useState<number | null>(null)
  const [impactActive, setImpactActive] = useState(false)
  const densityRef = useRef(density)
  densityRef.current = density

  const exploreUrl =
    projectId && stats.hasAnyProject
      ? `/v1/admin/projects/${projectId}/codebase/explore${density === 'symbols' ? '?symbols=1' : ''}`
      : null

  const exploreQuery = usePageData<ExplorePayload>(exploreUrl)
  const payload = exploreQuery.data
  const loading = exploreQuery.loading
  const error = exploreQuery.error

  const reloadAll = useCallback(() => {
    void reloadStats()
    void exploreQuery.reload()
  }, [reloadStats, exploreQuery])

  useRealtimeReload(
    ['project_codebase_files', 'project_repos', 'project_settings'],
    reloadAll,
    { enabled: !!projectId },
  )

  const setActiveTab = useCallback(
    (tab: ExploreTabId) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (tab === 'graph') next.delete('tab')
        else next.set('tab', tab)
        return next
      })
    },
    [setSearchParams],
  )

  useEffect(() => {
    if (!ux.isQuickstart || statsLoading) return
    const quickTab = resolveQuickExploreTab(stats)
    if (activeTab !== quickTab) setActiveTab(quickTab)
  }, [ux.isQuickstart, statsLoading, stats, activeTab, setActiveTab])

  const allNodes: ExploreNode[] = payload?.nodes ?? []
  const allEdges: ExploreEdge[] = payload?.edges ?? []

  const nodes = useMemo(() => {
    let result = allNodes
    if (activeLayerFilter) result = result.filter((n) => n.metadata.layer === activeLayerFilter)
    if (filenameFilter.trim()) {
      const q = filenameFilter.trim().toLowerCase()
      result = result.filter(
        (n) =>
          n.label.toLowerCase().includes(q) || n.metadata.file_path.toLowerCase().includes(q),
      )
    }
    return result
  }, [allNodes, activeLayerFilter, filenameFilter])

  const filteredNodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes])

  const edges = useMemo(() => {
    if (!activeLayerFilter && !filenameFilter.trim()) return allEdges
    return allEdges.filter(
      (e) => filteredNodeIds.has(e.source_node_id) && filteredNodeIds.has(e.target_node_id),
    )
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
      const isHighlighted =
        highlightIds.size > 0 &&
        (highlightIds.has(e.source_node_id) || highlightIds.has(e.target_node_id))
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

  const handleNodeClick = useCallback(
    (_: unknown, node: Node) => {
      if (node.id.startsWith('__hdr_')) return
      const match = allNodes.find((n) => n.id === node.id) ?? null
      setSelectedNode(match)
      setHighlightIds(new Set())
    },
    [allNodes],
  )

  const handlePaneClick = useCallback(() => {
    setSelectedNode(null)
  }, [])

  const handleSearchHighlight = useCallback((ids: Set<string>) => {
    setHighlightIds(ids)
    setSelectedNode(null)
  }, [])

  const handleSelectHit = useCallback(
    (hit: ExploreSearchHit) => {
      const match = allNodes.find((n) => n.id === hit.id) ?? null
      setSelectedNode(match)
      setHighlightIds(new Set())
    },
    [allNodes],
  )

  const handleViewInGraph = useCallback(() => {
    setActiveTab('graph')
  }, [setActiveTab])

  const handleFindSimilar = useCallback(
    (query: string) => {
      setSearchSeedQuery(query)
      setActiveTab('search')
      setSelectedNode(null)
    },
    [setActiveTab],
  )

  const handleAskAboutFile = useCallback(
    (filePath: string, symbolName: string | null) => {
      const focus = symbolName ? `symbol ${symbolName} in ` : ''
      setAskSeed({
        question: `What does ${focus}${filePath} do and what depends on it?`,
        fileFocus: { file_path: filePath, symbol_name: symbolName },
      })
      setActiveTab('ask')
    },
    [setActiveTab],
  )

  const handleCitationClick = useCallback(
    (citation: CodebaseCitation) => {
      const match =
        allNodes.find(
          (n) =>
            n.metadata.file_path === citation.file_path &&
            (citation.symbol_name == null || n.metadata.symbol_name === citation.symbol_name),
        ) ??
        allNodes.find((n) => n.metadata.file_path === citation.file_path) ??
        null
      setSelectedNode(match)
      setHighlightIds(match ? new Set([match.id]) : new Set())
      setActiveTab('graph')
    },
    [allNodes, setActiveTab],
  )

  const handleTourStop = useCallback(
    (stop: TourStop) => {
      setTourStopOrder(stop.order)
      setHighlightIds(new Set(stop.node_ids))
      setSelectedNode(null)
      setActiveTab('graph')
    },
    [setActiveTab],
  )

  const handleDomainFileClick = useCallback(
    (filePath: string) => {
      const match = allNodes.find((n) => n.metadata.file_path === filePath) ?? null
      setSelectedNode(match)
      setHighlightIds(match ? new Set([match.id]) : new Set())
      setActiveTab('graph')
    },
    [allNodes, setActiveTab],
  )

  const handleImpact = useCallback((nodeIds: Set<string>) => {
    setHighlightIds(nodeIds)
    setImpactActive(nodeIds.size > 0)
    setSelectedNode(null)
  }, [])

  const clearImpact = useCallback(() => {
    setHighlightIds(new Set())
    setImpactActive(false)
  }, [])

  const toggleLayerFilter = useCallback((layer: ExploreLayer) => {
    setActiveLayerFilter((prev) => (prev === layer ? null : layer))
    setSelectedNode(null)
    setHighlightIds(new Set())
  }, [])

  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'neutral' =
    !stats.hasAnyProject
      ? 'neutral'
      : stats.topPriority === 'error'
        ? 'danger'
        : stats.topPriority === 'empty' || stats.topPriority === 'stale'
          ? 'warn'
          : stats.topPriority === 'not_enabled' || stats.topPriority === 'indexing'
            ? 'brand'
            : stats.topPriority === 'ready'
              ? 'ok'
              : 'info'

  const tabOptions = useMemo(
    () =>
      EXPLORE_TABS.map((t) => ({
        id: t.id,
        label: copy?.tabLabels?.[t.id] ?? t.label,
        count:
          t.id === 'graph' && stats.indexedFiles > 0
            ? stats.indexedFiles
            : t.id === 'search' && stats.withEmbeddings > 0
              ? stats.withEmbeddings
              : undefined,
      })),
    [copy?.tabLabels, stats.indexedFiles, stats.withEmbeddings],
  )

  usePublishPageContext({
    route: '/explore',
    title: 'Codebase atlas',
    summary: `${activeTabMeta.label} · ${stats.indexedFiles} files · ${stats.withEmbeddings} embedded`,
    filters: { tab: activeTab, density },
    criticalCount: stats.topPriority === 'error' ? 1 : 0,
    questions: [
      'How does auth work in this repo?',
      'Which files would break if I changed the API layer?',
      'Walk me through the main user flows.',
    ],
    actions: [
      { id: 'explore-refresh', label: 'Refresh atlas', hint: 'Re-fetch stats + graph', run: reloadAll },
      { id: 'explore-ask', label: 'Ask about codebase', hint: 'Open Ask tab', run: () => setActiveTab('ask') },
      { id: 'explore-tour', label: 'Start codebase tour', hint: 'Guided walkthrough', run: () => setActiveTab('tour') },
      { id: 'explore-connect', label: 'Install / update SDK', hint: 'Connect & Update hub', run: () => navigate('/connect') },
    ],
  })

  if (statsLoading && !statsData) {
    return (
      <div className="space-y-4 animate-pulse" aria-hidden role="status" aria-label="Loading explore">
        <div className="h-8 w-48 rounded bg-surface-raised" />
        <div className="h-16 rounded bg-surface-raised/60" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded bg-surface-raised/40" />
          ))}
        </div>
      </div>
    )
  }

  if (statsError) {
    return <ErrorAlert message={`Failed to load explore stats: ${statsError}`} onRetry={reloadStats} />
  }

  if (!projectId) {
    return (
      <div className="space-y-4">
        <PageHeader title={copy?.title ?? 'Explore'} />
        <ExploreStatusBanner stats={stats} onTab={setActiveTab} />
        <EmptySectionMessage
          text="No project selected"
          hint="Select a project from the top bar to explore its codebase."
        />
      </div>
    )
  }

  const notIndexed =
    stats.topPriority === 'empty' ||
    stats.topPriority === 'not_enabled' ||
    (!loading && !error && allNodes.length === 0 && stats.indexedFiles === 0)

  const layerEntries = payload
    ? LAYER_ORDER.filter((l) => (payload.layers[l] ?? 0) > 0).map(
        (l) => [l, payload.layers[l]] as [ExploreLayer, number],
      )
    : LAYER_ORDER.filter((l) => (stats.layers?.[l] ?? 0) > 0).map(
        (l) => [l, stats.layers?.[l] ?? 0] as [ExploreLayer, number],
      )

  const mapControls =
    activeTab === 'graph' || activeTab === 'layers' ? (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <SegmentedControl
              value={density}
              onChange={(v) => setDensity(v as DensityMode)}
              options={[
                { id: 'files', label: 'Files' },
                { id: 'symbols', label: 'Symbols' },
              ]}
            />
            {(loading || exploreQuery.isValidating) && (
              <SignalChip tone="info" className="animate-pulse font-normal">
                Loading…
              </SignalChip>
            )}
          </div>
          <InlineProof className="font-mono tabular-nums border-0 bg-transparent px-0 py-0">
            {nodes.length}/{allNodes.length} nodes · {edges.length}/{allEdges.length} edges
          </InlineProof>
        </div>

        {layerEntries.length > 0 && !loading && (
          <div className="flex items-center gap-2 flex-wrap">
            <SignalChip tone="neutral" className="uppercase tracking-wider shrink-0">
              Filter
            </SignalChip>
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
              <ActionPill tone="neutral" onClick={() => setActiveLayerFilter(null)} className="rounded-full">
                Clear filter
              </ActionPill>
            )}
            <div className="relative ml-auto">
              <input
                type="text"
                value={filenameFilter}
                onChange={(e) => setFilenameFilter(e.target.value)}
                placeholder="Filter by filename…"
                className="text-3xs pl-3 pr-6 py-1 rounded-full border border-edge-subtle bg-surface-raised text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-brand/40 focus:border-brand/40 w-44"
                aria-label="Filter files by name"
              />
              {filenameFilter && (
                <button
                  type="button"
                  onClick={() => setFilenameFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-faint hover:text-fg"
                  aria-label="Clear filename filter"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        )}

        {projectId && stats.codebaseIndexEnabled && (
          <ExploreImpactControl
            projectId={projectId}
            active={impactActive}
            onImpact={(ids) => handleImpact(ids)}
            onClear={clearImpact}
          />
        )}
      </div>
    ) : null

  const mapContent = loading ? (
    <GraphSkeleton />
  ) : error ? (
    <ErrorAlert message={exploreErrorMessage(error) ?? error} onRetry={reloadAll} />
  ) : notIndexed ? (
    <div className="space-y-3">
      <EmptySectionMessage
        text="Codebase not indexed yet"
        hint="Enable codebase indexing in Settings → Codebase Indexing or run mushi index in your project directory."
      />
      <ActionPillRow className="justify-center">
        <ActionPill tone="brand" onClick={() => setActiveTab('index')}>
          Open Index tab
        </ActionPill>
        <ActionPill to="/connect">Connect &amp; index</ActionPill>
        <ActionPill to="/settings">Settings</ActionPill>
      </ActionPillRow>
    </div>
  ) : activeTab === 'graph' ? (
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
          projectId={projectId}
          onClear={() => setSelectedNode(null)}
          onViewInGraph={handleViewInGraph}
          onFindSimilar={handleFindSimilar}
          onAskAboutFile={handleAskAboutFile}
        />
      )}
    </div>
  ) : activeTab === 'layers' ? (
    <div className="space-y-3">
      <ExploreLayerLane
        nodes={nodes}
        edges={edges}
        selectedId={selectedNode?.id ?? null}
        highlightIds={highlightIds}
        onSelect={(n) => {
          setSelectedNode(n)
          setHighlightIds(new Set())
        }}
        onClear={() => setSelectedNode(null)}
      />
      {selectedNode && (
        <ExploreSymbolPanel
          node={selectedNode}
          projectId={projectId}
          onClear={() => setSelectedNode(null)}
          onViewInGraph={handleViewInGraph}
          onFindSimilar={handleFindSimilar}
          onAskAboutFile={handleAskAboutFile}
        />
      )}
    </div>
  ) : null

  return (
    <div className="space-y-4" data-testid="mushi-page-explore">
      <PageHelp
        title={copy?.help?.title ?? 'Codebase Atlas'}
        whatIsIt={
          copy?.help?.whatIsIt ??
          'Visual map of indexed source files grouped by architectural layer.'
        }
        useCases={
          copy?.help?.useCases ?? [
            'See which layer a bug report file lives in',
            'Trace import dependencies between files',
            'Search "where is login?" and jump to the right symbol',
          ]
        }
        howToUse={
          copy?.help?.howToUse ??
          'Overview for posture. Graph/Layers for the map. Search for plain-English lookup. Index tab when debugging sweeper errors.'
        }
      />

      <PageHeader
        title={copy?.title ?? 'Explore'}
        projectScope={stats.projectName ?? undefined}
      >
        {!ux.hideOverviewChrome && (
          <>
            <Badge
              className={
                bannerSeverity === 'ok'
                  ? 'bg-ok-muted text-ok'
                  : bannerSeverity === 'danger'
                    ? 'bg-danger-muted/50 text-danger-foreground'
                    : bannerSeverity === 'warn'
                      ? 'bg-warn-muted/50 text-warning-foreground'
                      : bannerSeverity === 'brand'
                        ? 'bg-brand/15 text-brand'
                        : 'bg-surface-overlay text-fg-muted'
              }
            >
              {!stats.hasAnyProject
                ? 'NO PROJECT'
                : stats.topPriority === 'error'
                  ? 'ERROR'
                  : stats.topPriority === 'indexing'
                    ? 'INDEXING'
                    : stats.topPriority === 'empty' || stats.topPriority === 'not_enabled'
                      ? 'EMPTY'
                      : stats.topPriority === 'stale'
                        ? 'STALE'
                        : 'READY'}
            </Badge>
            <FreshnessPill
              at={statsFetchedAt ?? exploreQuery.lastFetchedAt}
              isValidating={statsValidating || exploreQuery.isValidating}
            />
            <Btn size="sm" variant="ghost" onClick={reloadAll} loading={statsValidating || loading}>
              Refresh
            </Btn>
          </>
        )}
      </PageHeader>
      <PageScopeHint text={copy?.description ?? "Banner + EXPLORE SNAPSHOT — Overview for posture, Graph/Layers/Search for the atlas."} />

      <ExploreStatusBanner
        stats={stats}
        onTab={setActiveTab}
        onRefresh={reloadAll}
        refreshing={statsValidating || loading}
        plainBanner={ux.plainBanner}
      />

      {!ux.hideTabs && (
      <SegmentedControl<ExploreTabId>
        size="sm"
        ariaLabel="Explore sections"
        value={activeTab}
        options={tabOptions}
        onChange={setActiveTab}
      />
      )}

      {!ux.hideExploreSnapshot && (
      <Section
        title={copy?.sections?.snapshot ?? 'EXPLORE SNAPSHOT'}
        freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      >
        <SnapshotSectionHint text={activeTabMeta.description} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label={copy?.statLabels?.files ?? 'Files'}
            value={stats.indexedFiles}
            accent={stats.indexedFiles > 0 ? 'text-fg' : undefined}
            tooltip={indexedFilesTooltip(stats)}
            detail={indexedFilesDetail(stats)}
            to={exploreLinks.files}
          />
          <StatCard
            label={copy?.statLabels?.uiLayer ?? 'UI layer'}
            value={stats.layers?.ui ?? 0}
            accent={stats.layers.ui > 0 ? 'text-brand' : undefined}
            tooltip={uiLayerTooltip(stats)}
            detail={uiLayerDetail()}
            to={exploreLinks.uiLayer}
          />
          <StatCard
            label={copy?.statLabels?.backend ?? 'Backend'}
            value={stats.layers?.backend ?? 0}
            accent={stats.layers.backend > 0 ? 'text-info' : undefined}
            tooltip={backendLayerTooltip(stats)}
            detail={backendLayerDetail()}
            to={exploreLinks.backend}
          />
          <StatCard
            label={copy?.statLabels?.embedded ?? 'Embedded'}
            value={stats.withEmbeddings}
            accent={stats.withEmbeddings > 0 ? 'text-ok' : 'text-warn'}
            tooltip={embeddingsTooltip(stats)}
            detail={embeddingsDetail()}
            to={exploreLinks.embedded}
          />
        </div>
      </Section>
      )}

      {activeTab === 'overview' && (
        <>
          {!ux.hideOverviewChrome && (
          <>
          <PageHero
            scope="explore"
            title="Codebase Atlas"
            kicker="Plan"
            decide={{
              label: stats.topPriorityLabel ?? 'Indexed codebase map',
              metric:
                stats.indexedFiles > 0
                  ? `${stats.layers?.ui ?? 0} UI · ${stats.layers?.backend ?? 0} backend`
                  : undefined,
              summary:
                stats.topPriority === 'not_enabled'
                  ? 'Brand banner — turn on indexing before the graph can populate.'
                  : stats.topPriority === 'error'
                    ? 'Red banner — last indexer run failed; check Index tab for the error.'
                    : stats.topPriority === 'ready'
                      ? 'Green banner — open Graph to trace imports or Search for plain-English lookup.'
                      : 'Amber banner — indexing may still be running or the repo is empty.',
              severity:
                stats.topPriority === 'error'
                  ? 'crit'
                  : stats.topPriority === 'empty' || stats.topPriority === 'stale'
                    ? 'warn'
                    : stats.topPriority === 'ready'
                      ? 'ok'
                      : 'info',
            }}
            verify={{
              label: 'Embeddings',
              detail: `${stats.withEmbeddings}/${stats.indexedFiles} files embedded for search`,
            }}
          />

          {stats.topPriorityTo && stats.topPriority !== 'ready' ? (
            <Card
              className={`p-4 ${
                stats.topPriority === 'error'
                  ? 'border-danger/30 bg-danger/5'
                  : stats.topPriority === 'empty' || stats.topPriority === 'stale'
                    ? 'border-warn/30 bg-warn/5'
                    : 'border-brand/30 bg-brand/5'
              }`}
            >
              <p className="text-3xs font-semibold uppercase tracking-wider text-fg-muted">Top priority</p>
              <p className="mt-1 text-sm font-medium text-fg">{stats.topPriorityLabel}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to={stats.topPriorityTo}>
                  <Btn size="sm" variant="primary">Take action →</Btn>
                </Link>
                <Btn size="sm" variant="ghost" onClick={() => setActiveTab('index')}>
                  Index debug
                </Btn>
              </div>
            </Card>
          ) : null}

          {stats.topPriority === 'ready' && stats.indexedFiles > 0 && (
            <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-fg">New teammate?</p>
                <p className="text-xs text-fg-muted mt-0.5">
                  Start the guided tour or ask plain-English questions about the repo.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Btn size="sm" variant="primary" onClick={() => setActiveTab('tour')}>
                  Start tour
                </Btn>
                <Btn size="sm" variant="ghost" onClick={() => setActiveTab('ask')}>
                  Ask a question
                </Btn>
              </div>
            </Card>
          )}

          {stats.topLanguages?.length > 0 && (
            <Card className="p-4">
              <p className="text-2xs font-medium text-fg-muted uppercase tracking-wider mb-2">Top languages</p>
              <div className="flex flex-wrap gap-2">
                {stats.topLanguages.map((lang) => (
                  <Badge key={lang} className="bg-surface-overlay text-fg-secondary">
                    {lang}
                  </Badge>
                ))}
              </div>
            </Card>
          )}
          </>
          )}
        </>
      )}

      {(activeTab === 'graph' || activeTab === 'layers') && (
        <>
          {mapControls}
          {mapContent}
        </>
      )}

      {activeTab === 'ask' && (
        <ExploreChatPanel
          projectId={projectId}
          seed={askSeed}
          onSeedConsumed={() => setAskSeed(null)}
          onCitationClick={handleCitationClick}
        />
      )}

      {activeTab === 'tour' && (
        <ExploreTourPanel
          projectId={projectId}
          activeStopOrder={tourStopOrder}
          onSelectStop={handleTourStop}
          onStartTour={() => setActiveTab('graph')}
        />
      )}

      {activeTab === 'domains' && (
        <ExploreDomainsPanel projectId={projectId} onFileClick={handleDomainFileClick} />
      )}

      {activeTab === 'search' && (
        <div className={selectedNode ? 'grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-4 items-start' : ''}>
          {stats.withEmbeddings === 0 && !loading && (
            <ContainedBlock tone="warn" className="mb-2">
              <p className="text-2xs text-warn">
                No embeddings yet — semantic search needs indexed files with vectors. Check Index tab.
              </p>
            </ContainedBlock>
          )}
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
                projectId={projectId}
                onClear={() => setSelectedNode(null)}
                onViewInGraph={handleViewInGraph}
                onFindSimilar={handleFindSimilar}
                onAskAboutFile={handleAskAboutFile}
              />
            </div>
          )}
        </div>
      )}

      {activeTab === 'index' && (
        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <p className="text-sm font-medium text-fg">Indexer debug</p>
            <ContainedBlock tone="muted">
              <p className="text-2xs text-fg-muted">
                Live state from <code className="font-mono">project_repos</code> and{' '}
                <code className="font-mono">project_codebase_files</code>. Use this when the banner
                shows ERROR or INDEXING.
              </p>
            </ContainedBlock>
            <DetailRows items={buildIndexRows(stats)} />
          </Card>
          <div className="flex flex-wrap gap-2">
            <Link to="/settings">
              <Btn size="sm">Open indexing settings</Btn>
            </Link>
            <Btn size="sm" variant="ghost" onClick={reloadAll} loading={statsValidating}>
              Re-fetch stats
            </Btn>
            {stats.indexedFiles > 0 && (
              <Btn size="sm" variant="ghost" onClick={() => setActiveTab('graph')}>
                Open Graph
              </Btn>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
