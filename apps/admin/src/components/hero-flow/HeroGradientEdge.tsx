/**
 * Gradient connector between hero tiles.
 *
 * Pattern mirrors the mature workflow canvas in `ap-monorepo/apps/mcp`
 * (`gradient-edge.tsx`): a transparent thick hit-area path for hover, a
 * crisp gradient stroke, and a soft blurred glow when the lane is "flowing".
 *
 * No text label rides the connector: the inter-card gap is too narrow for the
 * full action copy (it would overlap both tiles), and that copy already lives
 * verbatim in the destination card. The edge communicates the *relationship*
 * (direction + liveness) visually; the cards carry the words.
 */
import { memo } from 'react'

import { getBezierPath } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'

import { useVizColors, readVizToken } from '../../lib/vizTokens'
import { heroEdgeHighlighted, useHeroFlow } from './HeroFlowContext'
import type { HeroEdgeData } from './heroFlow.data'

const STROKE = 1.75
const STROKE_ACTIVE = 2.5
const DASH_LENGTH = 5
const GAP_LENGTH = 7

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
  const viz = useVizColors()
  const flow = useHeroFlow()
  const d = (data ?? {}) as HeroEdgeData
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_')
  const gradientId = `hg-${safeId}`
  const arrowId = `ha-${safeId}`
  const animName = `hm-${safeId}`

  const src = d.sourceColor ?? viz.flowInfo
  const tgt = d.targetColor ?? viz.flowBrand
  const fail = Boolean(d.failing)
  const flowing = Boolean(d.flowing)
  const severityTint = Boolean(d.severityTint)
  const edgeHover = heroEdgeHighlighted(id, flow.hovered)
  const active = flowing || fail || edgeHover
  const strokeW = active ? STROKE_ACTIVE : STROKE
  const danger = viz.flowDanger
  const mutedEdge = readVizToken('viz-neutral')
  const warnTint = readVizToken('viz-score-warn')
  const strokeValue = fail
    ? danger
    : active
      ? `url(#${gradientId})`
      : severityTint
        ? warnTint
        : mutedEdge
  const arrowColor = fail ? danger : severityTint ? warnTint : tgt
  const dashArray = `${DASH_LENGTH} ${GAP_LENGTH}`
  const refreshClass = flow.refreshPulse ? 'hero-edge-refresh-pulse' : ''
  const opacity = edgeHover ? 1 : active ? 0.9 : severityTint ? 0.65 : 0.4
  const animating = flowing && !fail

  return (
    <>
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
          <stop offset="0%" stopColor={src} />
          <stop offset="100%" stopColor={tgt} />
        </linearGradient>
        <marker id={arrowId} viewBox="0 0 12 12" refX="9" refY="6" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 2 3.5 L 9 6 L 2 8.5 Z" fill={arrowColor} />
        </marker>
      </defs>

      {animating && (
        <style>{`
          @keyframes ${animName} {
            from { stroke-dashoffset: ${DASH_LENGTH + GAP_LENGTH}; }
            to   { stroke-dashoffset: 0; }
          }
        `}</style>
      )}

      {/* Transparent hit-area — widens the hover target so the lane brightens
          when the cursor is anywhere near the connector. */}
      <path d={edgePath} stroke="transparent" strokeWidth={18} fill="none" />

      {/* Soft glow underlay when the loop is live. */}
      {active && !severityTint && (
        <path
          d={edgePath}
          stroke={fail ? danger : `url(#${gradientId})`}
          strokeWidth={6}
          fill="none"
          strokeLinecap="round"
          style={{ opacity: edgeHover ? 0.35 : 0.22, filter: 'blur(3px)' }}
        />
      )}

      <path
        d={edgePath}
        stroke={strokeValue}
        strokeWidth={strokeW}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={animating ? dashArray : undefined}
        markerEnd={`url(#${arrowId})`}
        className={refreshClass}
        style={{
          opacity,
          animation: animating ? `${animName} 1.4s linear infinite` : undefined,
          transition: 'opacity 180ms ease, stroke-width 180ms ease',
        }}
      />
    </>
  )
}

export const HeroGradientEdge = memo(HeroGradientEdgeInner)
