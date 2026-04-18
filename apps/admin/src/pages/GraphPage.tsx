import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import { NODE_COLORS } from '../lib/tokens'
import {
  PageHeader,
  PageHelp,
  Card,
  Badge,
  Loading,
  ErrorAlert,
  Input,
  RelativeTime,
} from '../components/ui'
import { SetupNudge } from '../components/SetupNudge'
import { GraphBackendPanel } from '../components/graph/GraphBackendPanel'
import { OntologyPanel } from '../components/graph/OntologyPanel'
import { GroupsPanel } from '../components/graph/GroupsPanel'

interface GraphNode {
  id: string
  node_type: string
  label: string
  metadata?: Record<string, unknown> | null
  last_traversed_at?: string | null
  created_at?: string | null
}

interface GraphEdge {
  id: string
  source_node_id: string
  target_node_id: string
  edge_type: string
  weight: number
}

interface BlastRadiusItem {
  target_node_id?: string
  node_id?: string
  node_type: string
  label: string
  min_depth: number
}

const EDGE_TYPES = [
  'causes',
  'related_to',
  'regression_of',
  'duplicate_of',
  'affects',
  'fix_attempted',
  'fix_applied',
  'fix_verified',
] as const
type EdgeType = (typeof EDGE_TYPES)[number]

const EDGE_LABELS: Record<string, string> = {
  causes: 'causes',
  related_to: 'related',
  regression_of: 'regression',
  duplicate_of: 'duplicate',
  affects: 'affects',
  fix_attempted: 'fix attempted',
  fix_applied: 'fix applied',
  fix_verified: 'fix verified',
}

const NODE_TYPES = ['report_group', 'component', 'page', 'version'] as const
type NodeType = (typeof NODE_TYPES)[number]

const NODE_TYPE_LABELS: Record<string, string> = {
  report_group: 'Report group',
  component: 'Component',
  page: 'Page',
  version: 'Version',
}

// Force-directed layout: simple deterministic positioning via spectral seed +
// iterative repulsion. Pure function so reactflow can re-layout on filter
// changes without state churn. The `seed` argument lets the "Re-layout"
// button shake the graph into a new arrangement without changing data.
function layoutNodes(nodes: GraphNode[], edges: GraphEdge[], seed = 0): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  if (nodes.length === 0) return positions

  const groupBy = new Map<string, GraphNode[]>()
  for (const n of nodes) {
    const k = n.node_type
    if (!groupBy.has(k)) groupBy.set(k, [])
    groupBy.get(k)!.push(n)
  }

  // Place each node-type cluster on a circle ring around the canvas center.
  const center = { x: 0, y: 0 }
  const ringRadius = 420
  const groupKeys = [...groupBy.keys()]
  const seedOffset = (seed * Math.PI) / 7
  groupKeys.forEach((key, gi) => {
    const groupNodes = groupBy.get(key)!
    const groupAngle = (2 * Math.PI * gi) / Math.max(1, groupKeys.length) + seedOffset
    const groupCenter = {
      x: center.x + ringRadius * Math.cos(groupAngle),
      y: center.y + ringRadius * Math.sin(groupAngle),
    }
    const innerRadius = Math.max(60, Math.min(220, groupNodes.length * 22))
    groupNodes.forEach((n, ni) => {
      const a = (2 * Math.PI * ni) / Math.max(1, groupNodes.length) + seedOffset * 0.3
      positions.set(n.id, {
        x: groupCenter.x + innerRadius * Math.cos(a),
        y: groupCenter.y + innerRadius * Math.sin(a),
      })
    })
  })

  // Light edge attraction pass: pull connected nodes ~5% toward each other.
  for (let pass = 0; pass < 8; pass++) {
    for (const e of edges) {
      const a = positions.get(e.source_node_id)
      const b = positions.get(e.target_node_id)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const move = 0.04
      a.x += dx * move
      a.y += dy * move
      b.x -= dx * move
      b.y -= dy * move
    }
  }

  return positions
}

function nodeMetadataValue(n: GraphNode, key: string): string | number | null {
  const meta = n.metadata as Record<string, unknown> | null | undefined
  if (!meta) return null
  const v = meta[key]
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number') return v
  return null
}

function nodeShape(node_type: string): string {
  // Visually distinguish report_groups (incident clusters) from
  // structural nodes (component/page) — squarer for groups, rounded for
  // structure. Done with className not style so dark/light themes work.
  if (node_type === 'report_group') return 'rounded-md'
  return 'rounded-full'
}

function NodeChip({ node, selected }: { node: GraphNode; selected: boolean }) {
  const occ = nodeMetadataValue(node, 'occurrence_count')
  const color = NODE_COLORS[node.node_type] ?? 'oklch(0.55 0 0)'
  const ring = selected ? 'ring-2 ring-fg shadow-raised' : 'ring-1 ring-edge'
  const shape = nodeShape(node.node_type)
  return (
    <div
      className={`px-2.5 py-1 text-2xs leading-tight font-medium text-fg bg-surface-raised ${shape} ${ring} max-w-[200px]`}
      title={`${NODE_TYPE_LABELS[node.node_type] ?? node.node_type}: ${node.label}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-2 !h-2" />
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <span className="truncate">{node.label}</span>
        {occ != null && (
          <span className="text-3xs text-fg-faint font-mono shrink-0">×{occ}</span>
        )}
      </div>
    </div>
  )
}

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
  const [enabledNodeTypes, setEnabledNodeTypes] = useState<Set<NodeType>>(
    new Set(NODE_TYPES),
  )
  const [enabledEdgeTypes, setEnabledEdgeTypes] = useState<Set<EdgeType>>(
    new Set(EDGE_TYPES),
  )
  const [view, setView] = useState<'graph' | 'table'>('graph')
  const [hideSingletons, setHideSingletons] = useState(true)
  const [layoutSeed, setLayoutSeed] = useState(0)
  const [hintDismissed, setHintDismissed] = useState(false)

  // Auto-fade the pan/zoom hint after 6s. Stored in localStorage so it doesn't
  // re-appear every refresh once the user has seen it.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem('mushi.graph.hintSeen') === '1') {
      setHintDismissed(true)
      return
    }
    const t = setTimeout(() => {
      setHintDismissed(true)
      window.localStorage.setItem('mushi.graph.hintSeen', '1')
    }, 6000)
    return () => clearTimeout(t)
  }, [])

  const dismissHint = () => {
    setHintDismissed(true)
    if (typeof window !== 'undefined') window.localStorage.setItem('mushi.graph.hintSeen', '1')
  }

  // Pre-baked filter views — flip filter sets to highlight a specific story.
  // Reset selection so the side-panel doesn't show a stale node from a
  // different filter context.
  const applyView = (preset: 'all' | 'regressions' | 'fragile' | 'fixes') => {
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
  }

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
        labelStyle: {
          fontSize: 10,
          fill: 'oklch(0.65 0 0)',
        },
        labelBgStyle: {
          fill: 'oklch(0.18 0 0)',
        },
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

  const clearSelection = () => {
    setSelectedNode(null)
    setBlastRadius([])
  }

  const toggleEdgeType = (et: EdgeType) => {
    setEnabledEdgeTypes((prev) => {
      const next = new Set(prev)
      if (next.has(et)) next.delete(et)
      else next.add(et)
      return next
    })
  }

  const toggleNodeType = (nt: NodeType) => {
    setEnabledNodeTypes((prev) => {
      const next = new Set(prev)
      if (next.has(nt)) next.delete(nt)
      else next.add(nt)
      return next
    })
  }

  if (loading) return <Loading text="Loading graph…" />
  if (error)
    return (
      <ErrorAlert
        message={`Failed to load knowledge graph: ${error}`}
        onRetry={reloadGraph}
      />
    )

  return (
    <div className="space-y-3">
      <PageHeader title="Knowledge Graph">
        <div className="flex items-center gap-2">
          <span className="text-2xs text-fg-faint font-mono">
            {filteredNodes.length}/{rawNodes.length} nodes ·{' '}
            {filteredEdges.length}/{rawEdges.length} edges
          </span>
          <div role="group" aria-label="Graph view mode" className="inline-flex border border-edge rounded-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setView('graph')}
              aria-pressed={view === 'graph'}
              className={`px-2 py-0.5 text-2xs ${view === 'graph' ? 'bg-surface-raised text-fg' : 'text-fg-faint hover:text-fg-muted'}`}
            >
              Graph
            </button>
            <button
              type="button"
              onClick={() => setView('table')}
              aria-pressed={view === 'table'}
              className={`px-2 py-0.5 text-2xs border-l border-edge ${view === 'table' ? 'bg-surface-raised text-fg' : 'text-fg-faint hover:text-fg-muted'}`}
            >
              Table
            </button>
          </div>
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

      <div className="flex flex-wrap gap-1.5 mb-2 items-center">
        <span className="text-2xs text-fg-faint uppercase tracking-wider mr-1">Quick views:</span>
        {([
          { key: 'all', label: 'All' },
          { key: 'regressions', label: 'Regressions' },
          { key: 'fragile', label: 'Fragile components' },
          { key: 'fixes', label: 'Fix coverage' },
        ] as const).map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => applyView(v.key)}
            className="px-2 py-0.5 rounded-sm text-2xs border border-edge-subtle bg-surface-raised/50 text-fg-secondary hover:bg-surface-overlay hover:text-fg motion-safe:transition-colors"
          >
            {v.label}
          </button>
        ))}
        <span className="ml-auto inline-flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-2xs text-fg-muted">
            <input
              type="checkbox"
              checked={hideSingletons}
              onChange={(e) => setHideSingletons(e.target.checked)}
              className="h-3 w-3 accent-brand"
            />
            Hide isolated nodes{singletonCount > 0 ? ` (${singletonCount})` : ''}
          </label>
          <button
            type="button"
            onClick={() => setLayoutSeed((s) => s + 1)}
            className="px-2 py-0.5 rounded-sm text-2xs border border-edge-subtle bg-surface-raised/50 text-fg-secondary hover:bg-surface-overlay hover:text-fg"
            title="Shuffle node positions"
          >
            ↻ Re-layout
          </button>
        </span>
      </div>

      {rawNodes.length === 0 ? (
        <SetupNudge
          requires={['first_report_received']}
          emptyTitle="The graph is empty"
          emptyDescription="Nodes and edges populate automatically as the LLM pipeline classifies reports. Submit a report from the dashboard to seed the graph."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-[1fr_18rem]">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Search node label…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-64"
              />
              <div className="flex flex-wrap gap-1">
                {NODE_TYPES.map((nt) => {
                  const active = enabledNodeTypes.has(nt)
                  return (
                    <button
                      key={nt}
                      type="button"
                      onClick={() => toggleNodeType(nt)}
                      className={`px-2 py-0.5 rounded-sm text-2xs border ${
                        active
                          ? 'border-edge bg-surface-raised text-fg'
                          : 'border-edge-subtle bg-transparent text-fg-faint'
                      }`}
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full mr-1 align-middle"
                        style={{ backgroundColor: NODE_COLORS[nt] }}
                      />
                      {NODE_TYPE_LABELS[nt]}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-1">
              {EDGE_TYPES.map((et) => {
                const active = enabledEdgeTypes.has(et)
                return (
                  <button
                    key={et}
                    type="button"
                    onClick={() => toggleEdgeType(et)}
                    className={`px-2 py-0.5 rounded-sm text-3xs border font-mono ${
                      active
                        ? 'border-edge bg-surface-raised text-fg-secondary'
                        : 'border-edge-subtle bg-transparent text-fg-faint'
                    }`}
                  >
                    {EDGE_LABELS[et]}
                  </button>
                )
              })}
            </div>

            <div
              className="border border-edge rounded-md bg-surface-root"
              style={{ height: 'calc(100vh - 280px)', minHeight: 520, display: view === 'graph' ? 'block' : 'none' }}
              role="region"
              aria-label={`Knowledge graph visualization with ${filteredNodes.length} nodes and ${filteredEdges.length} edges. Switch to Table view for a screen-reader-friendly list.`}
              tabIndex={0}
            >
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                onNodeClick={onNodeClick}
                onPaneClick={clearSelection}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.15}
                maxZoom={2}
                proOptions={{ hideAttribution: true }}
                nodesDraggable
                nodesConnectable={false}
                elementsSelectable
                panOnDrag
                panOnScroll={false}
                zoomOnScroll
                nodeOrigin={[0.5, 0.5]}
                nodeTypes={{ default: ReactFlowChip }}
                aria-label="Knowledge graph nodes and edges. Use Tab to focus, Enter or Space to select a node and load its blast radius."
              >
                <Background gap={24} color="oklch(0.30 0 0)" />
                <Controls position="bottom-right" showInteractive={false} />
                <MiniMap
                  pannable
                  zoomable
                  nodeColor={(n) => {
                    const data = n.data as { node?: GraphNode } | undefined
                    return NODE_COLORS[data?.node?.node_type ?? ''] ?? 'oklch(0.45 0 0)'
                  }}
                  maskColor="oklch(0.10 0 0 / 0.6)"
                  style={{ background: 'oklch(0.14 0 0)' }}
                />
                {!hintDismissed && (
                  <Panel position="top-center">
                    <div className="flex items-center gap-2 rounded-md border border-edge bg-surface-raised/95 backdrop-blur px-3 py-1.5 text-2xs text-fg-secondary shadow-raised">
                      <span aria-hidden="true">🖱️</span>
                      <span>Drag to pan · scroll to zoom · click a node for blast radius</span>
                      <button
                        type="button"
                        onClick={dismissHint}
                        className="ml-2 text-fg-faint hover:text-fg text-xs leading-none"
                        aria-label="Dismiss hint"
                      >
                        ✕
                      </button>
                    </div>
                  </Panel>
                )}
                <Panel position="bottom-left">
                  <GraphLegend />
                </Panel>
                {filteredNodes.length === 0 && (
                  <Panel position="top-center">
                    <div className="rounded-md border border-edge bg-surface-raised/95 backdrop-blur px-3 py-2 text-2xs text-fg-secondary shadow-raised max-w-sm text-center">
                      <div className="font-medium text-fg mb-0.5">No nodes match these filters</div>
                      <div className="text-fg-muted">
                        Try the <button type="button" onClick={() => applyView('all')} className="underline hover:text-fg">All</button> view, enable more node/edge types, or uncheck "Hide isolated nodes".
                      </div>
                    </div>
                  </Panel>
                )}
              </ReactFlow>
            </div>

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

          <SidePanel
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

function ReactFlowChip({ data }: { data: { node: GraphNode; isSelected: boolean } }) {
  return <NodeChip node={data.node} selected={data.isSelected} />
}

const LEGEND_EDGE_COLORS: Array<{ key: string; label: string; color: string }> = [
  { key: 'regression_of', label: 'regression', color: 'oklch(0.65 0.22 25)' },
  { key: 'fix_verified', label: 'fix verified', color: 'oklch(0.72 0.19 155)' },
  { key: 'related', label: 'other', color: 'oklch(0.50 0 0)' },
]

// In-canvas legend so a first-time visitor can decode the colors without
// opening the help drawer. Collapsed by default to stay out of the way; the
// summary line still shows the highest-signal info (node-type swatches).
function GraphLegend() {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-edge-subtle bg-surface-raised/95 backdrop-blur shadow-raised text-2xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2.5 py-1.5 text-fg-secondary hover:text-fg w-full"
        aria-expanded={open}
      >
        <span className="font-medium">Legend</span>
        <span className="inline-flex items-center gap-1">
          {NODE_TYPES.map((nt) => (
            <span
              key={nt}
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: NODE_COLORS[nt] }}
              aria-hidden="true"
            />
          ))}
        </span>
        <span className="text-fg-faint">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2 pt-0 space-y-1.5 border-t border-edge-subtle">
          <div>
            <div className="text-3xs uppercase tracking-wider text-fg-faint mt-1.5 mb-0.5">Nodes</div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
              {NODE_TYPES.map((nt) => (
                <div key={nt} className="flex items-center gap-1.5 text-fg-muted">
                  <span
                    className="w-2 h-2 rounded-full inline-block"
                    style={{ backgroundColor: NODE_COLORS[nt] }}
                    aria-hidden="true"
                  />
                  {NODE_TYPE_LABELS[nt]}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-3xs uppercase tracking-wider text-fg-faint mb-0.5">Edges</div>
            <div className="space-y-0.5">
              {LEGEND_EDGE_COLORS.map((e) => (
                <div key={e.key} className="flex items-center gap-1.5 text-fg-muted">
                  <span
                    className="inline-block h-px w-4"
                    style={{ backgroundColor: e.color, height: 2 }}
                    aria-hidden="true"
                  />
                  {e.label}
                </div>
              ))}
              <div className="flex items-center gap-1.5 text-fg-muted">
                <span className="text-3xs font-mono text-fg-faint">∿</span>
                animated = fix attempted
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface GraphTableViewProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedNodeId: string | null
  blastRadiusIds: Set<string>
  onSelect: (node: GraphNode) => void
}

// Screen-reader-friendly fallback for the React Flow canvas. Renders the
// graph as two paired tables (nodes + edges) keyed by stable IDs so AT can
// announce relationships and keyboard users can focus and select nodes.
function GraphTableView({ nodes, edges, selectedNodeId, blastRadiusIds, onSelect }: GraphTableViewProps) {
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  return (
    <div className="grid gap-3 md:grid-cols-2" role="region" aria-label="Knowledge graph table view">
      <Card className="p-2">
        <h3 className="text-2xs uppercase tracking-wider text-fg-faint mb-2 px-1">
          Nodes ({nodes.length})
        </h3>
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-2xs" aria-label="Graph nodes">
            <thead className="text-fg-faint sticky top-0 bg-surface-raised">
              <tr>
                <th scope="col" className="text-left font-medium px-1 py-1">Type</th>
                <th scope="col" className="text-left font-medium px-1 py-1">Label</th>
                <th scope="col" className="text-right font-medium px-1 py-1">Occ.</th>
                <th scope="col" className="sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => {
                const occ = nodeMetadataValue(n, 'occurrence_count')
                const isSelected = selectedNodeId === n.id
                const inBlast = blastRadiusIds.has(n.id)
                return (
                  <tr
                    key={n.id}
                    className={`border-t border-edge-subtle ${isSelected ? 'bg-surface-overlay' : inBlast ? 'bg-warn/5' : ''}`}
                  >
                    <td className="px-1 py-1 text-fg-muted">{NODE_TYPE_LABELS[n.node_type] ?? n.node_type}</td>
                    <td className="px-1 py-1 text-fg break-words">{n.label}</td>
                    <td className="px-1 py-1 text-right font-mono text-fg-faint">{occ ?? '—'}</td>
                    <td className="px-1 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => onSelect(n)}
                        aria-pressed={isSelected}
                        className="text-2xs text-brand hover:text-brand-hover px-1"
                      >
                        Select
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-2">
        <h3 className="text-2xs uppercase tracking-wider text-fg-faint mb-2 px-1">
          Edges ({edges.length})
        </h3>
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-2xs" aria-label="Graph edges">
            <thead className="text-fg-faint sticky top-0 bg-surface-raised">
              <tr>
                <th scope="col" className="text-left font-medium px-1 py-1">From</th>
                <th scope="col" className="text-left font-medium px-1 py-1">Relation</th>
                <th scope="col" className="text-left font-medium px-1 py-1">To</th>
                <th scope="col" className="text-right font-medium px-1 py-1">Wt.</th>
              </tr>
            </thead>
            <tbody>
              {edges.map((e) => {
                const src = nodesById.get(e.source_node_id)
                const tgt = nodesById.get(e.target_node_id)
                return (
                  <tr key={e.id} className="border-t border-edge-subtle">
                    <td className="px-1 py-1 text-fg break-words">{src?.label ?? e.source_node_id}</td>
                    <td className="px-1 py-1 text-fg-muted font-mono">{EDGE_LABELS[e.edge_type] ?? e.edge_type}</td>
                    <td className="px-1 py-1 text-fg break-words">{tgt?.label ?? e.target_node_id}</td>
                    <td className="px-1 py-1 text-right font-mono text-fg-faint">{e.weight}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

interface SidePanelProps {
  node: GraphNode | null
  blastRadius: BlastRadiusItem[]
  blastLoading: boolean
  onClear: () => void
}

function SidePanel({ node, blastRadius, blastLoading, onClear }: SidePanelProps) {
  if (!node) {
    return (
      <Card className="p-3 self-start">
        <p className="text-xs text-fg-muted">
          Click any node to inspect it and load its blast radius.
        </p>
      </Card>
    )
  }
  const occ = nodeMetadataValue(node, 'occurrence_count')
  const reportLink =
    node.node_type === 'component'
      ? `/reports?component=${encodeURIComponent(node.label)}`
      : node.node_type === 'page'
        ? `/reports?url=${encodeURIComponent(node.label)}`
        : null

  return (
    <Card className="p-3 self-start space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-2xs uppercase tracking-wider text-fg-faint">
            {NODE_TYPE_LABELS[node.node_type] ?? node.node_type}
          </div>
          <h3 className="text-sm font-medium text-fg break-words">{node.label}</h3>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-2xs text-fg-faint hover:text-fg-muted px-1.5 py-0.5"
          aria-label="Clear selection"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-2xs">
        {occ != null && (
          <div>
            <div className="text-fg-faint">Occurrences</div>
            <div className="font-mono text-fg">{occ}</div>
          </div>
        )}
        {node.last_traversed_at && (
          <div>
            <div className="text-fg-faint">Last seen</div>
            <div className="text-fg-secondary">
              <RelativeTime value={node.last_traversed_at} />
            </div>
          </div>
        )}
        {node.created_at && (
          <div>
            <div className="text-fg-faint">First seen</div>
            <div className="text-fg-secondary">
              <RelativeTime value={node.created_at} />
            </div>
          </div>
        )}
        <div className="col-span-2">
          <div className="text-fg-faint">Node id</div>
          <div className="font-mono text-fg-secondary break-all">{node.id}</div>
        </div>
      </div>

      {reportLink && (
        <Link
          to={reportLink}
          className="inline-block text-xs text-brand hover:text-brand-hover"
        >
          View related reports →
        </Link>
      )}

      <div className="border-t border-edge-subtle pt-2">
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-xs font-medium text-fg-secondary">Blast radius</h4>
          {blastRadius.length > 0 && (
            <Badge className="bg-surface-overlay text-fg-muted text-3xs">
              {blastRadius.length}
            </Badge>
          )}
        </div>
        {blastLoading ? (
          <p className="text-2xs text-fg-faint">Computing…</p>
        ) : blastRadius.length === 0 ? (
          <p className="text-2xs text-fg-faint">
            Nothing downstream — this node doesn't propagate via causes/affects/related_to.
          </p>
        ) : (
          <ul className="text-2xs text-fg-muted space-y-0.5 max-h-56 overflow-y-auto">
            {blastRadius.map((b, i) => (
              <li key={i} className="flex items-center gap-1">
                <span
                  className="w-2 h-2 rounded-full inline-block shrink-0"
                  style={{
                    backgroundColor:
                      NODE_COLORS[b.node_type] ?? 'oklch(0.45 0 0)',
                  }}
                />
                <span className="truncate">{b.label}</span>
                <span className="text-fg-faint font-mono shrink-0">
                  d{b.min_depth}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
