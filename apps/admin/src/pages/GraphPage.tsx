import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { apiFetch } from '../lib/supabase'
import { NODE_COLORS } from '../lib/tokens'
import {
  PageHeader,
  PageHelp,
  Card,
  Badge,
  Loading,
  ErrorAlert,
  EmptyState,
  Input,
  RelativeTime,
} from '../components/ui'

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
// changes without state churn.
function layoutNodes(nodes: GraphNode[], edges: GraphEdge[]): Map<string, { x: number; y: number }> {
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
  groupKeys.forEach((key, gi) => {
    const groupNodes = groupBy.get(key)!
    const groupAngle = (2 * Math.PI * gi) / Math.max(1, groupKeys.length)
    const groupCenter = {
      x: center.x + ringRadius * Math.cos(groupAngle),
      y: center.y + ringRadius * Math.sin(groupAngle),
    }
    const innerRadius = Math.max(60, Math.min(220, groupNodes.length * 22))
    groupNodes.forEach((n, ni) => {
      const a = (2 * Math.PI * ni) / Math.max(1, groupNodes.length)
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
  const [rawNodes, setRawNodes] = useState<GraphNode[]>([])
  const [rawEdges, setRawEdges] = useState<GraphEdge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
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

  const loadGraph = useCallback(() => {
    setLoading(true)
    setError(false)
    Promise.all([
      apiFetch<{ nodes: GraphNode[] }>('/v1/admin/graph/nodes'),
      apiFetch<{ edges: GraphEdge[] }>('/v1/admin/graph/edges'),
    ])
      .then(([nodesRes, edgesRes]) => {
        if (nodesRes.ok && edgesRes.ok) {
          setRawNodes(nodesRes.data?.nodes ?? [])
          setRawEdges(edgesRes.data?.edges ?? [])
        } else {
          setError(true)
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadGraph()
  }, [loadGraph])

  const filteredNodes = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rawNodes.filter((n) => {
      if (!enabledNodeTypes.has(n.node_type as NodeType)) return false
      if (q && !n.label.toLowerCase().includes(q)) return false
      return true
    })
  }, [rawNodes, enabledNodeTypes, search])

  const filteredEdges = useMemo(() => {
    const visibleNodeIds = new Set(filteredNodes.map((n) => n.id))
    return rawEdges.filter(
      (e) =>
        enabledEdgeTypes.has(e.edge_type as EdgeType) &&
        visibleNodeIds.has(e.source_node_id) &&
        visibleNodeIds.has(e.target_node_id),
    )
  }, [rawEdges, filteredNodes, enabledEdgeTypes])

  const positions = useMemo(
    () => layoutNodes(filteredNodes, filteredEdges),
    [filteredNodes, filteredEdges],
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

  const onNodeClick: NodeMouseHandler = useCallback(
    (_evt, node) => {
      const original = filteredNodes.find((n) => n.id === node.id) ?? null
      setSelectedNode(original)
      if (!original) {
        setBlastRadius([])
        return
      }
      setBlastLoading(true)
      apiFetch<{ affected: BlastRadiusItem[] }>(
        `/v1/admin/graph/blast-radius/${original.id}`,
      )
        .then((res) => {
          if (res.ok) setBlastRadius(res.data?.affected ?? [])
          else setBlastRadius([])
        })
        .catch(() => setBlastRadius([]))
        .finally(() => setBlastLoading(false))
    },
    [filteredNodes],
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
        message="Failed to load knowledge graph."
        onRetry={loadGraph}
      />
    )

  return (
    <div className="space-y-3">
      <PageHeader title="Knowledge Graph">
        <span className="text-2xs text-fg-faint font-mono">
          {filteredNodes.length}/{rawNodes.length} nodes ·{' '}
          {filteredEdges.length}/{rawEdges.length} edges
        </span>
      </PageHeader>

      <PageHelp
        title="About the Knowledge Graph"
        whatIsIt="A live map of the relationships your bug reports create — components affected, pages broken, regressions, duplicates, and fix attempts."
        useCases={[
          'See blast radius: click any node to highlight everything it can affect',
          'Find regressions: red-tinted edges flag bugs that reappeared after a fix',
          'Spot fragile components: nodes with the most incoming "affects" edges',
          'Audit fix coverage: green "fix_verified" edges trace successful repairs',
        ]}
        howToUse="Filter by node or edge type with the chips below. Click a node to load its blast radius. Use the minimap to navigate; scroll to zoom; drag the canvas to pan."
      />

      {rawNodes.length === 0 ? (
        <EmptyState
          title="The graph is empty"
          description="Nodes and edges populate automatically as the LLM pipeline classifies reports. Submit a report from the dashboard to seed the graph."
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
              style={{ height: 520 }}
            >
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                onNodeClick={onNodeClick}
                onPaneClick={clearSelection}
                fitView
                minZoom={0.2}
                maxZoom={1.6}
                proOptions={{ hideAttribution: true }}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable
                nodeOrigin={[0.5, 0.5]}
                nodeTypes={{ default: ReactFlowChip }}
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
              </ReactFlow>
            </div>
          </div>

          <SidePanel
            node={selectedNode}
            blastRadius={blastRadius}
            blastLoading={blastLoading}
            onClear={clearSelection}
          />
        </div>
      )}
    </div>
  )
}

function ReactFlowChip({ data }: { data: { node: GraphNode; isSelected: boolean } }) {
  return <NodeChip node={data.node} selected={data.isSelected} />
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
