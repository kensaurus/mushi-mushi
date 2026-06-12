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

import { memo, useState } from 'react'
import { EdgeLabelRenderer, getBezierPath } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'
import type { PdcaEdgeData } from './pdcaFlow.data'
import { TravelingDotsEdge } from '../flow-primitives/TravelingDotsEdge'

const DASH_LENGTH = 8
const GAP_LENGTH = 4
const ANIMATION_DURATION = '0.6s'

// Stroke widths: inactive edges are now clearly visible at rest so the user
// can follow the loop without hovering. Active/selected edges jump up one
// more notch. Values are tuned for the canvas's default fitView scale.
const STROKE_BASE = 3.25
const STROKE_ACTIVE = 4.5
// The loop-back cubic bezier dips this many flow-px below the node row.
// Must be < (canvas height − node height) so fitView keeps the arc in frame.
// Must fit inside live canvas: insetY + nodeHeight + LOOP_DEPTH + marker < canvas h.
const LOOP_DEPTH = 96

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

  // The loop-back edge (Act→Plan) uses Position.Bottom handles on both ends.
  // getBezierPath with Bottom→Bottom and equal source/target Y produces zero
  // curvature offset — the control points land at the same Y as the nodes,
  // resulting in a flat straight line rather than a proper arc.
  // We hand-build the cubic bezier so it dips 120px below the node row,
  // which is clearly a "return" arc and stays within the 380px canvas height.
  const isLoopBack = sourcePosition === 'bottom' && targetPosition === 'bottom'
  const [edgePath, edgeCenterX, edgeCenterY] = isLoopBack
    ? [
        `M ${sourceX},${sourceY} C ${sourceX},${sourceY + LOOP_DEPTH} ${targetX},${targetY + LOOP_DEPTH} ${targetX},${targetY}`,
        (sourceX + targetX) / 2,
        sourceY + LOOP_DEPTH * 0.75,
      ]
    : getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })

  // React Flow edge ids use `${source}->${target}` (e.g. `plan->do`), but the
  // `>` character is not valid in CSS `<custom-ident>` — some browsers drop
  // @keyframes rules whose name contains it, killing the marching-ants
  // animation silently. Normalise to `[a-z0-9_-]` so the keyframe always
  // resolves.
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_')
  const gradientId = `pdca-grad-${safeId}`
  const keyframeName = `pdca-flow-${safeId}`
  const dashArray = `${DASH_LENGTH} ${GAP_LENGTH}`
  const isActive = Boolean(animated)
  const isFlowing = Boolean(edgeData.flowing)
  const isFailing = Boolean(edgeData.failing)

  // Failure dominates flow styling: swap the gradient for the danger hue
  // + shorten the dash so the eye catches the stall before reading copy.
  const DANGER = '#ef4444'
  const strokeValue = isFailing ? DANGER : `url(#${gradientId})`
  const failingDash = '6 3'

  const [isHovered, setIsHovered] = useState(false)
  const isEmphasised = isActive || selected || isHovered
  const currentStrokeWidth = isEmphasised ? STROKE_ACTIVE + (isHovered && !isActive ? 0.5 : 0) : STROKE_BASE

  return (
    <>
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          <stop offset="0%" stopColor={edgeData.sourceColor ?? '#60a5fa'} />
          <stop offset="100%" stopColor={edgeData.targetColor ?? '#f5b544'} />
        </linearGradient>
      </defs>

      {isActive && (
        <style>{`
          @keyframes ${keyframeName} {
            from { stroke-dashoffset: ${DASH_LENGTH + GAP_LENGTH}; }
            to { stroke-dashoffset: 0; }
          }
        `}</style>
      )}

      {/* Track — wide stripe behind the main stroke, gives visual weight. */}
      <path
        d={edgePath}
        stroke={strokeValue}
        strokeWidth={currentStrokeWidth + 4}
        fill="none"
        style={{
          opacity: isEmphasised ? 0.45 : 0.3,
          transition: 'opacity 180ms ease, stroke-width 180ms ease',
        }}
      />

      {/* Glow — blur halo. Brightens on hover/active/selected. */}
      <path
        d={edgePath}
        stroke={strokeValue}
        strokeWidth={isEmphasised ? 10 : 7}
        fill="none"
        strokeDasharray={isActive ? (isFailing ? failingDash : dashArray) : 'none'}
        style={{
          opacity: isEmphasised ? (isFailing ? 0.6 : 0.48) : 0.32,
          filter: `blur(${isHovered ? '4px' : '3px'})`,
          animation: isActive ? `${keyframeName} ${ANIMATION_DURATION} linear infinite` : 'none',
          transition: 'opacity 180ms ease, filter 180ms ease',
        }}
      />

      {/* Main gradient stroke — always fully opaque, transitions stroke-width. */}
      <path
        d={edgePath}
        stroke={strokeValue}
        strokeWidth={currentStrokeWidth}
        fill="none"
        strokeDasharray={isActive ? (isFailing ? failingDash : dashArray) : 'none'}
        style={{
          opacity: 1,
          animation: isActive ? `${keyframeName} ${ANIMATION_DURATION} linear infinite` : 'none',
          transition: 'stroke-width 180ms ease',
        }}
        markerEnd={markerEnd}
      />

      {/* Invisible hit-area — 16px wide so the edge is easy to hover/click.
          Must be last so it sits on top and captures pointer events. */}
      <path
        d={edgePath}
        stroke="transparent"
        strokeWidth={16}
        fill="none"
        style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />

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
              transform: `translate(-50%, -50%) translate(${edgeCenterX}px, ${edgeCenterY - 12}px)`,
              pointerEvents: 'none',
            }}
            className="rounded-full border border-edge/70 bg-surface-overlay/95 px-2 py-0.5 text-3xs font-semibold uppercase tracking-wider shadow-sm"
          >
            <span style={{ color: edgeData.targetColor ?? '#60a5fa' }}>{edgeData.edgeLabel}</span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const PdcaGradientEdge = memo(PdcaGradientEdgeInner)
