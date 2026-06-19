import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { useToast } from '../lib/toast'
import { usePageCopy } from '../lib/copy'
import { usePublishPageContext } from '../lib/pageContext'
import { useRealtimeReload } from '../lib/realtime'
import { SnapshotSectionHint,
  SegmentedControl,
  ErrorAlert,
  Section,
  StatCard,
  FreshnessPill,
  Badge,
  Btn,
  Card, } from '../components/ui'
import { GraphSkeleton } from '../components/skeletons/GraphSkeleton'
import { SetupNudge } from '../components/SetupNudge'
import { HeroGraphNodes } from '../components/illustrations/HeroIllustrations'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { GraphBackendPanel } from '../components/graph/GraphBackendPanel'
import { OntologyPanel } from '../components/graph/OntologyPanel'
import { GroupsPanel } from '../components/graph/GroupsPanel'
import { GraphCanvas } from '../components/graph/GraphCanvas'
import {
  GraphFilterChips,
  QuickViewsRow,
  type QuickView,
} from '../components/graph/GraphFilters'
// GraphSidePanel was previously rendered as a sibling 18rem column to the
// right of the canvas, eating horizontal real estate even when no node was
// selected. As of 2026-05-07 the panel is mounted inside the ReactFlow
// canvas via a floating `<Panel position="top-right">` (see GraphCanvas).
// The storyboard view still renders it inline below the strip.
import { GraphSidePanel } from '../components/graph/GraphSidePanel'
import { GraphStoryboard } from '../components/graph/GraphStoryboard'
import { GraphTableView } from '../components/graph/GraphTableView'
import { layoutNodes } from '../components/graph/graphLayout'
import {
  EDGE_LABELS,
  EDGE_TYPES,
  NODE_TYPES,
  NODE_TYPE_LABELS,
  SURFACE_DEFAULT_EDGE_TYPES,
  SURFACE_DEFAULT_NODE_TYPES,
  type BlastRadiusItem,
  type EdgeType,
  type GraphEdge,
  type GraphNode,
  type NodeType,
} from '../components/graph/types'
import { GraphStatusBanner } from '../components/graph/GraphStatusBanner'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  InlineProof,
  SignalChip,
} from '../components/report-detail/ReportSurface'
import {
  EMPTY_GRAPH_STATS,
  type GraphStats,
  type GraphTabId,
} from '../components/graph/GraphStatsTypes'
import { useGraphUx, resolveQuickGraphTab } from '../lib/graphModeUx'
import {
  edgesDetail,
  edgesTooltip,
  fragileDetail,
  fragileTooltip,
  inventoryDetail,
  inventoryTooltip,
  nodesDetail,
  nodesTooltip,
} from '../lib/statTooltips/graph'
import { graphLinks } from '../lib/statCardLinks'

const GRAPH_TABS: Array<{ id: GraphTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Posture banner, fragility summary, and how the map relates to Reports and Inventory.',
  },
  {
    id: 'explore',
    label: 'Explore',
    description: 'Interactive canvas, table, or inventory surface — click nodes for blast radius.',
  },
  {
    id: 'backend',
    label: 'Backend',
    description: 'Apache AGE sync status, ontology tags, and node groups for advanced debugging.',
  },
]

function resolveGraphTab(value: string | null): GraphTabId {
  if (value === 'overview' || value === 'backend') return value
  return 'explore'
}

type ViewMode = 'graph' | 'table' | 'surface'

/**
 * Below this node count we auto-flip to the storyboard layout because the
 * spaghetti React Flow canvas adds noise (large empty pan area, minimap
 * clutter) without insight when the data is sparse. Users can still toggle
 * back to the canvas with the view switch.
 */
const STORYBOARD_THRESHOLD = 12

export function GraphPage() {
  const toast = useToast()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
  const copy = usePageCopy('/graph')
  const ux = useGraphUx()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab = resolveGraphTab(tabParam)
  const activeTabMeta = GRAPH_TABS.find((t) => t.id === activeTab) ?? GRAPH_TABS[1]

  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<GraphStats>('/v1/admin/graph/stats')
  usePublishPageHeroStats('/graph', statsData)
  const stats = statsData ?? EMPTY_GRAPH_STATS

  const setActiveTab = useCallback(
    (id: GraphTabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'explore') next.delete('tab')
      else next.set('tab', id)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  useEffect(() => {
    if (!ux.isQuickstart || statsLoading) return
    const quickTab = resolveQuickGraphTab(stats)
    if (activeTab !== quickTab) setActiveTab(quickTab)
  }, [ux.isQuickstart, statsLoading, stats, activeTab, setActiveTab])

  const nodesQuery = usePageData<{ nodes: GraphNode[] }>('/v1/admin/graph/nodes')
  const edgesQuery = usePageData<{ edges: GraphEdge[] }>('/v1/admin/graph/edges')

  const rawNodes = nodesQuery.data?.nodes ?? []
  const rawEdges = edgesQuery.data?.edges ?? []
  const loading = nodesQuery.loading || edgesQuery.loading
  const error = nodesQuery.error ?? edgesQuery.error
  const reloadGraph = useCallback(() => {
    reloadStats()
    nodesQuery.reload()
    edgesQuery.reload()
  }, [reloadStats, nodesQuery, edgesQuery])

  useRealtimeReload(['graph_nodes', 'graph_edges', 'reports'], reloadGraph, {
    debounceMs: 1500,
    enabled: stats.hasAnyProject,
  })

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [blastRadius, setBlastRadius] = useState<BlastRadiusItem[]>([])
  const [blastLoading, setBlastLoading] = useState(false)

  const [search, setSearch] = useState('')
  const [enabledNodeTypes, setEnabledNodeTypes] = useState<Set<NodeType>>(new Set(NODE_TYPES))
  const [enabledEdgeTypes, setEnabledEdgeTypes] = useState<Set<EdgeType>>(new Set(EDGE_TYPES))
  const [view, setView] = useState<ViewMode>('graph')
  const surfaceFiltersApplied = useRef(false)
  const [hideSingletons, setHideSingletons] = useState(true)
  const [layoutSeed, setLayoutSeed] = useState(0)
  // Lets users override the auto-storyboard heuristic — useful when they
  // want the spatial canvas even on a small graph (e.g. to inspect dragging).
  const [forceCanvas, setForceCanvas] = useState(false)

  // Pre-baked filter views — flip filter sets to highlight a specific story.
  // Reset selection so the side-panel doesn't show a stale node from a
  // different filter context.
  useEffect(() => {
    if (view !== 'surface') {
      surfaceFiltersApplied.current = false
      return
    }
    if (surfaceFiltersApplied.current) return
    surfaceFiltersApplied.current = true
    setEnabledNodeTypes(new Set(SURFACE_DEFAULT_NODE_TYPES))
    setEnabledEdgeTypes(new Set(SURFACE_DEFAULT_EDGE_TYPES))
    setSelectedNode(null)
    setBlastRadius([])
  }, [view])

  const applyView = useCallback((preset: QuickView) => {
    setSelectedNode(null)
    setBlastRadius([])
    if (preset === 'all') {
      setEnabledEdgeTypes(new Set(EDGE_TYPES))
      setEnabledNodeTypes(new Set(NODE_TYPES))
    } else if (preset === 'regressions') {
      setEnabledEdgeTypes(new Set(['regression_of', 'duplicate_of', 'related_to']))
      setEnabledNodeTypes(new Set(NODE_TYPES))
    } else if (preset === 'fragile') {
      setEnabledEdgeTypes(new Set(['affects', 'causes']))
      setEnabledNodeTypes(new Set(['component', 'page', 'report_group']))
    } else if (preset === 'fixes') {
      setEnabledEdgeTypes(new Set(['fix_attempted', 'fix_applied', 'fix_verified']))
      setEnabledNodeTypes(new Set(NODE_TYPES))
    }
  }, [])

  // Deep-link quick views from stats CTAs (?view=fragile|regressions|fixes)
  useEffect(() => {
    if (activeTab !== 'explore') return
    const preset = searchParams.get('view')
    if (preset === 'fragile' || preset === 'regressions' || preset === 'fixes' || preset === 'all') {
      applyView(preset)
    }
  }, [activeTab, searchParams, applyView])

  const filteredNodes = useMemo(() => {
    const q = search.trim().toLowerCase()
    const typeFiltered = rawNodes.filter((n) => {
      if (!enabledNodeTypes.has(n.node_type as NodeType)) return false
      if (q && !n.label.toLowerCase().includes(q)) return false
      return true
    })
    if (!hideSingletons) return typeFiltered
    // A node is a singleton if no enabled edge connects to it. We have to
    // compute connections against the type-filtered set to keep the result
    // stable when only edge filters change.
    const visible = new Set(typeFiltered.map((n) => n.id))
    const connected = new Set<string>()
    for (const e of rawEdges) {
      if (!enabledEdgeTypes.has(e.edge_type as EdgeType)) continue
      if (visible.has(e.source_node_id) && visible.has(e.target_node_id)) {
        connected.add(e.source_node_id)
        connected.add(e.target_node_id)
      }
    }
    return typeFiltered.filter((n) => connected.has(n.id))
  }, [rawNodes, rawEdges, enabledNodeTypes, enabledEdgeTypes, search, hideSingletons])

  const filteredEdges = useMemo(() => {
    const visibleNodeIds = new Set(filteredNodes.map((n) => n.id))
    return rawEdges.filter(
      (e) =>
        enabledEdgeTypes.has(e.edge_type as EdgeType) &&
        visibleNodeIds.has(e.source_node_id) &&
        visibleNodeIds.has(e.target_node_id),
    )
  }, [rawEdges, filteredNodes, enabledEdgeTypes])

  const singletonCount = useMemo(() => {
    if (!hideSingletons) return 0
    const typeFiltered = rawNodes.filter((n) => enabledNodeTypes.has(n.node_type as NodeType))
    return typeFiltered.length - filteredNodes.length
  }, [rawNodes, filteredNodes, enabledNodeTypes, hideSingletons])

  const positions = useMemo(
    () => layoutNodes(filteredNodes, filteredEdges, layoutSeed),
    [filteredNodes, filteredEdges, layoutSeed],
  )

  const blastRadiusIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of blastRadius) {
      const id = item.target_node_id ?? item.node_id
      if (id) ids.add(id)
    }
    return ids
  }, [blastRadius])

  const flowNodes: Node[] = useMemo(() => {
    return filteredNodes.map((n) => {
      const pos = positions.get(n.id) ?? { x: 0, y: 0 }
      const inBlast = blastRadiusIds.has(n.id)
      const isSelected = selectedNode?.id === n.id
      return {
        id: n.id,
        position: pos,
        data: { node: n, inBlast, isSelected },
        type: 'default',
        // Use a simple HTML render via `data.label` (reactflow renders it inside
        // its own wrapper); we hide the default styling and supply our own chip.
        label: n.label,
        style: {
          background: 'transparent',
          border: 'none',
          padding: 0,
          width: 'auto',
          opacity: blastRadius.length > 0 && !inBlast && !isSelected ? 0.35 : 1,
        },
      } as unknown as Node
    })
  }, [filteredNodes, positions, blastRadiusIds, selectedNode, blastRadius.length])

  const flowEdges: Edge[] = useMemo(() => {
    return filteredEdges.map((e) => {
      const inBlast =
        blastRadiusIds.has(e.source_node_id) || blastRadiusIds.has(e.target_node_id)
      const dimmed = blastRadius.length > 0 && !inBlast
      return {
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        label: EDGE_LABELS[e.edge_type] ?? e.edge_type,
        animated: e.edge_type === 'fix_attempted',
        style: {
          stroke:
            e.edge_type === 'reports_against'
              ? 'oklch(0.72 0.18 290)'
              : e.edge_type === 'errors_on'
                ? 'oklch(0.62 0.22 25)'
                : e.edge_type === 'regression_of'
                  ? 'oklch(0.65 0.22 25)'
                  : e.edge_type === 'fix_verified'
                    ? 'oklch(0.72 0.19 155)'
                    : 'oklch(0.50 0 0)',
          strokeWidth: Math.max(1, Math.min(3, e.weight)),
          opacity: dimmed ? 0.18 : 0.7,
        },
        labelStyle: { fontSize: 11, fill: 'oklch(0.65 0 0)' },
        labelBgStyle: { fill: 'oklch(0.18 0 0)' },
      } satisfies Edge
    })
  }, [filteredEdges, blastRadiusIds, blastRadius.length])

  const fetchBlastRadius = useCallback(
    async (node: GraphNode) => {
      setBlastLoading(true)
      try {
        const res = await apiFetch<{ affected: BlastRadiusItem[] }>(
          `/v1/admin/graph/blast-radius/${node.id}`,
        )
        if (res.ok) {
          setBlastRadius(res.data?.affected ?? [])
        } else {
          setBlastRadius([])
          toast.push({
            tone: 'error',
            message: `Couldn't compute blast radius for "${node.label}"`,
            description: res.error?.message ?? 'Unknown error from /v1/admin/graph/blast-radius',
          })
        }
      } catch (err) {
        setBlastRadius([])
        toast.push({
          tone: 'error',
          message: `Couldn't reach blast-radius API for "${node.label}"`,
          description: err instanceof Error ? err.message : String(err),
        })
      } finally {
        setBlastLoading(false)
      }
    },
    [toast],
  )

  const onNodeClick: NodeMouseHandler = useCallback(
    (_evt, node) => {
      const original = filteredNodes.find((n) => n.id === node.id) ?? null
      setSelectedNode(original)
      if (!original) {
        setBlastRadius([])
        return
      }
      void fetchBlastRadius(original)
    },
    [filteredNodes, fetchBlastRadius],
  )

  const clearSelection = useCallback(() => {
    setSelectedNode(null)
    setBlastRadius([])
  }, [])

  const toggleEdgeType = useCallback((et: EdgeType) => {
    setEnabledEdgeTypes((prev) => {
      const next = new Set(prev)
      if (next.has(et)) next.delete(et)
      else next.add(et)
      return next
    })
  }, [])

  const toggleNodeType = useCallback((nt: NodeType) => {
    setEnabledNodeTypes((prev) => {
      const next = new Set(prev)
      if (next.has(nt)) next.delete(nt)
      else next.add(nt)
      return next
    })
  }, [])

  const hasInventoryNodes = useMemo(
    () =>
      rawNodes.some((n) =>
        ['app', 'page_v2', 'element', 'action', 'api_dep', 'db_dep', 'test', 'user_story'].includes(
          n.node_type,
        ),
      ),
    [rawNodes],
  )

  const useStoryboard =
    view === 'graph' &&
    !forceCanvas &&
    !hasInventoryNodes &&
    filteredNodes.length > 0 &&
    filteredNodes.length < STORYBOARD_THRESHOLD

  const bannerSeverity: 'ok' | 'warn' | 'danger' | 'brand' | 'info' | 'neutral' =
    !stats.hasAnyProject
      ? 'neutral'
      : !stats.hasIngest
        ? 'brand'
        : stats.topPriority === 'fragile'
          ? 'danger'
          : stats.topPriority === 'regressions' || stats.topPriority === 'empty'
            ? 'warn'
            : stats.topPriority === 'clear'
              ? 'ok'
              : 'brand'

  const tabOptions = useMemo(
    () => [
      { id: 'overview' as const, label: copy?.tabLabels?.overview ?? 'Overview' },
      {
        id: 'explore' as const,
        label: copy?.tabLabels?.explore ?? 'Explore',
        count: stats.nodeCount > 0 ? stats.nodeCount : undefined,
      },
      { id: 'backend' as const, label: copy?.tabLabels?.backend ?? 'Backend' },
    ],
    [stats, copy?.tabLabels],
  )

  usePublishPageContext({
    route: '/graph',
    title: 'Knowledge graph',
    summary: `${activeTabMeta.label} · ${stats.nodeCount} nodes · ${stats.fragileComponents} fragile`,
    filters: { tab: activeTab, view: view },
    criticalCount: stats.fragileComponents,
    actions: [{ id: 'graph-refresh', label: 'Refresh', hint: 'Re-fetch stats + nodes/edges', run: reloadGraph }],
  })

  if (statsLoading && !statsData) {
    return (
      <div className="space-y-4 animate-pulse" aria-hidden role="status" aria-label="Loading graph">
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
    return <ErrorAlert message={`Failed to load graph stats: ${statsError}`} onRetry={reloadGraph} />
  }

  const explorePanel = loading ? (
    <GraphSkeleton />
  ) : error ? (
    <ErrorAlert message={`Failed to load knowledge graph: ${error}`} onRetry={reloadGraph} />
  ) : (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {view === 'surface' && (
          <SignalChip tone="brand" className="uppercase tracking-wide font-medium">
            Surface · inventory overlay
          </SignalChip>
        )}
        <InlineProof className="font-mono tabular-nums border-0 bg-transparent px-0 py-0">
          {filteredNodes.length}/{rawNodes.length} nodes · {filteredEdges.length}/{rawEdges.length} edges
        </InlineProof>
        <SegmentedControl<ViewMode>
          size="sm"
          ariaLabel="Graph view mode"
          value={view}
          options={VIEW_MODE_OPTIONS}
          onChange={setView}
        />
      </div>

      <div data-dav-anchor="graph:act">
        <QuickViewsRow
          hideSingletons={hideSingletons}
          singletonCount={singletonCount}
          onApplyView={applyView}
          onToggleSingletons={setHideSingletons}
          onRelayout={() => setLayoutSeed((s) => s + 1)}
        />
      </div>

      {rawNodes.length === 0 ? (
        <SetupNudge
          requires={['first_report_received']}
          emptyTitle="The graph is empty"
          emptyDescription="Nodes and edges populate automatically as the LLM pipeline classifies reports. Submit a report from the dashboard to seed the graph."
          emptyIcon={<HeroGraphNodes />}
          blockedIcon={<HeroGraphNodes accent="text-fg-faint" />}
          emptyHints={[
            'Each report becomes a node — duplicates collapse into the same fingerprint.',
            'Edges link reports that share a component, route, or fingerprint.',
          ]}
        />
      ) : (
        <div className="space-y-2" data-dav-anchor="graph:verify">
          <GraphFilterChips
            search={search}
            onSearchChange={setSearch}
            enabledNodeTypes={enabledNodeTypes}
            enabledEdgeTypes={enabledEdgeTypes}
            onToggleNodeType={toggleNodeType}
            onToggleEdgeType={toggleEdgeType}
          />

          {useStoryboard ? (
            <div className="grid gap-3 md:grid-cols-[1fr_18rem]">
              <div className="space-y-2 min-w-0">
                <StoryboardNarrative
                  nodes={filteredNodes}
                  onSwitchToCanvas={() => setForceCanvas(true)}
                />
                <GraphStoryboard
                  nodes={filteredNodes}
                  edges={filteredEdges}
                  selectedNodeId={selectedNode?.id ?? null}
                  blastRadiusIds={blastRadiusIds}
                  onSelect={(node) => {
                    setSelectedNode(node)
                    void fetchBlastRadius(node)
                  }}
                  onClear={clearSelection}
                />
              </div>
              <GraphSidePanel
                node={selectedNode}
                blastRadius={blastRadius}
                blastLoading={blastLoading}
                onClear={clearSelection}
              />
            </div>
          ) : view === 'table' ? (
            <div className="grid gap-3 md:grid-cols-[1fr_18rem]">
              <div className="min-w-0">
                <GraphTableView
                  nodes={filteredNodes}
                  edges={filteredEdges}
                  selectedNodeId={selectedNode?.id ?? null}
                  blastRadiusIds={blastRadiusIds}
                  onSelect={(node) => {
                    setSelectedNode(node)
                    void fetchBlastRadius(node)
                  }}
                />
              </div>
              <GraphSidePanel
                node={selectedNode}
                blastRadius={blastRadius}
                blastLoading={blastLoading}
                onClear={clearSelection}
              />
            </div>
          ) : (
            <>
              {view === 'graph' && forceCanvas && filteredNodes.length < STORYBOARD_THRESHOLD && (
                <div className="flex items-center justify-end">
                  <ActionPill tone="neutral" onClick={() => setForceCanvas(false)}>
                    ← Back to storyboard
                  </ActionPill>
                </div>
              )}
              <GraphCanvas
                flowNodes={flowNodes}
                flowEdges={flowEdges}
                filteredCount={filteredNodes.length}
                filteredEdgeCount={filteredEdges.length}
                onNodeClick={onNodeClick}
                onPaneClick={clearSelection}
                onResetView={() => applyView('all')}
                hidden={false}
                selectedNode={selectedNode}
                blastRadius={blastRadius}
                blastLoading={blastLoading}
                onClearSelection={clearSelection}
              />
            </>
          )}
        </div>
      )}
    </>
  )

  return (
    <div className="space-y-4" data-testid="mushi-page-graph">
      <PageHeaderBar
        title={copy?.title ?? 'Knowledge Graph'}
        projectScope={stats.projectName ?? projectName ?? undefined}
        description={
          copy?.description ??
          (stats.nodeCount > 0
            ? `${stats.nodeCount} nodes · Explore tab for blast radius`
            : 'Banner + GRAPH SNAPSHOT — Overview for posture, Explore for the map.')
        }
        helpTitle={copy?.help?.title ?? 'About the Knowledge Graph'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'A live map of the relationships your bug reports create — components affected, pages broken, regressions, duplicates, and fix attempts.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'See blast radius: click any node to highlight everything it can affect',
            'Find regressions: pick the Regressions quick view on Explore tab',
            'Spot fragile components: red banner means ≥3 incoming affects edges',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ??
          'Overview for posture. Explore for canvas/table/surface. Backend tab shows AGE sync and ontology debug info.'
        }
      >
        <Badge
          className={
            bannerSeverity === 'ok'
              ? 'bg-ok-muted text-ok'
              : bannerSeverity === 'danger'
                ? 'bg-danger-muted/50 text-danger-foreground'
                : bannerSeverity === 'warn'
                  ? 'bg-warn-muted/50 text-warning-foreground'
                  : bannerSeverity === 'brand'
                    ? 'bg-chrome text-fg-secondary'
                    : 'bg-surface-overlay text-fg-muted'
          }
        >
          {!stats.hasIngest
            ? 'WAITING'
            : stats.nodeCount === 0
              ? 'EMPTY'
              : stats.fragileComponents > 0
                ? `${stats.fragileComponents} FRAGILE`
                : stats.regressionEdges > 0
                  ? `${stats.regressionEdges} REGR`
                  : 'CURRENT'}
        </Badge>
        <FreshnessPill
          at={statsFetchedAt ?? nodesQuery.lastFetchedAt}
          isValidating={statsValidating || nodesQuery.isValidating || edgesQuery.isValidating}
        />
        <Btn
          size="sm"
          variant="ghost"
          onClick={reloadGraph}
          loading={statsValidating || nodesQuery.isValidating}
        >
          Refresh
        </Btn>
      </PageHeaderBar>

      <GraphStatusBanner
        stats={stats}
        onTab={setActiveTab}
        onRefresh={reloadGraph}
        refreshing={statsValidating || loading}
        plainBanner={ux.plainBanner}
      />

      {!ux.hideTabs && (
        <SegmentedControl<GraphTabId>
          size="sm"
          ariaLabel="Graph sections"
          value={activeTab}
          options={tabOptions}
          onChange={setActiveTab}
        />
      )}

      {!ux.hideGraphSnapshot && (
      <Section title={copy?.sections?.snapshot ?? 'GRAPH SNAPSHOT'} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
        <SnapshotSectionHint text={activeTabMeta.description} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label={copy?.statLabels?.nodes ?? 'Nodes'}
            value={stats.nodeCount}
            accent={stats.nodeCount > 0 ? 'text-fg' : undefined}
            tooltip={nodesTooltip(stats)}
            detail={nodesDetail(stats)}
            to={graphLinks.nodes}
          />
          <StatCard
            label={copy?.statLabels?.edges ?? 'Edges'}
            value={stats.edgeCount}
            accent={stats.edgeCount > 0 ? 'text-brand' : undefined}
            tooltip={edgesTooltip(stats)}
            detail={edgesDetail(stats)}
            to={graphLinks.edges}
          />
          <StatCard
            label={copy?.statLabels?.fragile ?? 'Fragile'}
            value={stats.fragileComponents}
            accent={stats.fragileComponents > 0 ? 'text-danger' : 'text-ok'}
            tooltip={fragileTooltip(stats)}
            detail={fragileDetail(ux.plainBanner)}
            to={graphLinks.fragile}
          />
          <StatCard
            label={copy?.statLabels?.inventory ?? 'Inventory'}
            value={stats.inventoryNodes}
            accent={stats.inventoryNodes > 0 ? 'text-info' : undefined}
            tooltip={inventoryTooltip(stats)}
            detail={inventoryDetail(stats)}
            to={graphLinks.inventory}
          />
        </div>
      </Section>
      )}

      {activeTab === 'overview' && (
        <>
          {stats.topPriorityTo && stats.topPriority !== 'clear' ? (
            <Card
              className={`space-y-3 p-4 ${
                stats.topPriority === 'fragile'
                  ? 'border-danger/30 bg-danger/5'
                  : stats.topPriority === 'regressions' || stats.topPriority === 'empty'
                    ? 'border-warn/30 bg-warn/5'
                    : 'border-brand/30 bg-brand/5'
              }`}
            >
              <SignalChip
                tone={
                  stats.topPriority === 'fragile'
                    ? 'danger'
                    : stats.topPriority === 'regressions' || stats.topPriority === 'empty'
                      ? 'warn'
                      : 'brand'
                }
              >
                Top priority
              </SignalChip>
              <ContainedBlock
                tone={
                  stats.topPriority === 'fragile' ? 'warn' : stats.topPriority === 'regressions' ? 'warn' : 'info'
                }
                label="Graph"
              >
                <p className="text-sm font-medium leading-snug text-fg">{stats.topPriorityLabel}</p>
              </ContainedBlock>
              <ActionPillRow>
                <ActionPill to={stats.topPriorityTo} tone="brand">
                  Take action →
                </ActionPill>
                <ActionPill tone="neutral" onClick={() => setActiveTab('explore')}>
                  Open map
                </ActionPill>
              </ActionPillRow>
            </Card>
          ) : null}

          {!ux.hideOverviewChrome && (
          <ActionPillRow>
            <ActionPill tone="brand" onClick={() => setActiveTab('explore')}>
              {copy?.actionLabels?.explore ?? 'Open map'} →
            </ActionPill>
            {!stats.hasIngest ? (
              <ActionPill to="/onboarding?tab=verify" tone="neutral">
                {copy?.actionLabels?.verify ?? 'Send test report'}
              </ActionPill>
            ) : null}
          </ActionPillRow>
          )}
        </>
      )}

      {activeTab === 'explore' && explorePanel}

      {activeTab === 'backend' && (
        <div className="space-y-3">
          <ContainedBlock tone="info" label="Graph backend debug">
            <p className="text-sm font-medium text-fg">Sync posture</p>
            <InlineProof className="mt-2">
              Backend: <span className="font-mono text-fg-secondary">{stats.graphBackend}</span>
              {stats.ageAvailable ? ' · Apache AGE available' : ' · SQL-only mode'}
              {stats.unsyncedNodes > 0 || stats.unsyncedEdges > 0
                ? ` · ${stats.unsyncedNodes} unsynced nodes · ${stats.unsyncedEdges} unsynced edges`
                : ' · fully synced'}
            </InlineProof>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <SignalChip tone={stats.ageAvailable ? 'ok' : 'neutral'}>
                {stats.ageAvailable ? 'AGE on' : 'SQL mode'}
              </SignalChip>
              <SignalChip tone={stats.unsyncedNodes > 0 || stats.unsyncedEdges > 0 ? 'warn' : 'ok'}>
                {stats.unsyncedNodes > 0 || stats.unsyncedEdges > 0 ? 'Sync pending' : 'Fully synced'}
              </SignalChip>
            </div>
          </ContainedBlock>
          <div className="grid gap-3 md:grid-cols-2">
            <GraphBackendPanel />
            <OntologyPanel />
          </div>
          <GroupsPanel />
        </div>
      )}
    </div>
  )
}

const VIEW_MODE_OPTIONS = [
  { id: 'graph' as const, label: 'Graph' },
  { id: 'surface' as const, label: 'Surface' },
  { id: 'table' as const, label: 'Table' },
]

interface StoryboardNarrativeProps {
  nodes: GraphNode[]
  onSwitchToCanvas: () => void
}

/**
 * Renders a one-sentence "this is what you're looking at" header above the
 * sparse-graph storyboard. Computed from real node-type counts so the copy
 * always reflects the data on screen — no static hand-wave.
 */
function StoryboardNarrative({ nodes, onSwitchToCanvas }: StoryboardNarrativeProps) {
  const sentence = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of nodes) {
      counts.set(n.node_type, (counts.get(n.node_type) ?? 0) + 1)
    }
    const label = (t: string) => NODE_TYPE_LABELS[t] ?? t.replace(/_/g, ' ')
    const parts: string[] = []
    for (const [t, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      if (n <= 0) continue
      parts.push(`${n} ${label(t)}${n === 1 ? '' : 's'}`)
    }
    if (parts.length === 0) return 'No nodes match the current filters yet.'
    return `${parts.slice(0, 6).join(' · ')}${parts.length > 6 ? '…' : ''}. Click any card to highlight its blast radius.`
  }, [nodes])

  return (
    <ContainedBlock tone="muted" className="flex items-start justify-between gap-3">
      <p className="max-w-prose text-xs leading-relaxed text-fg-secondary wrap-break-word text-pretty">
        <SignalChip tone="neutral" className="mr-1.5 align-middle">
          Story
        </SignalChip>
        {sentence}
      </p>
      <ActionPill tone="neutral" onClick={onSwitchToCanvas} className="shrink-0">
        Spatial canvas
      </ActionPill>
    </ContainedBlock>
  )
}
