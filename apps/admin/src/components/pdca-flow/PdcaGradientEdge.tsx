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
/** Gentler rhythm for the onboarding explainer — visually alive but not distracting. */
const ANIMATION_DURATION_SLOW = '2.4s'

// Stroke widths: inactive edges are now clearly visible at rest so the user
// can follow the loop without hovering. Active/selected edges jump up one
// more notch. Values are tuned for the canvas's default fitView scale.
const STROKE_BASE = 2.5   // was 1.75 — too thin at 70% opacity
const STROKE_ACTIVE = 3.5 // was 2.5

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
  const isSlow = Boolean(edgeData.slow)
  const animDuration = isSlow ? ANIMATION_DURATION_SLOW : ANIMATION_DURATION

  // Failure dominates flow styling: swap the gradient for the danger hue
  // + shorten the dash so the eye catches the stall before reading copy.
  const DANGER = '#ef4444'
  const strokeValue = isFailing ? DANGER : `url(#${gradientId})`
  const failingDash = '6 3'

  const currentStrokeWidth = isActive || selected ? STROKE_ACTIVE : STROKE_BASE

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
          @keyframes ${keyframeName} {
            from { stroke-dashoffset: ${DASH_LENGTH + GAP_LENGTH}; }
            to { stroke-dashoffset: 0; }
          }
        `}</style>
      )}

      {/* Slow-animation variant (onboarding) injects its own longer keyframe
          so the rhythm is gentle rather than the fast live-data pace. */}
      {isActive && isSlow && (
        <style>{`
          @keyframes ${keyframeName} {
            from { stroke-dashoffset: ${(DASH_LENGTH + GAP_LENGTH) * 3}; }
            to { stroke-dashoffset: 0; }
          }
        `}</style>
      )}

      {/* Track — always-on wide-but-faint stripe so the loop path is visible
          even for inactive edges. Rendered first so the gradient sits on top. */}
      <path
        d={edgePath}
        stroke={strokeValue}
        strokeWidth={currentStrokeWidth + 4}
        fill="none"
        style={{ opacity: isActive ? 0.18 : 0.12 }}
      />

      {/* Glow — blur halo. On inactive edges a subtle ambient glow anchors
          the path without fighting the node content. On active edges it pops. */}
      <path
        d={edgePath}
        stroke={strokeValue}
        strokeWidth={isActive ? 8 : 6}
        fill="none"
        strokeDasharray={isActive ? (isFailing ? failingDash : dashArray) : 'none'}
        style={{
          opacity: isActive ? (isFailing ? 0.4 : isSlow ? 0.2 : 0.3) : 0.13,
          filter: 'blur(2.5px)',
          animation: isActive ? `${keyframeName} ${animDuration} linear infinite` : 'none',
        }}
      />

      {/* Main gradient stroke */}
      <path
        d={edgePath}
        stroke={strokeValue}
        strokeWidth={currentStrokeWidth}
        fill="none"
        strokeDasharray={isActive ? (isFailing ? failingDash : dashArray) : 'none'}
        style={{
          opacity: isActive || selected ? (isSlow ? 0.75 : 1) : 0.88,
          animation: isActive ? `${keyframeName} ${animDuration} linear infinite` : 'none',
        }}
        markerEnd={markerEnd}
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
