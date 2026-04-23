/**
 * FILE: apps/admin/src/components/ActiveFiltersRail.tsx
 * PURPOSE: One-line readout + clear-button row that surfaces the current
 *          filter state of any list page. The pre-existing `ReportsFilterBar`
 *          (and its peers on Fixes / Audit) compose three or four selects in
 *          one block, but once a user clicks "Apply" the controls collapse
 *          and the active state becomes invisible — at which point the user
 *          forgets *why* the list is "empty" or filtered to 4 rows.
 *
 *          This rail makes filter state explicit and one-click reversible:
 *            - Each active filter renders as a removable chip.
 *            - Two or more chips reveal a trailing "Clear all" so the user
 *              can return to the unfiltered view in a single click.
 *            - Zero filters → component renders nothing (clean pages stay
 *              clean, no empty-toolbar tax).
 *
 *          Wave T.1.2 (2026-04-23): consolidates a recurring "show what's
 *          filtered" pattern that was previously duplicated by hand in
 *          ReportsFilterBar's pill row, the Fixes status segmented control
 *          and the Audit page's `<dl>` of active params. Pages keep their
 *          existing controls — this rail sits *below* the controls and
 *          shows the *result* of the user's filter choices.
 */

import type { ReactNode } from 'react'

export interface ActiveFilter {
  /** Stable identifier — used for React `key` and for the chip's
   *  `aria-label` (`Remove ${label} filter`). Keep these in lock-step
   *  with the URL parameter name (e.g. `status`, `severity`) so the
   *  Playwright e2e specs can reach them deterministically. */
  key: string
  /** Short caption shown left of the value, e.g. "Status". */
  label: string
  /** The currently-applied value (e.g. "high", "PR-Failed"). Renders
   *  inside the chip in mono so numeric and enum values feel anchored. */
  value: ReactNode
  /** Removes the filter — typically wired to `setSearchParams` or the
   *  page's local filter setter. */
  onClear: () => void
  /** Optional tone used to colour the chip. Defaults to neutral. */
  tone?: 'neutral' | 'brand' | 'ok' | 'warn' | 'danger' | 'info'
}

interface ActiveFiltersRailProps {
  filters: ActiveFilter[]
  /** Optional bulk-clear callback. When provided AND two or more filters
   *  are active, a trailing "Clear all" is rendered next to the chip row. */
  onClearAll?: () => void
  className?: string
  /** Override the default ARIA label. */
  ariaLabel?: string
}

const TONE_CLASS: Record<NonNullable<ActiveFilter['tone']>, string> = {
  neutral: 'border-edge-subtle bg-surface-overlay/60 text-fg-secondary',
  brand:   'border-brand/40 bg-brand/10 text-brand',
  ok:      'border-ok/40 bg-ok-muted/30 text-ok',
  warn:    'border-warn/40 bg-warn-muted/30 text-warn',
  danger:  'border-danger/40 bg-danger-muted/30 text-danger',
  info:    'border-info/40 bg-info-muted/30 text-info',
}

/**
 * Removable filter chips that mirror the URL/state of the current list.
 *
 * Render *below* a page's filter controls — this is the "what's currently
 * applied" readout, not the controls themselves. Renders nothing when no
 * filters are active so pages without filters stay visually quiet.
 */
export function ActiveFiltersRail({
  filters,
  onClearAll,
  className = '',
  ariaLabel = 'Active filters',
}: ActiveFiltersRailProps) {
  if (filters.length === 0) return null
  const showClearAll = onClearAll && filters.length >= 2
  return (
    <div
      role="region"
      aria-label={ariaLabel}
      className={`flex flex-wrap items-center gap-1.5 ${className}`}
    >
      {filters.map((f) => (
        <FilterChipRemovable key={f.key} filter={f} />
      ))}
      {showClearAll && (
        <button
          type="button"
          onClick={onClearAll}
          className="inline-flex items-center rounded-full border border-edge-subtle px-2 py-0.5 text-2xs text-fg-faint hover:text-fg-secondary hover:border-edge motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          aria-label="Clear all filters"
        >
          Clear all
        </button>
      )}
    </div>
  )
}

function FilterChipRemovable({ filter }: { filter: ActiveFilter }) {
  const tone = filter.tone ?? 'neutral'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs ${TONE_CLASS[tone]}`}
    >
      <span className="text-fg-faint">{filter.label}:</span>
      <span className="font-mono tabular-nums">{filter.value}</span>
      <button
        type="button"
        onClick={filter.onClear}
        aria-label={`Remove ${filter.label} filter`}
        title={`Remove ${filter.label} filter`}
        className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-fg-faint hover:text-fg hover:bg-surface-overlay/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 motion-safe:transition-colors"
      >
        <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <line x1="4" y1="4" x2="12" y2="12" strokeLinecap="round" />
          <line x1="12" y1="4" x2="4" y2="12" strokeLinecap="round" />
        </svg>
      </button>
    </span>
  )
}
