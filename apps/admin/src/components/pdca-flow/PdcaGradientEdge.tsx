/**
 * FILE: apps/admin/src/components/pdca-flow/PdcaGradientEdge.tsx
 * PURPOSE: Custom React Flow edge rendering a bezier path with a linear
 *          gradient from the source stage colour to the target. When the
 *          edge is `animated` (the React Flow prop — set when the source
 *          stage is the current bottleneck) we add a dashed marching-ants
 *          overlay + a glow to make the data-flow legible at a glance.
 *          When `data.flowing === true` we additionally layer the
 *          traveling-dots effect on top — "data is moving right now."
 */

import { memo } from 'react'
import { EdgeLabelRenderer, getBezierPath } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'
import type { PdcaEdgeData } from './pdcaFlow.data'
import { TravelingDotsEdge } from '../flow-primitives/TravelingDotsEdge'

const DASH_LENGTH = 8
const GAP_LENGTH = 4
const ANIMATION_DURATION = '0.6s'

function PdcaGradientEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
  animated,
  selected,
}: EdgeProps) {
  const edgeData = (data ?? {}) as PdcaEdgeData
  const [edgePath, edgeCenterX, edgeCenterY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const gradientId = `pdca-grad-${id}`
  const dashArray = `${DASH_LENGTH} ${GAP_LENGTH}`
  const isActive = Boolean(animated)
  const isFlowing = Boolean(edgeData.flowing)

  return (
    <>
      <defs>
        <linearGradient id={gradientId}>
          <stop offset="0%" stopColor={edgeData.sourceColor ?? '#60a5fa'} />
          <stop offset="100%" stopColor={edgeData.targetColor ?? '#f5b544'} />
        </linearGradient>
      </defs>

      {isActive && (
        <style>{`
          @keyframes pdca-flow-${id} {
            from { stroke-dashoffset: ${DASH_LENGTH + GAP_LENGTH}; }
            to { stroke-dashoffset: 0; }
          }
        `}</style>
      )}

      <path
        d={edgePath}
        stroke={`url(#${gradientId})`}
        strokeWidth={isActive || selected ? 2.5 : 1.75}
        fill="none"
        strokeDasharray={isActive ? dashArray : 'none'}
        style={{
          opacity: isActive || selected ? 1 : 0.7,
          animation: isActive ? `pdca-flow-${id} ${ANIMATION_DURATION} linear infinite` : 'none',
        }}
        markerEnd={markerEnd}
      />

      {isActive && (
        <path
          d={edgePath}
          stroke={`url(#${gradientId})`}
          strokeWidth={5}
          fill="none"
          strokeDasharray={dashArray}
          style={{
            opacity: 0.25,
            filter: 'blur(2px)',
            animation: `pdca-flow-${id} ${ANIMATION_DURATION} linear infinite`,
          }}
        />
      )}

      {isFlowing && (
        <TravelingDotsEdge
          path={edgePath}
          color={edgeData.targetColor ?? '#f5b544'}
          dots={3}
        />
      )}

      {edgeData.edgeLabel && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${edgeCenterX}px, ${edgeCenterY - 10}px)`,
              fontSize: 10,
              fontWeight: 600,
              color: edgeData.sourceColor ?? '#60a5fa',
              pointerEvents: 'none',
            }}
          >
            {edgeData.edgeLabel}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const PdcaGradientEdge = memo(PdcaGradientEdgeInner)
