/**
 * FILE: apps/admin/src/components/hero-flow/HeroGradientEdge.tsx
 *
 * Animated dashed edge between hero nodes. No blur.
 *   1. Faint base line shows the path at all times
 *   2. Bright dashes march along the path (marching-ants, direction = left→right)
 *   3. Filled arrowhead at the target
 *   4. Optional metadata label pill at midpoint
 */
import { memo } from 'react'

import { EdgeLabelRenderer, getBezierPath } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'

import type { HeroEdgeData } from './heroFlow.data'

// Dash geometry
const DASH = 8    // dash length px
const GAP  = 6    // gap length px
const SPEED = '1.2s'  // one full cycle

function HeroGradientEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const edgeData = (data ?? {}) as HeroEdgeData
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_')
  const gradientId = `hg-${safeId}`
  const arrowId    = `ha-${safeId}`
  const animName   = `hm-${safeId}`

  const src  = edgeData.sourceColor ?? '#94a3b8'
  const tgt  = edgeData.targetColor ?? '#94a3b8'
  const fail = Boolean(edgeData.failing)
  const DANGER = '#ef4444'
  const lineColor = fail ? DANGER : `url(#${gradientId})`
  const arrowColor = fail ? DANGER : tgt

  const dashArray  = `${DASH} ${GAP}`
  const dashOffset = DASH + GAP   // marches forward

  return (
    <>
      <defs>
        <linearGradient id={gradientId}>
          <stop offset="0%"   stopColor={src} />
          <stop offset="100%" stopColor={tgt} />
        </linearGradient>
        <marker
          id={arrowId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="10"
          markerHeight="10"
          orient="auto-start-reverse"
        >
          <path d="M 1 2 L 9 5 L 1 8 Z" fill={arrowColor} />
        </marker>
      </defs>

      <style>{`
        @keyframes ${animName} {
          from { stroke-dashoffset: ${dashOffset}; }
          to   { stroke-dashoffset: 0; }
        }
      `}</style>

      {/* Faint base rail — shows the full path even between dashes */}
      <path
        d={edgePath}
        stroke={tgt}
        strokeWidth={1}
        fill="none"
        strokeLinecap="round"
        style={{ opacity: 0.2 }}
      />

      {/* Marching dashes */}
      <path
        d={edgePath}
        stroke={lineColor}
        strokeWidth={2.5}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={dashArray}
        markerEnd={`url(#${arrowId})`}
        style={{
          animation: `${animName} ${SPEED} linear infinite`,
        }}
      />

      {edgeData.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 16}px)`,
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 600,
              color: tgt,
              background: 'rgba(0,0,0,0.7)',
              border: `1px solid ${tgt}55`,
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                backgroundColor: src,
                flexShrink: 0,
              }}
            />
            {edgeData.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const HeroGradientEdge = memo(HeroGradientEdgeInner)
