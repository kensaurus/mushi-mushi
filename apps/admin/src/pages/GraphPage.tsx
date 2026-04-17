import { useEffect, useState, useRef, useCallback } from 'react'
import { apiFetch } from '../lib/supabase'
import { NODE_COLORS } from '../lib/tokens'
import { PageHeader, PageHelp, Card, Loading, ErrorAlert, EmptyState } from '../components/ui'

interface GraphNode {
  id: string
  node_type: string
  label: string
  metadata?: Record<string, unknown>
}

interface GraphEdge {
  id: string
  source_node_id: string
  target_node_id: string
  edge_type: string
  weight: number
}

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

export function GraphPage() {
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [blastRadius, setBlastRadius] = useState<Array<{ node_type: string; label: string; min_depth: number }>>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map())

  function loadGraph() {
    setLoading(true)
    setError(false)
    Promise.all([
      apiFetch<{ nodes: GraphNode[] }>('/v1/admin/graph/nodes'),
      apiFetch<{ edges: GraphEdge[] }>('/v1/admin/graph/edges'),
    ]).then(([nodesRes, edgesRes]) => {
      if (nodesRes.ok && edgesRes.ok) {
        setNodes(nodesRes.data?.nodes ?? [])
        setEdges(edgesRes.data?.edges ?? [])
      } else {
        setError(true)
      }
    }).catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadGraph() }, [])

  const drawGraph = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !nodes.length) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    if (positionsRef.current.size !== nodes.length) {
      nodes.forEach((n, i) => {
        const angle = (2 * Math.PI * i) / nodes.length
        const r = Math.min(w, h) * 0.35
        positionsRef.current.set(n.id, {
          x: w / 2 + r * Math.cos(angle),
          y: h / 2 + r * Math.sin(angle),
        })
      })
    }

    for (const edge of edges) {
      const from = positionsRef.current.get(edge.source_node_id)
      const to = positionsRef.current.get(edge.target_node_id)
      if (!from || !to) continue

      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.strokeStyle = 'oklch(0.40 0 0 / 0.4)'
      ctx.lineWidth = Math.max(1, edge.weight)
      ctx.stroke()

      const mx = (from.x + to.x) / 2
      const my = (from.y + to.y) / 2
      ctx.fillStyle = 'oklch(0.55 0 0)'
      ctx.font = '10px system-ui'
      ctx.fillText(EDGE_LABELS[edge.edge_type] ?? edge.edge_type, mx, my)
    }

    for (const node of nodes) {
      const pos = positionsRef.current.get(node.id)
      if (!pos) continue

      ctx.beginPath()
      ctx.arc(pos.x, pos.y, 7, 0, 2 * Math.PI)
      ctx.fillStyle = NODE_COLORS[node.node_type] ?? 'oklch(0.45 0 0)'
      ctx.fill()
      ctx.strokeStyle = selectedNode?.id === node.id ? 'oklch(0.93 0 0)' : 'oklch(0.20 0 0)'
      ctx.lineWidth = selectedNode?.id === node.id ? 2.5 : 1
      ctx.stroke()

      ctx.fillStyle = 'oklch(0.80 0 0)'
      ctx.font = '10px system-ui'
      ctx.fillText(node.label.slice(0, 20), pos.x + 10, pos.y + 3)
    }
  }, [nodes, edges, selectedNode])

  useEffect(() => { drawGraph() }, [drawGraph])

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    for (const node of nodes) {
      const pos = positionsRef.current.get(node.id)
      if (!pos) continue

      if (Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2) < 12) {
        setSelectedNode(node)
        apiFetch<{ affected: Array<{ node_type: string; label: string; min_depth: number }> }>(`/v1/admin/graph/blast-radius/${node.id}`)
          .then(res => setBlastRadius(res.data?.affected ?? []))
        return
      }
    }
    setSelectedNode(null)
    setBlastRadius([])
  }, [nodes])

  if (loading) return <Loading text="Loading graph..." />
  if (error) return <ErrorAlert message="Failed to load knowledge graph." onRetry={loadGraph} />

  return (
    <div className="space-y-3">
      <PageHeader title="Knowledge Graph">
        <span className="text-2xs text-fg-faint font-mono">{nodes.length} nodes · {edges.length} edges</span>
      </PageHeader>

      <PageHelp
        title="About the Knowledge Graph"
        whatIsIt="A visual map connecting bug reports to the components, pages, and versions they affect. Edges show relationships like causes, regressions, duplicates, and fix attempts."
        useCases={[
          'Find regressions: bugs that started after a specific release',
          'See blast radius: which pages or components are most fragile',
          'Spot duplicates and related issues that should be triaged together',
          'Understand which fix attempts succeeded or failed for a bug group',
        ]}
        howToUse="Click any node to see its blast radius — the related entities reachable via edges. The graph populates automatically as reports are classified by the LLM pipeline."
      />

      {nodes.length === 0 ? (
        <EmptyState
          title="The graph is empty"
          description="Nodes and edges appear automatically once the classification pipeline processes bug reports. Submit a report from the dashboard to seed the graph."
        />
      ) : (
        <>
          <div className="flex gap-2 text-2xs text-fg-muted">
            {Object.entries(NODE_COLORS).map(([type, color]) => (
              <span key={type} className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: color }} />
                {type}
              </span>
            ))}
          </div>

          <div className="flex gap-3">
            <canvas
              ref={canvasRef}
              width={800}
              height={460}
              className="border border-edge rounded-md bg-surface-root cursor-pointer"
              onClick={handleCanvasClick}
            />

            {selectedNode && (
          <Card className="w-56 p-3 space-y-2 self-start">
            <h3 className="text-sm font-medium text-fg">{selectedNode.label}</h3>
            <p className="text-2xs text-fg-muted">Type: {selectedNode.node_type}</p>
            <p className="text-2xs text-fg-faint font-mono">ID: {selectedNode.id.slice(0, 8)}…</p>

            {blastRadius.length > 0 && (
              <div className="border-t border-edge-subtle pt-2">
                <h4 className="text-xs text-fg-secondary font-medium mb-1">Blast Radius</h4>
                <ul className="text-2xs text-fg-muted space-y-0.5">
                  {blastRadius.map((b, i) => (
                    <li key={i} className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: NODE_COLORS[b.node_type] ?? 'oklch(0.45 0 0)' }} />
                      {b.label} <span className="text-fg-faint">(depth {b.min_depth})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}
          </div>
        </>
      )}
    </div>
  )
}
