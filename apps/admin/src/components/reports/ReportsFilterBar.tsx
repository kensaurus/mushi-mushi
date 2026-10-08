/**
 * FILE: apps/admin/src/components/reports/ReportsFilterBar.tsx
 * PURPOSE: Reports table filter controls plus `<ActiveFiltersRail>` for applied
 *          search, status/category/severity, and cross-page context chips.
 */

import type { ReactNode, RefObject } from 'react'
import { FilterSelect, Input, FILTER_SELECT_CLASS } from '../ui'
import { ActiveFiltersRail, type ActiveFilter } from '../ActiveFiltersRail'
import { FILTER_OPTIONS, severityLabel } from '../../lib/tokens'
import {
  PLATFORM_FILTER_OPTIONS,
  SDK_FILTER_OPTIONS,
  optionLabel,
  statusFilterLabel,
} from '../../lib/reportsListFilters'

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
  /** Platform filter (server maps it onto `environment->>platform`). */
  platform?: string
  /** Filter by `sdk_package`, e.g. `@mushi-mushi/react-native`. */
  sdkPackage?: string
  /** Created in the last N days (`days` param), e.g. from a KPI tile. */
  days?: string
  contextChips: ContextChip[]
  hasFilters: boolean
  onSetFilter: (key: string, value: string) => void
  onClearAll: () => void
  /** Saved views chip row — rendered in the control bar action slot. */
  savedViews?: ReactNode
}

export function ReportsFilterBar({
  searchInput,
  onSearchInputChange,
  searchInputRef,
  status,
  category,
  severity,
  platform = '',
  sdkPackage = '',
  days = '',
  contextChips,
  hasFilters,
  onSetFilter,
  onClearAll,
  savedViews,
}: Props) {
  // Compose the rail data: select-driven filters + bridged context chips.
  // Tone'd by semantic — severity uses warn/danger so a glance shows the
  // urgency band already applied; status uses neutral so the eye reads
  // the value first.
  const railFilters: ActiveFilter[] = [
    status && {
      key: 'status',
      label: 'Status',
      value: statusFilterLabel(status),
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
    platform && {
      key: 'platform',
      label: 'Platform',
      value: optionLabel(PLATFORM_FILTER_OPTIONS, platform),
      onClear: () => onSetFilter('platform', ''),
      tone: 'brand' as const,
    },
    sdkPackage && {
      key: 'sdkPackage',
      label: 'SDK',
      value: optionLabel(SDK_FILTER_OPTIONS, sdkPackage),
      onClear: () => onSetFilter('sdkPackage', ''),
      tone: 'neutral' as const,
    },
    days && {
      key: 'days',
      label: 'Created',
      value: `last ${days} day${days === '1' ? '' : 's'}`,
      onClear: () => onSetFilter('days', ''),
      tone: 'neutral' as const,
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
        <Input
          ref={searchInputRef}
          type="search"
          // Was "Search summary or description… (/)" — 38 chars in a w-64
          // field, so it rendered clipped as "Search summary or des". The
          // aria-label below still carries the full meaning.
          placeholder="Search bugs…  (/)"
          value={searchInput}
          onChange={(e) => onSearchInputChange(e.target.value)}
          name="reports-search"
          autoComplete="off"
          aria-label="Search reports"
          className="w-64"
        />
        {/* Status and severity are filtered by the quick-filter chips above. */}
        <FilterSelect
          label="Category"
          value={category}
          options={FILTER_OPTIONS.categories}
          onChange={(e) => onSetFilter('category', e.currentTarget.value)}
        />
        <label className="inline-flex flex-col gap-0.5">
          <span className="sr-only">Platform</span>
          <select
            value={platform}
            onChange={(e) => onSetFilter('platform', e.currentTarget.value)}
            aria-label="Filter by platform"
            className={FILTER_SELECT_CLASS}
          >
            <option value="">All platforms</option>
            {PLATFORM_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="inline-flex flex-col gap-0.5">
          <span className="sr-only">SDK</span>
          <select
            value={sdkPackage}
            onChange={(e) => onSetFilter('sdkPackage', e.currentTarget.value)}
            aria-label="Filter by SDK"
            className={FILTER_SELECT_CLASS}
          >
            <option value="">All SDKs</option>
            {SDK_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        {savedViews ? (
          <div className="flex flex-wrap items-center gap-1 min-w-0">{savedViews}</div>
        ) : null}
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
