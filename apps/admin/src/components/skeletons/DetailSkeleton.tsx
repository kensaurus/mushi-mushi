/**
 * FILE: apps/admin/src/components/skeletons/DetailSkeleton.tsx
 * PURPOSE: Layout-shaped placeholder for detail/drill-down pages
 *          (ReportDetailPage, JudgePage detail, etc.). Header strip +
 *          two-column body so first paint matches the loaded layout.
 */

import { Card, Skeleton } from '../ui'

interface DetailSkeletonProps {
  label?: string
}

export function DetailSkeleton({ label = 'Loading detail' }: DetailSkeletonProps) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        {/* min-w-0 + max-w-full: the fixed bar widths must shrink on a phone,
            or the header (288px + 200px of buttons) scrolls <main> sideways. */}
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3 w-24 max-w-full" />
          <Skeleton className="h-5 w-72 max-w-full" />
          <Skeleton className="h-3 w-56 max-w-full" />
        </div>
        <div className="hidden shrink-0 gap-2 sm:flex">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-28" />
        </div>
      </div>

      <Card className="p-3 flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-24" />
        ))}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
        <div className="lg:col-span-2 space-y-2.5">
          <Card className="p-3 space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-[92%]" />
            <Skeleton className="h-3 w-[78%]" />
            <Skeleton className="h-3 w-3/5" />
          </Card>
          <Card className="p-3 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-24 w-full" />
          </Card>
        </div>

        <div className="space-y-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="p-3 space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-[80%]" />
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
