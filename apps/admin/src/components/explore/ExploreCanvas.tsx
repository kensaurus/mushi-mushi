import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Handle,
  Position,
  ReactFlow,
  Background,
  MiniMap,
  Panel,
  useReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import { useTheme } from '../../lib/useTheme'
import { extBadgeColor, exploreNodeChrome } from '../../lib/vizTokens'
import type { ExploreLayer, ExploreNode } from './exploreTypes'
import { LAYER_COLORS, LAYER_LABELS, LAYER_ORDER } from './exploreLayers'

/** Extracts the file extension without the dot */
function fileExt(path: string): string {
  const m = path.match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toLowerCase() : ''
}

/** Last two path segments minus the filename */
function dirContext(path: string): string {
  const parts = path.split('/')
  if (parts.length <= 2) return ''
  return parts.slice(-3, -1).join('/')
}

function ExploreNodeChip({
  data,
}: {
  data: { node: ExploreNode; isSelected: boolean; isDimmed: boolean; theme: 'dark' | 'light' }
}) {
  const { node, isSelected, isDimmed, theme } = data
  const layer = (node.metadata.layer as ExploreLayer) ?? 'other'
  const color = LAYER_COLORS[layer] ?? LAYER_COLORS.other
  const ext = fileExt(node.metadata.file_path)
  const extColor = extBadgeColor(ext)
  const dir = dirContext(node.metadata.file_path)
  const chrome = exploreNodeChrome(theme, isSelected)
  const nodeBg = chrome.nodeBg
  const textColor = chrome.textColor
  const subTextColor = chrome.subTextColor
  const borderColor = isSelected ? `${color}bb` : chrome.borderColor

  return (
    <div
      style={{
        opacity: isDimmed ? 0.15 : 1,
        borderLeft: `3px solid ${color}`,
        borderTop: `1px solid ${borderColor}`,
        borderRight: `1px solid ${borderColor}`,
        borderBottom: `1px solid ${borderColor}`,
        background: isSelected ? chrome.selectedBg : nodeBg,
        transition: 'opacity 0.15s, box-shadow 0.15s',
        boxShadow: isSelected
          ? `0 0 0 2px ${color}50, 0 2px 12px oklch(0 0 0 / 0.40)`
          : `0 1px 3px oklch(0 0 0 / ${theme === 'dark' ? '0.50' : '0.07'})`,
        borderRadius: '0 5px 5px 0',
      }}
      className="pl-2 pr-2.5 py-1.5 text-2xs leading-tight font-medium max-w-[210px]"
      title={`${LAYER_LABELS[layer]} · ${node.metadata.file_path}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-0 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-transparent !border-0 !w-2 !h-2" />
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="truncate flex-1" style={{ color: textColor }}>{node.label}</span>
        {ext && (
          <span
            className="shrink-0 text-3xs font-mono px-1 py-px rounded-sm"
            style={{ color: extColor, backgroundColor: `${extColor}20` }}
          >
            .{ext}
          </span>
        )}
      </div>
      {dir && (
        <div className="text-3xs font-mono truncate mt-0.5" style={{ color: subTextColor }}>{dir}/</div>
      )}
    </div>
  )
}

/** Floating layer column header — rendered above each layer group in the graph */
function LayerHeaderNode({
  data,
}: {
  data: { label: string; count: number; color: string; layer: string }
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        backgroundColor: `${data.color}14`,
        border: `1px solid ${data.color}50`,
        borderRadius: '5px',
        padding: '3px 10px 3px 8px',
        fontSize: 'var(--text-3xs)',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        color: data.color,
        letterSpacing: '0.01em',
        boxShadow: `0 0 0 1px ${data.color}18`,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          backgroundColor: data.color,
          display: 'inline-block',
          flexShrink: 0,
        }}
        aria-hidden="true"
      />
      {data.label}
      <span style={{ fontWeight: 400, opacity: 0.65, fontSize: 'var(--text-3xs)', marginLeft: 2 }}>
        {data.count}
      </span>
    </div>
  )
}

const EXPLORE_NODE_TYPES = {
  default: ExploreNodeChip,
  layerHeader: LayerHeaderNode,
} as const

const CANVAS_BG = {
  dark:  'oklch(0.11 0.004 265)',
  light: 'oklch(0.97 0.004 265)',
} as const

const DOT_GRID_COLORS = {
  dark:  'oklch(0.28 0 0)',
  light: 'oklch(0.84 0.004 285)',
} as const

const HINT_KEY = 'mushi.explore.hintSeen'

function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const btn =
    'flex items-center justify-center w-7 h-7 text-fg-secondary hover:text-fg hover:bg-surface-overlay motion-safe:transition-colors'
  return (
    <div className="flex flex-col rounded-md border border-edge/70 bg-surface-raised/90 backdrop-blur shadow-raised overflow-hidden">
      <button type="button" onClick={() => zoomIn({ duration: 200 })} className={`${btn} border-b border-edge/50`} aria-label="Zoom in" title="Zoom in">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <path d="M6.5 2v9M2 6.5h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <button type="button" onClick={() => zoomOut({ duration: 200 })} className={`${btn} border-b border-edge/50`} aria-label="Zoom out" title="Zoom out">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <path d="M2 6.5h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <button type="button" onClick={() => fitView({ duration: 300, padding: 0.12 })} className={btn} aria-label="Fit view" title="Fit view">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <path d="M2 4.5V2h2.5M11 4.5V2H8.5M2 8.5V11h2.5M11 8.5V11H8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}

function LayerLegend({ layerCounts }: { layerCounts?: Record<string, number> }) {
  const [open, setOpen] = useState(false)
  const total = layerCounts ? Object.values(layerCounts).reduce((s, n) => s + n, 0) : 0
  return (
    <div className="rounded-md border border-edge-subtle bg-surface-raised/95 backdrop-blur shadow-raised text-2xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2.5 py-1.5 text-fg-secondary hover:text-fg w-full"
        aria-expanded={open}
      >
        <span className="font-medium">Layers</span>
        <span className="inline-flex items-center gap-1">
          {LAYER_ORDER.map((l) => (
            <span key={l} className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: LAYER_COLORS[l] }} aria-hidden="true" />
          ))}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" className={`text-fg-faint transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="px-2.5 pb-2 pt-0 space-y-0.5 border-t border-edge-subtle">
          <div className="text-3xs uppercase tracking-wider text-fg-faint mt-1.5 mb-1">Architectural layer</div>
          {LAYER_ORDER.map((l) => {
            const count = layerCounts?.[l] ?? 0
            const pct = total > 0 ? (count / total) * 100 : 0
            return (
              <div key={l} className="flex items-center gap-1.5 text-fg-muted">
                <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: LAYER_COLORS[l] }} aria-hidden="true" />
                <span className="flex-1">{LAYER_LABELS[l]}</span>
                {count > 0 && (
                  <>
                    <span className="text-fg-faint tabular-nums">{count}</span>
                    <div className="w-10 h-1 rounded-full bg-surface-overlay overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: LAYER_COLORS[l] }} />
                    </div>
                  </>
                )}
              </div>
            )
          })}
          <div className="mt-1 pt-1 border-t border-edge-subtle text-fg-faint flex items-center gap-1.5">
            <svg width="16" height="6" viewBox="0 0 16 6" fill="none" aria-hidden="true">
              <path d="M1 3h12" stroke="oklch(0.50 0 0)" strokeWidth="1.2" strokeOpacity="0.6" />
              <path d="M11 1l2 2-2 2" stroke="oklch(0.50 0 0)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.6" />
            </svg>
            import edge
          </div>
        </div>
      )}
    </div>
  )
}

interface Props {
  flowNodes: Node[]
  flowEdges: Edge[]
  nodeCount: number
  edgeCount: number
  onNodeClick: NodeMouseHandler
  onPaneClick: () => void
  layerCounts?: Record<string, number>
}

function FitViewOnLoad({ nodeCount }: { nodeCount: number }) {
  const { fitView } = useReactFlow()
  const fittedRef = useRef(false)
  useEffect(() => {
    if (nodeCount > 0 && !fittedRef.current) {
      fittedRef.current = true
      // No minZoom constraint — let ReactFlow fit all content naturally
      setTimeout(() => fitView({ duration: 500, padding: 0.08 }), 100)
    }
    if (nodeCount === 0) fittedRef.current = false
  }, [nodeCount, fitView])
  return null
}

function InnerCanvas({
  flowNodes,
  flowEdges,
  nodeCount,
  edgeCount,
  onNodeClick,
  onPaneClick,
  layerCounts,
}: Props) {
  const [hintDismissed, setHintDismissed] = useState(false)
  const { resolved } = useTheme()
  const dotGrid = DOT_GRID_COLORS[resolved]

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem(HINT_KEY) === '1') { setHintDismissed(true); return }
    const t = setTimeout(() => { setHintDismissed(true); window.localStorage.setItem(HINT_KEY, '1') }, 6000)
    return () => clearTimeout(t)
  }, [])

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      minZoom={0.12}
      maxZoom={2.5}
      proOptions={{ hideAttribution: true }}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable
      panOnDrag
      panOnScroll={false}
      zoomOnScroll
      nodeOrigin={[0, 0]}
      nodeTypes={EXPLORE_NODE_TYPES}
      style={{ background: CANVAS_BG[resolved] }}
    >
      <FitViewOnLoad nodeCount={nodeCount} />
      <Background gap={24} color={dotGrid} />
      <MiniMap
        nodeColor={(node) => {
          const d = node.data as { node?: { metadata?: { layer?: string } }; color?: string }
          if (d?.color) return d.color
          const layer = d?.node?.metadata?.layer as string | undefined
          return (LAYER_COLORS as Record<string, string>)[layer ?? ''] ?? LAYER_COLORS.other
        }}
        maskColor={resolved === 'dark' ? 'oklch(0.12 0 0 / 0.7)' : 'oklch(0.96 0 0 / 0.7)'}
        position="top-right"
        style={{
          background: resolved === 'dark' ? 'oklch(0.14 0 0 / 0.90)' : 'oklch(0.98 0 0 / 0.90)',
          border: '1px solid oklch(0.5 0 0 / 0.18)',
          borderRadius: '6px',
        }}
        pannable
        zoomable
        ariaLabel="Minimap"
      />
      <Panel position="bottom-right">
        <ZoomControls />
      </Panel>
      <Panel position="bottom-left">
        <LayerLegend layerCounts={layerCounts} />
      </Panel>

      <Panel position="top-left">
        <div className="flex items-center gap-1.5 rounded-md border border-edge-subtle bg-surface-raised/90 backdrop-blur px-2.5 py-1 text-3xs text-fg-faint shadow-raised tabular-nums">
          <span>{nodeCount.toLocaleString()} files</span>
          {edgeCount > 0
            ? (
              <>
                <span className="text-fg-faint/50">·</span>
                <span>{edgeCount.toLocaleString()} edges</span>
              </>
            )
            : nodeCount > 0 && (
              <>
                <span className="text-fg-faint/50">·</span>
                <span className="text-fg-faint italic">no import edges</span>
              </>
            )
          }
        </div>
      </Panel>

      {!hintDismissed && (
        <Panel position="top-center">
          <div className="flex items-center gap-2 rounded-md border border-edge bg-surface-raised/95 backdrop-blur px-3 py-1.5 text-2xs text-fg-secondary shadow-raised">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-fg-faint" aria-hidden="true">
              <path d="M3 5l5-3 5 3v6l-5 3-5-3V5z" />
            </svg>
            <span>Drag to pan · scroll to zoom · click a file for details</span>
            <button
              type="button"
              onClick={() => { setHintDismissed(true); window.localStorage.setItem(HINT_KEY, '1') }}
              className="ml-1 rounded-sm px-1 text-danger hover:bg-danger-muted/50 leading-none"
              aria-label="Dismiss hint"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M2 2l6 6M8 2l-6 6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </Panel>
      )}
      {nodeCount === 0 && (
        <Panel position="top-center">
          <div className="rounded-md border border-edge bg-surface-raised/95 backdrop-blur px-3 py-2 text-2xs text-fg-secondary shadow-raised max-w-sm text-center">
            <div className="font-medium text-fg mb-0.5">No files indexed yet</div>
            <div className="text-fg-muted">
              Enable codebase indexing in{' '}
              <Link to="/settings" className="underline hover:text-fg">
                Settings
              </Link>{' '}
              to see your files here.
            </div>
          </div>
        </Panel>
      )}
    </ReactFlow>
  )
}

export function ExploreCanvas(props: Props) {
  return (
    <div
      className="border border-edge rounded-md bg-surface-root overflow-hidden min-w-0"
      style={{ height: 'clamp(420px, calc(100dvh - 16rem), 920px)' }}
      role="region"
      aria-label={`Codebase atlas with ${props.nodeCount} files and ${props.edgeCount} import edges.`}
      tabIndex={0}
    >
      <ReactFlowProvider>
        <InnerCanvas {...props} />
      </ReactFlowProvider>
    </div>
  )
}
