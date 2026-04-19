/**
 * FILE: apps/admin/src/components/reports/ReportsFilterBar.tsx
 * PURPOSE: Top-of-table filter row: free-text search, status/category/severity
 *          dropdowns, dismissible context chips for filters that arrived from
 *          another page (component, reporter), and a clear-all link.
 */

import type { RefObject } from 'react'
import { FilterSelect } from '../ui'
import { FILTER_OPTIONS } from '../../lib/tokens'

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
  return (
    <div className="flex flex-wrap gap-2 mb-3 items-center">
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
      {contextChips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onSetFilter(chip.key, '')}
          className="inline-flex items-center gap-1.5 rounded-sm border border-accent/30 bg-accent-muted/30 px-2 py-1 text-2xs text-accent hover:bg-accent-muted/50 motion-safe:transition-colors"
          title={`Clear ${chip.label} filter`}
        >
          <span className="font-medium">{chip.label}:</span>
          <span className="font-mono">{chip.value}</span>
          <span aria-hidden="true" className="text-fg-faint">
            ×
          </span>
        </button>
      ))}
      {hasFilters && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-2xs text-fg-faint hover:text-fg-muted underline"
        >
          Clear all
        </button>
      )}
    </div>
  )
}
