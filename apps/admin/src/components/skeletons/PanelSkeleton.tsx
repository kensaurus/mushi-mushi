/**
 * FILE: apps/admin/src/components/skeletons/PanelSkeleton.tsx
 * PURPOSE: Layout-shaped placeholder for settings/admin sub-panels
 *          (BYOK, Firecrawl, General, GraphBackend, Ontology, Synthetic
 *          reports, etc.). Section heading + a stack of input rows.
 */

import { Card, Skeleton } from '../ui'

interface PanelSkeletonProps {
  rows?: number
  label?: string
  /** Render inside a Card. Defaults to true. Set false if the caller
   *  already provides its own Section/Card wrapper. */
  inCard?: boolean
}

export function PanelSkeleton({
  rows = 4,
  label = 'Loading',
  inCard = true,
}: PanelSkeletonProps) {
  const body = (
    <div className="space-y-3">
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-64" />
      </div>
      <div className="space-y-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-7 w-20" />
      </div>
    </div>
  )

  return (
    <div role="status" aria-busy="true" aria-label={label}>
      {inCard ? <Card className="p-3">{body}</Card> : body}
    </div>
  )
}
