/**
 * FILE: apps/admin/src/components/skeletons/ResearchSkeleton.tsx
 * PURPOSE: Layout-shaped placeholder for the Research page. Prompt input +
 *          recent-research strip with title/excerpt/citations columns.
 */

import { Card, Skeleton } from '../ui'

export function ResearchSkeleton({ label = 'Loading research' }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="space-y-3">
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-64" />
      </div>

      <Card className="p-3 space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-9 w-full" />
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-7 w-28 ml-auto" />
        </div>
      </Card>

      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-3 space-y-1.5">
            <div className="flex items-baseline gap-2">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
