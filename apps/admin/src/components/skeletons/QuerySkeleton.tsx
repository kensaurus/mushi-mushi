/**
 * FILE: apps/admin/src/components/skeletons/QuerySkeleton.tsx
 * PURPOSE: Layout-shaped placeholder for the Query page. Prompt input +
 *          generated-SQL preview + history rows. Replaces the inline
 *          spinner pattern.
 */

import { Card, Skeleton } from '../ui'

export function QuerySkeleton({ label = 'Loading query' }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="space-y-3">
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-64" />
      </div>

      <Card className="p-3 space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-20 w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-7 w-20" />
        </div>
      </Card>

      <Card className="p-3 space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-32 w-full" />
      </Card>

      <Card className="p-3 space-y-2">
        <Skeleton className="h-3 w-32" />
        <div className="space-y-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-2 border-b border-edge-subtle last:border-b-0">
              <Skeleton className="h-3 w-3/5" />
              <Skeleton className="h-3 w-16 ml-auto" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
