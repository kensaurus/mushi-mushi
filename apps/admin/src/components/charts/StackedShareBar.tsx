/**
 * FILE: apps/admin/src/components/charts/StackedShareBar.tsx
 * PURPOSE: A dense one-line stacked bar for a few counts that add up to a
 *          whole ("Who opens fixes: server 0 · local 5 · nobody 5"), with a
 *          legend that keeps the numbers. Each legend mark has its own shape
 *          so the split reads without colour. Owner's walkthrough, 2026-11-17:
 *          "show it as a picture".
 */

export interface ShareSegment {
  key: string
  label: string
  value: number
  /** A bg-* token class for the bar. */
  barClass: string
  /** The matching text-* class for the legend glyph. */
  textClass: string
  /** A glyph for the legend (● ■ ▲ …), so the split never depends on colour. */
  glyph: string
}

export function StackedShareBar({ segments, ariaLabel, className = '' }: { segments: readonly ShareSegment[]; ariaLabel: string; className?: string }) {
  const total = segments.reduce((n, s) => n + Math.max(0, s.value), 0)
  const summary = segments.map((s) => `${s.label} ${s.value}`).join(', ')
  return (
    <div className={`min-w-0 space-y-1 ${className}`}>
      <div
        role="img"
        aria-label={`${ariaLabel}: ${summary}`}
        className="flex h-2 w-full min-w-0 overflow-hidden rounded-full bg-surface-overlay"
        data-testid="stacked-share-bar"
      >
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <span
                key={s.key}
                className={`h-full ${s.barClass}`}
                style={{ width: `${(s.value / total) * 100}%` }}
                data-segment={s.key}
              />
            ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-fg-secondary" aria-hidden="true">
        {segments.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1">
            <span className={`leading-none ${s.textClass}`}>{s.glyph}</span>
            <span>{s.label}</span>
            <span className="font-semibold tabular-nums text-fg">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
