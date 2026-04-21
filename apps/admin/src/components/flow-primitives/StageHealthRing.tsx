/**
 * FILE: apps/admin/src/components/flow-primitives/StageHealthRing.tsx
 * PURPOSE: Tiny progress ring rendered inside a PDCA node. The ring's fill
 *          percentage encodes stage-level health — e.g. Judge's score
 *          average, auto-fix pass rate, backlog age. Rendered entirely
 *          with SVG so there's zero chart-library overhead.
 */

interface StageHealthRingProps {
  /** 0..1 — fraction of the ring to fill. */
  value: number
  /** SVG stroke colour for the fill arc. */
  color: string
  /** Optional center glyph ("✓", "!" etc). */
  glyph?: string
  size?: number
  title?: string
}

export function StageHealthRing({
  value,
  color,
  glyph,
  size = 22,
  title,
}: StageHealthRingProps) {
  const clamped = Math.max(0, Math.min(1, value))
  const r = (size - 4) / 2
  const c = size / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - clamped)
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={title ?? `Health: ${Math.round(clamped * 100)}%`}
    >
      <title>{title ?? `Health: ${Math.round(clamped * 100)}%`}</title>
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke="var(--color-edge-subtle)"
        strokeWidth={2}
      />
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${c} ${c})`}
        style={{ transition: 'stroke-dashoffset 350ms var(--ease-out-expo)' }}
      />
      {glyph && (
        <text
          x={c}
          y={c + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={size * 0.45}
          fontWeight={600}
          fill={color}
        >
          {glyph}
        </text>
      )}
    </svg>
  )
}
