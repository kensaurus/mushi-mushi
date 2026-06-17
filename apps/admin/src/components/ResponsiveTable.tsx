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

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useTableDensity } from '../lib/useTableDensity'
import type { TableDensity } from '../lib/useTableDensity'
import { MicroSegmentCell, MicroSegmentedTrack } from './sidebar/MicroSegmentedTrack'
import { MICRO_SEG, MICRO_SEG_LABEL, microSegActive } from './sidebar/SidebarMicroChrome'

interface ResponsiveTableProps {
  children: ReactNode
  /** @deprecated Prefer `stickyLeadColumns` — pins only the 1px stripe. */
  stickyFirstColumn?: boolean
  /** Pin the first N columns while the rest scrolls (e.g. 3 = stripe + checkbox + summary). */
  stickyLeadColumns?: 0 | 2 | 3
  /** CSS custom properties for sticky column `left` offsets (cols 2 and 3). */
  stickyOffsets?: { col2Left: string; col3Left: string }
  /** Optional ARIA label for the scroll region. */
  ariaLabel?: string
  className?: string
}

export function ResponsiveTable({
  children,
  stickyFirstColumn = false,
  stickyLeadColumns = 0,
  stickyOffsets,
  ariaLabel,
  className = '',
}: ResponsiveTableProps) {
  const leadCount = stickyLeadColumns || (stickyFirstColumn ? 1 : 0)
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

  const scrollHint =
    overflow.left || overflow.right
      ? ' Scroll horizontally to see all columns.'
      : ''

  return (
    <div
      className={`responsive-table ${className}`.trim()}
      data-density={density}
      data-sticky-first={stickyFirstColumn && !stickyLeadColumns ? 'true' : undefined}
      data-sticky-lead={leadCount > 1 ? String(leadCount) : undefined}
      data-overflow-left={overflow.left ? 'true' : undefined}
      data-overflow-right={overflow.right ? 'true' : undefined}
      style={
        leadCount >= 3 && stickyOffsets
          ? ({
              '--sticky-col-2-left': stickyOffsets.col2Left,
              '--sticky-col-3-left': stickyOffsets.col3Left,
            } as CSSProperties)
          : undefined
      }
    >
      <div
        ref={scrollRef}
        className="responsive-table-scroll"
        data-overflow-left={overflow.left ? 'true' : undefined}
        data-overflow-right={overflow.right ? 'true' : undefined}
        role="region"
        aria-label={ariaLabel ? `${ariaLabel}.${scrollHint}` : undefined}
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
  const options = Object.keys(DENSITY_LABELS) as TableDensity[]
  return (
    <MicroSegmentedTrack
      trackId="table-density"
      inline
      role="group"
      aria-label="Table density"
      className={className.trim() || undefined}
    >
      {options.map((d) => {
        const active = density === d
        return (
          <MicroSegmentCell key={d} active={active}>
            <button
              type="button"
              onClick={() => setDensity(d)}
              aria-pressed={active}
              className={`${MICRO_SEG} ${microSegActive(active)} px-2`}
            >
              <span className={MICRO_SEG_LABEL}>{DENSITY_LABELS[d]}</span>
            </button>
          </MicroSegmentCell>
        )
      })}
    </MicroSegmentedTrack>
  )
}
