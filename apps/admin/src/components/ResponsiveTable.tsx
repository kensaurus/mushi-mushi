/**
 * FILE: apps/admin/src/components/ResponsiveTable.tsx
 * PURPOSE: Thin wrapper around an ordinary `<table>` that adds three quality
 *          -of-life affordances without forcing callers to migrate to a
 *          full table library:
 *
 *            • Density toggle — 'comfy' (default) vs 'compact' row padding,
 *              driven by a CSS variable so child <td>/<th> pick it up
 *              without prop drilling. Persisted per-user via
 *              `useTableDensity`.
 *
 *            • Scroll-shadow — fades the left/right edges with a CSS mask
 *              when the table overflows horizontally, giving a visual cue
 *              that content exists off-screen.
 *
 *            • Sticky first column — opt-in `stickyFirstColumn` prop that
 *              pins the first <td> of every row while the rest scrolls.
 *              Uses `position: sticky`; falls back gracefully.
 *
 *          Existing table markup (`<table>` + `<thead>` + `<tbody>`) is
 *          passed through as children unmodified — adoption is
 *          replace-the-outer-wrapper-only.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTableDensity } from '../lib/useTableDensity'
import type { TableDensity } from '../lib/useTableDensity'

interface ResponsiveTableProps {
  children: ReactNode
  /** Visually pin the first column while the rest scrolls horizontally. */
  stickyFirstColumn?: boolean
  /** Optional ARIA label for the scroll region. */
  ariaLabel?: string
  className?: string
}

export function ResponsiveTable({
  children,
  stickyFirstColumn = false,
  ariaLabel,
  className = '',
}: ResponsiveTableProps) {
  const [density] = useTableDensity()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [overflow, setOverflow] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  })

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const recompute = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el
      setOverflow({
        left: scrollLeft > 1,
        right: scrollLeft + clientWidth < scrollWidth - 1,
      })
    }
    recompute()
    el.addEventListener('scroll', recompute, { passive: true })
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', recompute)
      ro.disconnect()
    }
  }, [])

  return (
    <div
      className={`responsive-table ${className}`.trim()}
      data-density={density}
      data-sticky-first={stickyFirstColumn ? 'true' : undefined}
    >
      <div
        ref={scrollRef}
        className="responsive-table-scroll"
        data-overflow-left={overflow.left ? 'true' : undefined}
        data-overflow-right={overflow.right ? 'true' : undefined}
        role="region"
        aria-label={ariaLabel}
        tabIndex={overflow.left || overflow.right ? 0 : -1}
      >
        {children}
      </div>
    </div>
  )
}

interface TableDensityToggleProps {
  className?: string
}

const DENSITY_LABELS: Record<TableDensity, string> = {
  comfy: 'Comfortable',
  compact: 'Compact',
}

export function TableDensityToggle({ className = '' }: TableDensityToggleProps) {
  const [density, setDensity] = useTableDensity()
  return (
    <div
      role="group"
      aria-label="Table density"
      className={`inline-flex items-center rounded-sm border border-edge-subtle bg-surface-raised/40 p-0.5 text-2xs ${className}`.trim()}
    >
      {(Object.keys(DENSITY_LABELS) as TableDensity[]).map((d) => {
        const active = density === d
        return (
          <button
            key={d}
            type="button"
            onClick={() => setDensity(d)}
            aria-pressed={active}
            className={[
              'px-2 py-0.5 rounded-xs transition-colors',
              active
                ? 'bg-brand/15 text-fg'
                : 'text-fg-muted hover:text-fg-secondary',
            ].join(' ')}
          >
            {DENSITY_LABELS[d]}
          </button>
        )
      })}
    </div>
  )
}
