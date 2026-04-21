/**
 * FILE: apps/admin/src/components/flow-primitives/TravelingDotsEdge.tsx
 * PURPOSE: SVG fragment layered onto a React Flow edge that renders 3 dots
 *          crawling along the path to communicate "data is flowing here
 *          RIGHT NOW." Activated on edges whose source stage is currently
 *          running (`runningStage` in context) — the marching-ants in the
 *          base edge communicates "this is the focus stage"; the traveling
 *          dots communicate "work is in-flight."
 *
 *          Uses `pathLength={1}` so a single stroke-dashoffset animation
 *          makes the dots traverse from 0 → 1 regardless of path length.
 */

interface TravelingDotsEdgeProps {
  path: string
  color: string
  /** Override dot count (default 3). */
  dots?: number
  /** Total traversal time per cycle. */
  durationMs?: number
}

export function TravelingDotsEdge({
  path,
  color,
  dots = 3,
  durationMs = 2400,
}: TravelingDotsEdgeProps) {
  const spacing = 1 / dots
  return (
    <g className="pointer-events-none" aria-hidden="true">
      {Array.from({ length: dots }).map((_, i) => {
        const delay = -(i * durationMs * spacing)
        return (
          <path
            key={i}
            d={path}
            pathLength={1}
            fill="none"
            stroke={color}
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray="0.01 1"
            style={{
              animation: `mushi-dot-travel ${durationMs}ms linear infinite`,
              animationDelay: `${delay}ms`,
              filter: 'drop-shadow(0 0 3px currentColor)',
            }}
          />
        )
      })}
    </g>
  )
}
