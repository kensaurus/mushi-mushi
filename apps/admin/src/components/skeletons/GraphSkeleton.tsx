/**
 * FILE: apps/admin/src/components/skeletons/GraphSkeleton.tsx
 * PURPOSE: Layout-shaped placeholder for the Knowledge Graph page. Mirrors
 *          quick-view chips + filter bar + canvas + side panel + 3-row table
 *          strip so the first paint matches the loaded layout.
 */

import { Card, Skeleton } from '../ui'

export function GraphSkeleton({ label = 'Loading graph' }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-3 w-72" />
        </div>
        <Skeleton className="h-7 w-32" />
      </div>

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-24 rounded-full" />
        ))}
      </div>

      <Card className="p-2.5 flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-20 rounded-full" />
        ))}
      </Card>

      <div className="grid gap-3 md:grid-cols-[1fr_18rem]">
        <Card className="p-0 overflow-hidden">
          <div className="h-[420px] relative">
            <Skeleton className="absolute inset-0" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="absolute"
                style={{
                  top: `${20 + (i * 13) % 70}%`,
                  left: `${15 + (i * 17) % 75}%`,
                }}
              >
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-3 space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-3 w-24" />
          <div className="space-y-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card className="p-3 space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-44" />
          <Skeleton className="h-16 w-full" />
        </Card>
        <Card className="p-3 space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-44" />
          <Skeleton className="h-16 w-full" />
        </Card>
      </div>
    </div>
  )
}
