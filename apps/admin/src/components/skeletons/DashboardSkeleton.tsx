/**
 * FILE: apps/admin/src/components/skeletons/DashboardSkeleton.tsx
 * PURPOSE: Layout-shaped placeholder for the dashboard route while
 *          `usePageData('/v1/admin/dashboard')` is in flight. Mirrors the
 *          real layout (hero strip + KPI row + 2 charts + 2-col table row)
 *          so first paint doesn't shift when data lands.
 */

import { Skeleton } from '../ui'

export function DashboardSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading dashboard" className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
        <Skeleton className="h-7 w-24" />
      </div>

      <Skeleton className="h-28 w-full rounded-lg" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        <Skeleton className="h-44" />
        <Skeleton className="h-44" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    </div>
  )
}
