/**
 * FILE: apps/admin/src/components/reports/ReportsFilterBar.tsx
 * PURPOSE: Top-of-table filter row: free-text search, status/category/severity
 *          dropdowns, dismissible context chips for filters that arrived from
 *          another page (component, reporter), and a clear-all link.
 *
 *          Wave T.1.2 (2026-04-23): the inline chip + clear-all row was
 *          extracted into a generic `<ActiveFiltersRail>` so Fixes / Audit
 *          can share it. The bar now renders the rail directly under the
 *          controls so users always see the *applied* filters separated
 *          from the *control* surface, rather than blending them into one
 *          row that becomes hard to scan once 5+ items are active.
 */

import type { RefObject } from 'react'
import { FilterSelect } from '../ui'
import { ActiveFiltersRail, type ActiveFilter } from '../ActiveFiltersRail'
import { FILTER_OPTIONS, severityLabel } from '../../lib/tokens'

export interface ContextChip {
  key: string
  label: string
  value: string
}

interface Props {
  searchInput: string
  onSearchInputChange: (v: string) => void
  searchInputRef: RefObject<HTMLInputElement | null>
  status: string
  category: string
  severity: string
  contextChips: ContextChip[]
  hasFilters: boolean
  onSetFilter: (key: string, value: string) => void
  onClearAll: () => void
}

export function ReportsFilterBar({
  searchInput,
  onSearchInputChange,
  searchInputRef,
  status,
  category,
  severity,
  contextChips,
  hasFilters,
  onSetFilter,
  onClearAll,
}: Props) {
  // Compose the rail data: select-driven filters + bridged context chips.
  // Tone'd by semantic — severity uses warn/danger so a glance shows the
  // urgency band already applied; status uses neutral so the eye reads
  // the value first.
  const railFilters: ActiveFilter[] = [
    status && {
      key: 'status',
      label: 'Status',
      value: status,
      onClear: () => onSetFilter('status', ''),
      tone: 'info' as const,
    },
    category && {
      key: 'category',
      label: 'Category',
      value: category,
      onClear: () => onSetFilter('category', ''),
      tone: 'neutral' as const,
    },
    severity && {
      key: 'severity',
      label: 'Severity',
      value: severityLabel(severity),
      onClear: () => onSetFilter('severity', ''),
      tone: severity === 'critical' || severity === 'high' ? ('danger' as const) : ('warn' as const),
    },
    ...contextChips.map((chip) => ({
      key: chip.key,
      label: chip.label,
      value: chip.value,
      onClear: () => onSetFilter(chip.key, ''),
      tone: 'brand' as const,
    })),
  ].filter(Boolean) as ActiveFilter[]

  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search summary or description… (/)"
          value={searchInput}
          onChange={(e) => onSearchInputChange(e.target.value)}
          aria-label="Search reports"
          className="w-64 bg-surface-raised border border-edge-subtle rounded-sm px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-brand/40 focus:border-brand/40"
        />
        <FilterSelect
          label="Status"
          value={status}
          options={FILTER_OPTIONS.statuses}
          onChange={(e) => onSetFilter('status', e.currentTarget.value)}
        />
        <FilterSelect
          label="Category"
          value={category}
          options={FILTER_OPTIONS.categories}
          onChange={(e) => onSetFilter('category', e.currentTarget.value)}
        />
        <FilterSelect
          label="Severity"
          value={severity}
          options={FILTER_OPTIONS.severities}
          onChange={(e) => onSetFilter('severity', e.currentTarget.value)}
        />
        {hasFilters && (
          <button
            type="button"
            onClick={onClearAll}
            className="ml-auto text-2xs text-fg-faint hover:text-fg-muted underline"
          >
            Clear all
          </button>
        )}
      </div>
      <ActiveFiltersRail
        filters={railFilters}
        onClearAll={onClearAll}
        ariaLabel="Active report filters"
      />
    </div>
  )
}
