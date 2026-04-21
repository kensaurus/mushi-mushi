/**
 * FILE: apps/admin/src/components/skeletons/OnboardingSkeleton.tsx
 * PURPOSE: Layout-shaped placeholder for the Onboarding wizard. Project
 *          narrative strip + checklist + step body. Replaces the prior
 *          full-page spinner so first paint matches the rendered wizard.
 */

import { Card, Skeleton } from '../ui'

export function OnboardingSkeleton({ label = 'Loading setup wizard' }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-72" />
      </div>

      <Card className="p-3 space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-3 w-64" />
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 mt-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      </Card>

      <Card className="p-3 space-y-3">
        <Skeleton className="h-3 w-32" />
        <div className="space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-4 w-4 rounded-sm" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-2 w-1/2" />
              </div>
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-32 w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-24" />
        </div>
      </Card>
    </div>
  )
}
