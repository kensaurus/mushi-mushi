/**
 * FILE: apps/admin/src/components/reports/ReportsFilterBar.tsx
 * PURPOSE: Reports table filter controls plus `<ActiveFiltersRail>` for applied
 *          search, status/category/severity, and cross-page context chips.
 */

import type { ReactNode, RefObject } from 'react'
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
  /** Filter by `environment->>platform`, e.g. `ios | android | web`. */
  platform?: string
  /** Filter by `sdk_package`, e.g. `@mushi-mushi/react-native`. */
  sdkPackage?: string
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
    platform && {
      key: 'platform',
      label: 'Platform',
      value: platform,
      onClear: () => onSetFilter('platform', ''),
      tone: 'brand' as const,
    },
    sdkPackage && {
      key: 'sdkPackage',
      label: 'SDK',
      value: sdkPackage,
      onClear: () => onSetFilter('sdkPackage', ''),
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
        <select
          value={platform}
          onChange={(e) => onSetFilter('platform', e.currentTarget.value)}
          aria-label="Filter by platform"
          className="bg-surface-raised border border-edge-subtle rounded-sm px-2 py-1 text-xs text-fg-secondary hover:border-edge focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/40 motion-safe:transition-colors motion-safe:duration-150"
        >
          <option value="">All platforms</option>
          <option value="ios">iOS</option>
          <option value="android">Android</option>
          <option value="web">Web</option>
          <option value="macos">macOS</option>
          <option value="windows">Windows</option>
        </select>
        <select
          value={sdkPackage}
          onChange={(e) => onSetFilter('sdkPackage', e.currentTarget.value)}
          aria-label="Filter by SDK"
          className="bg-surface-raised border border-edge-subtle rounded-sm px-2 py-1 text-xs text-fg-secondary hover:border-edge focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/40 motion-safe:transition-colors motion-safe:duration-150"
        >
          <option value="">All SDKs</option>
          <option value="@mushi-mushi/web">Web</option>
          <option value="@mushi-mushi/react">React</option>
          <option value="@mushi-mushi/react-native">React Native</option>
          <option value="@mushi-mushi/capacitor">Capacitor</option>
        </select>
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
