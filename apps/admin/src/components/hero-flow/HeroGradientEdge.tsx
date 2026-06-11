/**
 * FILE: apps/admin/src/components/hero-flow/HeroGradientEdge.tsx
 *
 * Gradient connector between hero tiles. Uses the same layered stroke
 * pattern as PdcaGradientEdge (wide track + glow + main rail) so edges
 * stay legible in dark mode — no surface-root casing that reads black-on-black.
 */
import { memo } from 'react'

import { getBezierPath } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'

import { TravelingDotsEdge } from '../flow-primitives/TravelingDotsEdge'
import { useTheme } from '../../lib/useTheme'
import type { HeroEdgeData } from './heroFlow.data'

const STROKE = 3.25
const STROKE_ACTIVE = 4.25
const DASH_LENGTH = 6
const GAP_LENGTH = 6

/** Arrow halo — fixed hex so SVG never falls back to black when CSS vars fail. */
const ARROW_HALO = {
  dark: '#2a2a36',
  light: '#e4e7ec',
} as const

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
  const { resolved } = useTheme()
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

  const src = edgeData.sourceColor ?? '#60a5fa'
  const tgt = edgeData.targetColor ?? '#f5b544'
  const fail = Boolean(edgeData.failing)
  const flowing = Boolean(edgeData.flowing)
  const active = flowing || fail
  const strokeW = active ? STROKE_ACTIVE : STROKE
  const danger = '#ef4444'
  const strokeValue = fail ? danger : `url(#${gradientId})`
  const arrowColor = fail ? danger : tgt
  const arrowHalo = ARROW_HALO[resolved]
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
          markerWidth="9"
          markerHeight="9"
          orient="auto-start-reverse"
        >
          {/* Halo so the head separates from dark canvas */}
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

      {/* Wide coloured track — visible at rest on dark backgrounds */}
      <path
        d={edgePath}
        stroke={strokeValue}
        strokeWidth={strokeW + 5}
        fill="none"
        strokeLinecap="round"
        style={{ opacity: active ? 0.5 : 0.38 }}
      />

      {/* Soft glow */}
      <path
        d={edgePath}
        stroke={strokeValue}
        strokeWidth={active ? 11 : 9}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={active ? dashArray : 'none'}
        style={{
          opacity: active ? 0.45 : 0.32,
          filter: 'blur(3px)',
          animation: active ? `${animName} 0.9s linear infinite` : undefined,
        }}
      />

      {/* Main rail */}
      <path
        d={edgePath}
        stroke={strokeValue}
        strokeWidth={strokeW}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={active ? dashArray : 'none'}
        markerEnd={`url(#${arrowId})`}
        style={{
          opacity: 1,
          animation: active ? `${animName} 0.9s linear infinite` : undefined,
        }}
      />

      {flowing && !fail && (
        <TravelingDotsEdge path={edgePath} color={tgt} dots={2} strokeWidth={2.5} glowBlur={4} durationMs={2400} />
      )}
    </>
  )
}

export const HeroGradientEdge = memo(HeroGradientEdgeInner)
