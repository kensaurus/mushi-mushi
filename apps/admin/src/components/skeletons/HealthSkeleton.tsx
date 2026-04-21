/**
 * FILE: apps/admin/src/components/skeletons/HealthSkeleton.tsx
 * PURPOSE: Layout-shaped placeholder for the Health page. KPI strip
 *          (4 tiles) + 4 function cards in a 2x2 grid that mirrors the
 *          rendered shape — replaces the prior page-level spinner.
 */

import { Card, Skeleton } from '../ui'

export function HealthSkeleton({ label = 'Loading health' }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-3 w-64" />
        </div>
        <Skeleton className="h-7 w-28" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} elevated className="px-3 py-2.5 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-2 w-12" />
          </Card>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-24 w-full" />
            <div className="flex gap-2">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-6 w-24" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
