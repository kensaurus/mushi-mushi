/**
 * FILE: apps/admin/src/components/skeletons/TableSkeleton.tsx
 * PURPOSE: Layout-shaped placeholder for any list/table page (Reports,
 *          Fixes, Audit, DLQ, Notifications, Marketplace, Anti-gaming…).
 *          Mirrors PageHeader + filter-bar + N-row table so first paint
 *          doesn't shift when data lands.
 */

import { Card, Skeleton } from '../ui'

interface TableSkeletonProps {
  /** Number of body rows. Defaults to 8 — typical page size. */
  rows?: number
  /** Number of columns. Defaults to 5. */
  columns?: number
  /** Show a leading filter-bar row above the table. */
  showFilters?: boolean
  /** Show a 4-tile KPI strip above the filters (e.g. Reports page). */
  showKpiStrip?: boolean
  /** Optional accessible label override. */
  label?: string
}

const COL_FLEX = (i: number, total: number) => {
  if (i === 0) return 'flex-[2]'
  if (i === total - 1) return 'flex-[0.8]'
  return 'flex-1'
}

export function TableSkeleton({
  rows = 8,
  columns = 5,
  showFilters = true,
  showKpiStrip = false,
  label = 'Loading',
}: TableSkeletonProps) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-7 w-28" />
      </div>

      {showKpiStrip && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      )}

      {showFilters && (
        <Card className="p-2.5 flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-24" />
          ))}
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <div className="border-b border-edge-subtle px-3 py-2 flex gap-3">
          {Array.from({ length: columns }).map((_, i) => (
            <div key={i} className={COL_FLEX(i, columns)}>
              <Skeleton className="h-3 w-[60%]" />
            </div>
          ))}
        </div>

        <div className="divide-y divide-edge-subtle">
          {Array.from({ length: rows }).map((_, r) => (
            <div key={r} className="px-3 py-3 flex gap-3 items-center">
              {Array.from({ length: columns }).map((_, c) => (
                <div key={c} className={COL_FLEX(c, columns)}>
                  <Skeleton
                    className={
                      c === 0
                        ? 'h-4 w-[85%]'
                        : c === columns - 1
                          ? 'h-3 w-[60%]'
                          : 'h-3 w-[70%]'
                    }
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
