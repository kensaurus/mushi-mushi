/**
 * FILE: apps/admin/src/components/hero-flow/HeroGradientEdge.tsx
 *
 * Gradient connector between hero tiles. At rest: a single quiet rail +
 * arrowhead (matches the workspace pipeline ribbon). When work is in flight
 * or failing, layers on marching dashes and a soft glow.
 */
import { memo } from 'react'

import { getBezierPath } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'

import { TravelingDotsEdge } from '../flow-primitives/TravelingDotsEdge'
import { useVizColors } from '../../lib/vizTokens'
import type { HeroEdgeData } from './heroFlow.data'

const STROKE = 2.5
const STROKE_ACTIVE = 3.25
const DASH_LENGTH = 6
const GAP_LENGTH = 6

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
  const edgeData = (data ?? {}) as HeroEdgeData
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

  const src = edgeData.sourceColor ?? viz.flowInfo
  const tgt = edgeData.targetColor ?? viz.flowBrand
  const fail = Boolean(edgeData.failing)
  const flowing = Boolean(edgeData.flowing)
  const active = flowing || fail
  const strokeW = active ? STROKE_ACTIVE : STROKE
  const danger = viz.flowDanger
  const strokeValue = fail ? danger : active ? `url(#${gradientId})` : tgt
  const arrowColor = fail ? danger : tgt
  const arrowHalo = viz.arrowHalo
  const dashArray = `${DASH_LENGTH} ${GAP_LENGTH}`

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
          <stop offset="0%" stopColor={src} />
          <stop offset="100%" stopColor={tgt} />
        </linearGradient>
        <marker
          id={arrowId}
          viewBox="0 0 12 12"
          refX="10"
          refY="6"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M 1 2.5 L 10 6 L 1 9.5 Z" fill={arrowHalo} />
          <path d="M 2 3.5 L 9 6 L 2 8.5 Z" fill={arrowColor} />
        </marker>
      </defs>

      {active && (
        <style>{`
          @keyframes ${animName} {
            from { stroke-dashoffset: ${DASH_LENGTH + GAP_LENGTH}; }
            to   { stroke-dashoffset: 0; }
          }
        `}</style>
      )}

      {active ? (
        <>
          {/* Wide track — only when the lane needs attention */}
          <path
            d={edgePath}
            stroke={strokeValue}
            strokeWidth={strokeW + 4}
            fill="none"
            strokeLinecap="round"
            style={{ opacity: 0.35 }}
          />
          {/* Soft glow */}
          <path
            d={edgePath}
            stroke={strokeValue}
            strokeWidth={10}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={dashArray}
            style={{
              opacity: fail ? 0.5 : 0.38,
              filter: 'blur(2.5px)',
              animation: `${animName} 0.9s linear infinite`,
            }}
          />
          {/* Main rail */}
          <path
            d={edgePath}
            stroke={strokeValue}
            strokeWidth={strokeW}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={dashArray}
            markerEnd={`url(#${arrowId})`}
            style={{
              opacity: 1,
              animation: `${animName} 0.9s linear infinite`,
            }}
          />
        </>
      ) : (
        /* Calm at-rest rail — no gradient stack or blur halo */
        <path
          d={edgePath}
          stroke={strokeValue}
          strokeWidth={strokeW}
          fill="none"
          strokeLinecap="round"
          markerEnd={`url(#${arrowId})`}
          style={{ opacity: 0.62 }}
        />
      )}

      {flowing && !fail && (
        <TravelingDotsEdge path={edgePath} color={tgt} dots={2} strokeWidth={2} glowBlur={2} durationMs={2400} />
      )}
    </>
  )
}

export const HeroGradientEdge = memo(HeroGradientEdgeInner)
