import { useCallback, useMemo, useState } from 'react'
import {
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import {
  PageHeader,
  PageHelp,
  Loading,
  ErrorAlert,
} from '../components/ui'
import { SetupNudge } from '../components/SetupNudge'
import { GraphBackendPanel } from '../components/graph/GraphBackendPanel'
import { OntologyPanel } from '../components/graph/OntologyPanel'
import { GroupsPanel } from '../components/graph/GroupsPanel'
import { GraphCanvas } from '../components/graph/GraphCanvas'
import {
  GraphFilterChips,
  QuickViewsRow,
  type QuickView,
} from '../components/graph/GraphFilters'
import { GraphSidePanel } from '../components/graph/GraphSidePanel'
import { GraphTableView } from '../components/graph/GraphTableView'
import { layoutNodes } from '../components/graph/graphLayout'
import {
  EDGE_LABELS,
  EDGE_TYPES,
  NODE_TYPES,
  type BlastRadiusItem,
  type EdgeType,
  type GraphEdge,
  type GraphNode,
  type NodeType,
} from '../components/graph/types'

type ViewMode = 'graph' | 'table'

export function GraphPage() {
  const toast = useToast()
  const nodesQuery = usePageData<{ nodes: GraphNode[] }>('/v1/admin/graph/nodes')
  const edgesQuery = usePageData<{ edges: GraphEdge[] }>('/v1/admin/graph/edges')

  const rawNodes = nodesQuery.data?.nodes ?? []
  const rawEdges = edgesQuery.data?.edges ?? []
  const loading = nodesQuery.loading || edgesQuery.loading
  const error = nodesQuery.error ?? edgesQuery.error
  const reloadGraph = useCallback(() => {
    nodesQuery.reload()
    edgesQuery.reload()
  }, [nodesQuery, edgesQuery])

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [blastRadius, setBlastRadius] = useState<BlastRadiusItem[]>([])
  const [blastLoading, setBlastLoading] = useState(false)

  const [search, setSearch] = useState('')
  const [enabledNodeTypes, setEnabledNodeTypes] = useState<Set<NodeType>>(new Set(NODE_TYPES))
  const [enabledEdgeTypes, setEnabledEdgeTypes] = useState<Set<EdgeType>>(new Set(EDGE_TYPES))
  const [view, setView] = useState<ViewMode>('graph')
  const [hideSingletons, setHideSingletons] = useState(true)
  const [layoutSeed, setLayoutSeed] = useState(0)

  // Pre-baked filter views — flip filter sets to highlight a specific story.
  // Reset selection so the side-panel doesn't show a stale node from a
  // different filter context.
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
            e.edge_type === 'regression_of'
              ? 'oklch(0.65 0.22 25)'
              : e.edge_type === 'fix_verified'
                ? 'oklch(0.72 0.19 155)'
                : 'oklch(0.50 0 0)',
          strokeWidth: Math.max(1, Math.min(3, e.weight)),
          opacity: dimmed ? 0.18 : 0.7,
        },
        labelStyle: { fontSize: 10, fill: 'oklch(0.65 0 0)' },
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

  if (loading) return <Loading text="Loading graph…" />
  if (error)
    return (
      <ErrorAlert message={`Failed to load knowledge graph: ${error}`} onRetry={reloadGraph} />
    )

  return (
    <div className="space-y-3">
      <PageHeader title="Knowledge Graph">
        <div className="flex items-center gap-2">
          <span className="text-2xs text-fg-faint font-mono">
            {filteredNodes.length}/{rawNodes.length} nodes ·{' '}
            {filteredEdges.length}/{rawEdges.length} edges
          </span>
          <ViewModeToggle view={view} onChange={setView} />
        </div>
      </PageHeader>

      <PageHelp
        title="About the Knowledge Graph"
        whatIsIt="A live map of the relationships your bug reports create — components affected, pages broken, regressions, duplicates, and fix attempts."
        useCases={[
          'See blast radius: click any node to highlight everything it can affect',
          'Find regressions: pick the Regressions view to focus on bugs that reappeared after a fix',
          'Spot fragile components: pick the Fragile components view to surface high-incoming-affects nodes',
          'Audit fix coverage: pick the Fix coverage view to trace fix_verified edges',
        ]}
        howToUse="Use the quick views to focus on a story, or filter manually with the chips. Drag the canvas to pan, scroll to zoom, click any node for its blast radius. Re-layout shakes the graph into a fresh arrangement."
      />

      <QuickViewsRow
        hideSingletons={hideSingletons}
        singletonCount={singletonCount}
        onApplyView={applyView}
        onToggleSingletons={setHideSingletons}
        onRelayout={() => setLayoutSeed((s) => s + 1)}
      />

      {rawNodes.length === 0 ? (
        <SetupNudge
          requires={['first_report_received']}
          emptyTitle="The graph is empty"
          emptyDescription="Nodes and edges populate automatically as the LLM pipeline classifies reports. Submit a report from the dashboard to seed the graph."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-[1fr_18rem]">
          <div className="space-y-2">
            <GraphFilterChips
              search={search}
              onSearchChange={setSearch}
              enabledNodeTypes={enabledNodeTypes}
              enabledEdgeTypes={enabledEdgeTypes}
              onToggleNodeType={toggleNodeType}
              onToggleEdgeType={toggleEdgeType}
            />

            <GraphCanvas
              flowNodes={flowNodes}
              flowEdges={flowEdges}
              filteredCount={filteredNodes.length}
              filteredEdgeCount={filteredEdges.length}
              onNodeClick={onNodeClick}
              onPaneClick={clearSelection}
              onResetView={() => applyView('all')}
              hidden={view !== 'graph'}
            />

            {view === 'table' && (
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
            )}
          </div>

          <GraphSidePanel
            node={selectedNode}
            blastRadius={blastRadius}
            blastLoading={blastLoading}
            onClear={clearSelection}
          />
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <GraphBackendPanel />
        <OntologyPanel />
      </div>

      <GroupsPanel />
    </div>
  )
}

interface ViewModeToggleProps {
  view: ViewMode
  onChange: (v: ViewMode) => void
}

function ViewModeToggle({ view, onChange }: ViewModeToggleProps) {
  return (
    <div
      role="group"
      aria-label="Graph view mode"
      className="inline-flex border border-edge rounded-sm overflow-hidden"
    >
      <button
        type="button"
        onClick={() => onChange('graph')}
        aria-pressed={view === 'graph'}
        className={`px-2 py-0.5 text-2xs ${view === 'graph' ? 'bg-surface-raised text-fg' : 'text-fg-faint hover:text-fg-muted'}`}
      >
        Graph
      </button>
      <button
        type="button"
        onClick={() => onChange('table')}
        aria-pressed={view === 'table'}
        className={`px-2 py-0.5 text-2xs border-l border-edge ${view === 'table' ? 'bg-surface-raised text-fg' : 'text-fg-faint hover:text-fg-muted'}`}
      >
        Table
      </button>
    </div>
  )
}
