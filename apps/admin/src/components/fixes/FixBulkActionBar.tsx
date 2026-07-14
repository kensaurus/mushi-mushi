/**
 * FILE: apps/admin/src/components/fixes/FixBulkActionBar.tsx
 * PURPOSE: Sticky bulk-action strip for the Attempts tab. Always visible when the
 *          list has rows so select-all is discoverable (NN/g bulk-actions #1).
 *          Action buttons activate only when rows are selected (#2 contextual bar).
 */

import { pluralizeWithCount } from '../../lib/format'
import { CHIP_TONE } from '../../lib/chipTone'

interface Props {
  /** Fixes currently shown after status-bucket filter. */
  visibleCount: number
  /** Active status filter label, e.g. "Failed" — scopes the select-all affordance. */
  filterLabel?: string | null
  allVisibleSelected: boolean
  someVisibleSelected: boolean
  onToggleSelectAll: () => void
  selectedCount: number
  mergeableCount: number
  mergedCount?: number
  failedCount: number
  busy?: boolean
  progressLabel?: string | null
  onMergeSelected: () => void
  onRetrySelected: () => void
  onClear: () => void
}

export function FixBulkActionBar({
  visibleCount,
  filterLabel,
  allVisibleSelected,
  someVisibleSelected,
  onToggleSelectAll,
  selectedCount,
  mergeableCount,
  mergedCount = 0,
  failedCount,
  busy = false,
  progressLabel,
  onMergeSelected,
  onRetrySelected,
  onClear,
}: Props) {
  if (visibleCount === 0) return null

  const scope = filterLabel ? ` in ${filterLabel}` : ' in this view'
  const skippedMerge = selectedCount - mergeableCount
  const otherSkipped = Math.max(0, skippedMerge - mergedCount)
  const hasSelection = selectedCount > 0

  const selectLabel = hasSelection
    ? allVisibleSelected
      ? `All ${visibleCount} selected`
      : `${selectedCount} selected`
    : `Select all ${visibleCount}${scope}`

  return (
    <div
      role="region"
      aria-label="Bulk actions for fix attempts"
      data-testid="fixes-bulk-action-bar"
      className="sticky top-1 z-20 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border border-brand/45 bg-surface-raised px-3 py-2 shadow-md ring-1 ring-brand/15 backdrop-blur supports-[backdrop-filter]:bg-surface-raised/95 motion-safe:animate-mushi-fade-in"
    >
      <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-fg-secondary hover:text-fg motion-safe:transition-colors">
        <input
          type="checkbox"
          checked={allVisibleSelected && visibleCount > 0}
          ref={(el) => {
            if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected
          }}
          onChange={onToggleSelectAll}
          disabled={busy}
          aria-label={`Select all ${visibleCount} fixes${scope}`}
          className="h-3.5 w-3.5 rounded-sm border-edge bg-surface-raised accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1 focus-visible:ring-offset-surface motion-safe:transition-colors disabled:opacity-40"
        />
        <span className="whitespace-nowrap">{selectLabel}</span>
      </label>

      {hasSelection && (
        <>
          <span aria-hidden="true" className="h-4 w-px bg-edge-subtle" />

          <button
            type="button"
            onClick={onMergeSelected}
            disabled={busy || mergeableCount === 0}
            title={
              mergeableCount === 0
                ? 'None of the selected fixes have an open PR that can be merged from the console'
                : `Squash-merge ${pluralizeWithCount(mergeableCount, 'PR')} and mark the linked ${pluralizeWithCount(mergeableCount, 'report')} Fixed`
            }
            className={`inline-flex items-center gap-1 rounded-sm px-2.5 py-1 text-xs font-medium hover:bg-ok-muted/40 disabled:cursor-not-allowed disabled:opacity-40 motion-safe:transition-colors ${CHIP_TONE.okSubtle}`}
          >
            {busy && progressLabel?.startsWith('Merging') ? progressLabel : `Merge ${mergeableCount}`}
          </button>

          <button
            type="button"
            onClick={onRetrySelected}
            disabled={busy || failedCount === 0}
            title={
              failedCount === 0
                ? 'None of the selected fixes are in a failed state'
                : `Re-dispatch the auto-fix agent for ${pluralizeWithCount(failedCount, 'failed fix', 'failed fixes')}`
            }
            className={`inline-flex items-center gap-1 rounded-sm px-2.5 py-1 text-xs font-medium hover:bg-warn-muted/50 disabled:cursor-not-allowed disabled:opacity-40 motion-safe:transition-colors ${CHIP_TONE.warnSubtle}`}
          >
            {busy && progressLabel?.startsWith('Re-dispatch') ? progressLabel : `Retry ${failedCount}`}
          </button>

          {skippedMerge > 0 && mergeableCount > 0 && (
            <span className="text-2xs text-fg-muted whitespace-nowrap">
              {mergeableCount} mergeable
              {mergedCount > 0 ? ` · ${mergedCount} already merged` : ''}
              {otherSkipped > 0 ? ` · ${otherSkipped} skipped` : ''}
            </span>
          )}
          {mergeableCount === 0 && mergedCount > 0 && failedCount === 0 && (
            <span className="text-2xs text-ok whitespace-nowrap">
              {pluralizeWithCount(mergedCount, 'selected PR', 'selected PRs')} already merged on GitHub
            </span>
          )}
          {mergeableCount === 0 && failedCount === 0 && mergedCount === 0 && (
            <span className="text-2xs text-fg-muted whitespace-nowrap">
              No merge or retry actions for this selection
            </span>
          )}
          {mergeableCount === 0 && failedCount > 0 && (
            <span className="text-2xs text-fg-muted whitespace-nowrap">
              Console merge unavailable — use Retry or review on GitHub
            </span>
          )}

          <span className="flex-1 min-w-[8px]" />

          <button
            type="button"
            onClick={onClear}
            disabled={busy}
            className="rounded-sm px-2 py-1 text-2xs text-fg-muted hover:text-fg disabled:opacity-40 motion-safe:transition-colors"
          >
            Clear
          </button>
        </>
      )}
    </div>
  )
}
