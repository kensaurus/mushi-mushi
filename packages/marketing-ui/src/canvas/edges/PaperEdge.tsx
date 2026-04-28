import { EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import type { PaperEdgeData } from '../data'

const DASH_LENGTH = 9
const GAP_LENGTH = 5

export function PaperEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps) {
  const edgeData = (data ?? {}) as PaperEdgeData
  const [edgePath, edgeCenterX, edgeCenterY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_')
  const gradientId = `mushi-paper-edge-${safeId}`
  const keyframeName = `mushi-paper-march-${safeId}`
  const active = Boolean(edgeData.active)
  const dashArray = `${DASH_LENGTH} ${GAP_LENGTH}`

  return (
    <>
      <defs>
        <linearGradient id={gradientId}>
          <stop offset="0%" stopColor="var(--mushi-vermillion)" />
          <stop offset="100%" stopColor="var(--mushi-ink)" />
        </linearGradient>
      </defs>

      <style>{`
        @keyframes ${keyframeName} {
          from { stroke-dashoffset: ${DASH_LENGTH + GAP_LENGTH}; }
          to { stroke-dashoffset: 0; }
        }
      `}</style>

      <path
        d={edgePath}
        stroke={`url(#${gradientId})`}
        strokeWidth={active ? 3 : 1.8}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={active ? dashArray : 'none'}
        markerEnd={markerEnd}
        style={{
          opacity: active ? 0.96 : 0.45,
          animation: active ? `${keyframeName} 760ms linear infinite` : 'none',
        }}
      />

      {active && (
        <path
          d={edgePath}
          stroke={`url(#${gradientId})`}
          strokeWidth={8}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={dashArray}
          style={{
            opacity: 0.18,
            filter: 'blur(3px)',
            animation: `${keyframeName} 760ms linear infinite`,
          }}
        />
      )}

      {edgeData.flowing && (
        <path
          d={edgePath}
          pathLength={1}
          fill="none"
          stroke="var(--mushi-vermillion)"
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray="0.012 1"
          className="mushi-edge-dot"
        />
      )}

      {edgeData.label && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-full border border-[var(--mushi-rule)] bg-[var(--mushi-paper)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--mushi-ink-muted)] shadow-[0_8px_30px_-20px_rgba(14,13,11,0.5)]"
            style={{
              transform: `translate(-50%, -50%) translate(${edgeCenterX}px, ${edgeCenterY - 12}px)`,
            }}
          >
            {edgeData.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
