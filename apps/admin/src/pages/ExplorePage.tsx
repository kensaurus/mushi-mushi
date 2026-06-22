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
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { usePageCopy } from '../lib/copy'
import { useExploreUx, resolveBeginnerExploreTab, resolveQuickExploreTab } from '../lib/exploreModeUx'
import {
  resolveExploreTab,
  primaryTabOf,
  defaultTabForPrimary,
  EXPLORE_PRIMARY_TABS,
  EXPLORE_UNDERSTAND_VIEWS,
  EXPLORE_MAP_VIEWS,
  isUnderstandView,
  isMapView,
  type ExplorePrimaryTabId,
  type ExploreUnderstandView,
  type ExploreMapView,
} from '../lib/exploreTabNavigation'
import { usePublishPageContext } from '../lib/pageContext'
import { useRealtimeReload } from '../lib/realtime'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useTheme } from '../lib/useTheme'
import { SnapshotSectionHint,
  SegmentedControl,
  ErrorAlert,
  Section,
  StatCard,
  StatGrid,
  FreshnessPill,
  Badge,
  Btn,
  Card,
  DetailRows,
  type DetailRowItem, } from '../components/ui'
import { GraphSkeleton } from '../components/skeletons/GraphSkeleton'
import { exploreGridLayout, EXPLORE_HEADER_H } from '../components/explore/exploreLayout'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { shouldHideGuideWhenBannerActive, COMMON_HEALTHY_PRIORITIES } from '../lib/pagePostureHelpers'
import { PageHero } from '../components/PageHero'
import type { PageAction } from '../components/PageActionBar'
import { ExploreCanvas } from '../components/explore/ExploreCanvas'
import { ExploreLayerLane } from '../components/explore/ExploreLayerLane'
import { ExploreSymbolPanel } from '../components/explore/ExploreSymbolPanel'
import { ExploreChatPanel } from '../components/explore/ExploreChatPanel'
import { ExploreTourPanel } from '../components/explore/ExploreTourPanel'
import { ExploreDomainsPanel } from '../components/explore/ExploreDomainsPanel'
import { ExploreKnowledgePanel } from '../components/explore/ExploreKnowledgePanel'
import { ExploreIndexScopePanel } from '../components/explore/ExploreIndexScopePanel'
import { ExploreWorkspaceReadout } from '../components/explore/ExploreWorkspaceReadout'
import { ExploreImpactControl } from '../components/explore/ExploreImpactControl'
import { ExploreUnderstandEmpty } from '../components/explore/ExploreUnderstandEmpty'
import { ExploreSearchBar } from '../components/explore/ExploreSearchBar'
import { LAYER_COLORS, LAYER_LABELS, LAYER_ORDER } from '../components/explore/exploreLayers'
import { ExploreStatusBanner } from '../components/explore/ExploreStatusBanner'
import { ExploreAtlasGuide } from '../components/explore/ExploreAtlasGuide'
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

const EXPLORE_TAB_META: Record<ExploreTabId, { label: string; description: string }> = {
  overview: {
    label: 'Summary',
    description: 'Posture banner, layer breakdown, and how indexing → map → search fit together.',
  },
  ask: { label: 'Ask', description: 'Chat with your repo — grounded answers with file:line citations.' },
  tour: { label: 'Tour', description: 'Guided onboarding walkthrough ordered by architectural dependencies.' },
  domains: { label: 'Domains', description: 'Business domains, user flows, and the files that implement each step.' },
  knowledge: { label: 'Knowledge', description: 'Wiki and docs knowledge graph — entities merged into Ask answers.' },
  graph: { label: 'Graph', description: 'ReactFlow canvas — nodes coloured by architectural layer.' },
  layers: { label: 'Layers', description: 'Horizontal Sankey lane (UI → Library → Backend → …).' },
  search: { label: 'Search', description: 'Semantic search via embeddings — plain English queries.' },
  index: { label: 'Index', description: 'Indexer debug — repo, webhook, last error, embedding coverage.' },
}

function resolveExploreTabFromParams(value: string | null): ExploreTabId {
  return resolveExploreTab(value)
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
  const activeTab = resolveExploreTabFromParams(tabParam)
  const primaryTab = primaryTabOf(activeTab)
  const activeTabMeta = EXPLORE_TAB_META[activeTab]

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<ExploreStats>('/v1/admin/explore/stats')
  usePublishPageHeroStats('/explore', statsData)
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

  const setPrimaryTab = useCallback(
    (primary: ExplorePrimaryTabId) => {
      setActiveTab(defaultTabForPrimary(primary))
    },
    [setActiveTab],
  )

  useEffect(() => {
    if (statsLoading) return
    if (tabParam != null) return
    if (ux.isQuickstart) {
      const quickTab = resolveQuickExploreTab(stats)
      if (activeTab !== quickTab) setActiveTab(quickTab)
      return
    }
    if (ux.isBeginner) {
      const beginnerTab = resolveBeginnerExploreTab(stats)
      if (activeTab !== beginnerTab) setActiveTab(beginnerTab)
    }
  }, [ux.isQuickstart, ux.isBeginner, statsLoading, stats, activeTab, tabParam, setActiveTab])

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

  const exploreHeroSeverity =
    bannerSeverity === 'danger' ? 'crit' : bannerSeverity === 'brand' ? 'info' : bannerSeverity

  const exploreAct = useMemo((): PageAction | null => {
    if (stats.topPriority === 'ready') return null
    if (stats.topPriorityTo && stats.topPriorityLabel) {
      const tone =
        stats.topPriority === 'error'
          ? 'act'
          : stats.topPriority === 'empty' || stats.topPriority === 'stale'
            ? 'check'
            : 'do'
      return {
        tone,
        title: stats.topPriorityLabel,
        reason: stats.lastIndexError ?? undefined,
        primary: { kind: 'link', to: stats.topPriorityTo, label: 'Take action →' },
        secondary: [{ kind: 'button', label: 'Index debug', onClick: () => setActiveTab('index') }],
      }
    }
    return null
  }, [stats.topPriority, stats.topPriorityTo, stats.topPriorityLabel, stats.lastIndexError, setActiveTab])

  const primaryTabOptions = useMemo(
    () =>
      EXPLORE_PRIMARY_TABS.filter((t) => !(ux.hideIndexTab && t.id === 'index')).map((t) => ({
        id: t.id,
        label: copy?.tabLabels?.[t.id] ?? t.label,
        count:
          t.id === 'map' && stats.indexedFiles > 0
            ? stats.indexedFiles
            : t.id === 'search' && stats.withEmbeddings > 0
              ? stats.withEmbeddings
              : undefined,
      })),
    [copy?.tabLabels, stats.indexedFiles, stats.withEmbeddings, ux.hideIndexTab],
  )

  const understandViewOptions = useMemo(
    () =>
      EXPLORE_UNDERSTAND_VIEWS.map((v) => ({
        id: v.id,
        label: copy?.tabLabels?.[v.id] ?? v.label,
      })),
    [copy?.tabLabels],
  )

  const mapViewOptions = useMemo(
    () =>
      EXPLORE_MAP_VIEWS.map((v) => ({
        id: v.id,
        label: copy?.tabLabels?.[v.id] ?? v.label,
      })),
    [copy?.tabLabels],
  )

  const isWorkbenchTab =
    activeTab === 'ask' ||
    activeTab === 'tour' ||
    activeTab === 'domains' ||
    activeTab === 'knowledge' ||
    activeTab === 'graph' ||
    activeTab === 'layers' ||
    activeTab === 'search'

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
            <div key={i} className="h-20 rounded bg-surface-raised" />
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
        <PageHeaderBar title={copy?.title ?? 'Explore'} />
        <PagePosture
          slots={[
            {
              priority: POSTURE_PRIORITY.status,
              children: <ExploreStatusBanner stats={stats} onTab={setActiveTab} />,
            },
            {
              priority: POSTURE_PRIORITY.guide,
              show: !shouldHideGuideWhenBannerActive(
                true,
                COMMON_HEALTHY_PRIORITIES,
                stats.topPriority,
              ),
              children: <ExploreAtlasGuide topPriority={stats.topPriority} />,
            },
          ]}
        />
        <EmptySectionMessage
          text="No project selected"
          hint="Select a project from the top bar to explore its codebase."
        />
      </div>
    )
  }

  const accessDenied =
    (error && error.includes('FORBIDDEN')) ||
    (statsError && statsError.includes('FORBIDDEN'))

  if (accessDenied) {
    return (
      <div className="space-y-4">
        <PageHeaderBar
          title={copy?.title ?? 'Explore'}
          projectScope={stats.projectName ?? undefined}
        />
        <ExploreUnderstandEmpty
          error={{
            code: 'FORBIDDEN',
            message: 'You do not have access to this project’s codebase index.',
          }}
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
    <div className="space-y-3 sm:space-y-4 min-w-0" data-testid="mushi-page-explore">
      <PageHeaderBar
        title={copy?.title ?? 'Explore'}
        projectScope={stats.projectName ?? undefined}
        withPageHero={!ux.hideOverviewChrome}
        description={copy?.description ?? 'Banner + EXPLORE SNAPSHOT — Overview for posture, Graph/Layers/Search for the atlas.'}
        helpTitle={copy?.help?.title ?? 'Codebase Atlas'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'Visual map of indexed source files grouped by architectural layer.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'See which layer a bug report file lives in',
            'Trace import dependencies between files',
            'Search "where is login?" and jump to the right symbol',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ??
          'Overview for posture. Graph/Layers for the map. Search for plain-English lookup. Index tab when debugging sweeper errors.'
        }
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
                        ? 'border border-edge-subtle bg-surface-raised text-fg-secondary'
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
      </PageHeaderBar>

      {!ux.hideOverviewChrome ? (
        <PageHero
          scope="explore"
          title={copy?.title ?? 'Codebase atlas'}
          kicker="Index posture"
          decide={{
            label: stats.topPriority === 'ready' ? 'Atlas ready' : stats.topPriorityLabel ?? 'Index posture',
            metric: `${stats.indexedFiles.toLocaleString()} files · ${stats.withEmbeddings.toLocaleString()} embedded`,
            summary:
              stats.topPriority === 'ready'
                ? `${stats.symbolCount.toLocaleString()} symbols indexed — ask, tour, or search the repo.`
                : stats.topPriorityLabel ?? 'Connect a repo and enable codebase indexing.',
            severity: exploreHeroSeverity,
            anchor: 'explore:decide',
            evidence: {
              kind: 'metric-breakdown',
              whyNow:
                stats.topPriority === 'error' && stats.lastIndexError
                  ? stats.lastIndexError
                  : stats.topPriority === 'ready'
                    ? `${stats.indexedFiles} files indexed with ${stats.withEmbeddings} embedding vectors for semantic search.`
                    : stats.topPriorityLabel ?? 'Indexing posture drives whether Ask, Tour, and Search can answer grounded questions.',
              items: [
                { label: 'Indexed files', value: stats.indexedFiles, tone: stats.indexedFiles > 0 ? 'ok' : 'warn' },
                { label: 'Embeddings', value: stats.withEmbeddings, tone: stats.withEmbeddings > 0 ? 'ok' : 'warn' },
                { label: 'Symbols', value: stats.symbolCount, tone: 'neutral' },
                {
                  label: 'Index enabled',
                  value: stats.codebaseIndexEnabled ? 'Yes' : 'No',
                  tone: stats.codebaseIndexEnabled ? 'ok' : 'warn',
                },
              ],
            },
          }}
          act={exploreAct}
          actAnchor="explore:act"
          actEvidence={
            exploreAct
              ? { kind: 'rule-trace', why: exploreAct.reason ?? exploreAct.title, threshold: stats.topPriority ?? undefined }
              : undefined
          }
          verify={{
            label: stats.lastIndexedAt ? 'Last indexed' : 'Awaiting first index',
            detail: stats.lastIndexedAt ?? stats.lastIndexAttemptAt ?? '—',
            to: '/explore?tab=index',
            secondaryTo: '/connect',
            secondaryLabel: 'Connect repo',
            anchor: 'explore:verify',
            evidence: stats.lastIndexedAt
              ? {
                  kind: 'last-event',
                  at: stats.lastIndexedAt,
                  by: 'codebase indexer',
                  payloadSummary: `${stats.indexedFiles} files`,
                  status: stats.topPriority === 'error' ? 'warn' : 'ok',
                }
              : undefined,
          }}
        />
      ) : null}

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: (
              <ExploreStatusBanner
                stats={stats}
                onTab={setActiveTab}
                onRefresh={reloadAll}
                refreshing={statsValidating || loading}
                plainBanner={ux.plainBanner}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.guide,
            show: !shouldHideGuideWhenBannerActive(
              true,
              COMMON_HEALTHY_PRIORITIES,
              stats.topPriority,
            ),
            children: <ExploreAtlasGuide topPriority={stats.topPriority} />,
          },
        ]}
      />

      {!ux.hideTabs && (
        <div className="space-y-2 min-w-0">
          <SegmentedControl<ExplorePrimaryTabId>
            size="sm"
            scrollable
            ariaLabel="Explore sections"
            value={primaryTab}
            options={primaryTabOptions}
            onChange={setPrimaryTab}
            className="w-full sm:w-auto"
          />
          {primaryTab === 'understand' && isUnderstandView(activeTab) && (
            <SegmentedControl<ExploreUnderstandView>
              size="sm"
              scrollable
              ariaLabel="Understand views"
              value={activeTab}
              options={understandViewOptions}
              onChange={setActiveTab}
              className="w-full sm:w-auto"
            />
          )}
          {primaryTab === 'map' && isMapView(activeTab) && (
            <SegmentedControl<ExploreMapView>
              size="sm"
              scrollable
              ariaLabel="Map views"
              value={activeTab}
              options={mapViewOptions}
              onChange={setActiveTab}
              className="w-full sm:w-auto"
            />
          )}
        </div>
      )}

      {!ux.hideExploreSnapshot && (
      <Section
        title={copy?.sections?.snapshot ?? (isWorkbenchTab ? 'At a glance' : 'EXPLORE SNAPSHOT')}
        freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
        className={isWorkbenchTab ? 'xl:py-2.5' : undefined}
      >
        {!isWorkbenchTab && <SnapshotSectionHint text={activeTabMeta.description} />}
        <StatGrid minCol={isWorkbenchTab ? '8.5rem' : '10.5rem'}>
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
        </StatGrid>
      </Section>
      )}

      {activeTab === 'overview' && (
        <>
          {!ux.hideOverviewChrome && (
          <>
          {stats.topPriorityTo && stats.topPriority !== 'ready' ? (
            <Card
              className={`p-4 ${
                stats.topPriority === 'error'
                  ? 'border-danger/40 bg-surface-raised'
                  : stats.topPriority === 'empty' || stats.topPriority === 'stale'
                    ? 'border-warn/40 bg-surface-raised'
                    : 'border-brand/40 bg-surface-raised'
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

      {activeTab === 'knowledge' && <ExploreKnowledgePanel projectId={projectId} />}

      {activeTab === 'search' && (
        <div className={selectedNode ? 'grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] 2xl:grid-cols-[minmax(0,1fr)_24rem] items-start' : 'min-w-0'}>
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
          <ExploreWorkspaceReadout projectId={projectId} />
          <ExploreIndexScopePanel projectId={projectId} />
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
